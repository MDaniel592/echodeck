import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import fsPromises from "fs/promises"
import path from "path"
import prisma from "../../../../lib/prisma"
import { verifyPassword } from "../../../../lib/auth"
import { sanitizeSong } from "../../../../lib/sanitize"
import { resolveSafeDownloadPathForRead } from "../../../../lib/downloadPaths"
import { nodeReadableToWebStream } from "../../../../lib/nodeReadableToWebStream"

type SubsonicUser = {
  id: number
  username: string
}

function response(request: NextRequest, payload: Record<string, unknown>, status = "ok") {
  const format = request.nextUrl.searchParams.get("f") || "json"
  const body = {
    "subsonic-response": {
      status,
      version: "1.16.1",
      type: "EchoDeck",
      serverVersion: "1.0.0",
      ...payload,
    },
  }

  if (format !== "json") {
    return NextResponse.json(
      {
        "subsonic-response": {
          ...body["subsonic-response"],
          error: { code: 0, message: "Only JSON format is supported" },
        },
      },
      { status: 400 }
    )
  }

  return NextResponse.json(body)
}

function decodePassword(raw: string): string {
  if (raw.startsWith("enc:")) {
    const hex = raw.slice(4)
    return Buffer.from(hex, "hex").toString("utf8")
  }
  return raw
}

async function authenticate(request: NextRequest): Promise<SubsonicUser | null> {
  const username = request.nextUrl.searchParams.get("u")?.trim() || ""
  const passwordRaw = request.nextUrl.searchParams.get("p") || ""
  if (!username || !passwordRaw) return null

  const user = await prisma.user.findUnique({
    where: { username },
    select: { id: true, username: true, passwordHash: true, disabledAt: true },
  })
  if (!user || user.disabledAt) return null

  const password = decodePassword(passwordRaw)
  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) return null

  return { id: user.id, username: user.username }
}

function commandFromRequest(request: NextRequest): string {
  const raw = request.nextUrl.searchParams.get("command")
  if (raw) return raw

  return "ping"
}

function mapSong(song: {
  id: number
  title: string
  artist: string | null
  album: string | null
  duration: number | null
  trackNumber: number | null
  year: number | null
  genre: string | null
  starredAt?: Date | null
  playCount?: number
  albumId?: number | null
}) {
  return {
    id: String(song.id),
    title: song.title,
    artist: song.artist || undefined,
    album: song.album || undefined,
    albumId: song.albumId ? String(song.albumId) : undefined,
    duration: song.duration || undefined,
    track: song.trackNumber || undefined,
    year: song.year || undefined,
    genre: song.genre || undefined,
    starred: song.starredAt ? song.starredAt.toISOString() : undefined,
    playCount: song.playCount ?? undefined,
  }
}

function parseIntParam(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}

function extractSongIds(request: NextRequest): number[] {
  const values = [
    ...request.nextUrl.searchParams.getAll("id"),
    ...request.nextUrl.searchParams.getAll("songId"),
  ]
  const parsed = values
    .map((raw) => Number.parseInt(raw, 10))
    .filter((id): id is number => Number.isInteger(id) && id > 0)
  return Array.from(new Set(parsed))
}

function resolveMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === ".png") return "image/png"
  if (ext === ".webp") return "image/webp"
  if (ext === ".gif") return "image/gif"
  return "image/jpeg"
}

export async function GET(request: NextRequest) {
  try {
    const cmd = commandFromRequest(request)

    if (cmd === "ping" || cmd === "getLicense") {
      return response(request, cmd === "getLicense" ? { license: { valid: true } } : {})
    }

    const user = await authenticate(request)
    if (!user) {
      return response(request, { error: { code: 40, message: "Wrong username or password" } }, "failed")
    }

    if (cmd === "getMusicFolders") {
      const libraries = await prisma.library.findMany({
        where: { userId: user.id },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      })
      return response(request, {
        musicFolders: {
          musicFolder: libraries.map((library) => ({
            id: String(library.id),
            name: library.name,
          })),
        },
      })
    }

    if (cmd === "getArtists" || cmd === "getIndexes") {
      const artists = await prisma.artist.findMany({
        where: { userId: user.id },
        orderBy: { name: "asc" },
        include: { _count: { select: { albums: true } } },
      })
      return response(request, {
        artists: {
          index: [
            {
              name: "A-Z",
              artist: artists.map((artist) => ({
                id: String(artist.id),
                name: artist.name,
                albumCount: artist._count.albums,
              })),
            },
          ],
        },
      })
    }

    if (cmd === "getArtist") {
      const id = Number.parseInt(request.nextUrl.searchParams.get("id") || "", 10)
      if (!Number.isInteger(id) || id <= 0) {
        return response(request, { error: { code: 10, message: "Missing artist id" } }, "failed")
      }
      const artist = await prisma.artist.findFirst({
        where: { id, userId: user.id },
        include: { albums: { orderBy: [{ year: "desc" }, { title: "asc" }] } },
      })
      if (!artist) {
        return response(request, { error: { code: 70, message: "Artist not found" } }, "failed")
      }
      return response(request, {
        artist: {
          id: String(artist.id),
          name: artist.name,
          album: artist.albums.map((album) => ({
            id: String(album.id),
            name: album.title,
            year: album.year || undefined,
          })),
        },
      })
    }

    if (cmd === "getAlbum") {
      const id = Number.parseInt(request.nextUrl.searchParams.get("id") || "", 10)
      if (!Number.isInteger(id) || id <= 0) {
        return response(request, { error: { code: 10, message: "Missing album id" } }, "failed")
      }
      const album = await prisma.album.findFirst({
        where: { id, userId: user.id },
        include: {
          songs: {
            orderBy: [{ discNumber: "asc" }, { trackNumber: "asc" }, { createdAt: "asc" }],
          },
          artist: true,
        },
      })
      if (!album) {
        return response(request, { error: { code: 70, message: "Album not found" } }, "failed")
      }

      return response(request, {
        album: {
          id: String(album.id),
          name: album.title,
          artist: album.artist?.name || album.albumArtist || undefined,
          year: album.year || undefined,
          song: album.songs.map(mapSong),
        },
      })
    }

    if (cmd === "getSong") {
      const id = Number.parseInt(request.nextUrl.searchParams.get("id") || "", 10)
      if (!Number.isInteger(id) || id <= 0) {
        return response(request, { error: { code: 10, message: "Missing song id" } }, "failed")
      }
      const song = await prisma.song.findFirst({
        where: { id, userId: user.id },
      })
      if (!song) {
        return response(request, { error: { code: 70, message: "Song not found" } }, "failed")
      }
      const safeSong = sanitizeSong(song)
      return response(request, { song: mapSong(safeSong) })
    }

    if (cmd === "getPlaylists") {
      const playlists = await prisma.playlist.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { songs: true } } },
      })

      return response(request, {
        playlists: {
          playlist: playlists.map((playlist) => ({
            id: String(playlist.id),
            name: playlist.name,
            songCount: playlist._count.songs,
            created: playlist.createdAt.toISOString(),
          })),
        },
      })
    }

    if (cmd === "getPlaylist") {
      const id = Number.parseInt(request.nextUrl.searchParams.get("id") || "", 10)
      if (!Number.isInteger(id) || id <= 0) {
        return response(request, { error: { code: 10, message: "Missing playlist id" } }, "failed")
      }

      const playlist = await prisma.playlist.findFirst({
        where: { id, userId: user.id },
        include: {
          songs: {
            orderBy: { createdAt: "asc" },
          },
        },
      })
      if (!playlist) {
        return response(request, { error: { code: 70, message: "Playlist not found" } }, "failed")
      }

      return response(request, {
        playlist: {
          id: String(playlist.id),
          name: playlist.name,
          songCount: playlist.songs.length,
          entry: playlist.songs.map(mapSong),
        },
      })
    }

    if (cmd === "stream") {
      const id = Number.parseInt(request.nextUrl.searchParams.get("id") || "", 10)
      if (!Number.isInteger(id) || id <= 0) {
        return new Response("Missing song id", { status: 400 })
      }

      const song = await prisma.song.findFirst({
        where: { id, userId: user.id },
      })
      if (!song) {
        return new Response("Song not found", { status: 404 })
      }

      const resolvedPath = resolveSafeDownloadPathForRead(song.filePath)
      if (!resolvedPath) {
        return new Response("Access denied", { status: 403 })
      }

      const stat = await fsPromises.stat(resolvedPath)
      const stream = fs.createReadStream(resolvedPath)
      return new Response(nodeReadableToWebStream(stream), {
        headers: {
          "Content-Type": "audio/mpeg",
          "Content-Length": String(stat.size),
          "Accept-Ranges": "bytes",
        },
      })
    }

    if (cmd === "getCoverArt") {
      const rawId = request.nextUrl.searchParams.get("id") || ""
      if (!rawId) {
        return new Response("Missing cover id", { status: 400 })
      }

      let coverPath: string | null = null
      const numericId = Number.parseInt(rawId.replace(/^(al|ar)-/, ""), 10)

      if (rawId.startsWith("al-") && Number.isInteger(numericId) && numericId > 0) {
        const album = await prisma.album.findFirst({
          where: { id: numericId, userId: user.id },
          select: { coverPath: true },
        })
        coverPath = album?.coverPath || null
        if (!coverPath) {
          const song = await prisma.song.findFirst({
            where: { userId: user.id, albumId: numericId, coverPath: { not: null } },
            select: { coverPath: true },
          })
          coverPath = song?.coverPath || null
        }
      } else if (rawId.startsWith("ar-") && Number.isInteger(numericId) && numericId > 0) {
        const song = await prisma.song.findFirst({
          where: { userId: user.id, artistId: numericId, coverPath: { not: null } },
          select: { coverPath: true },
        })
        coverPath = song?.coverPath || null
      } else if (Number.isInteger(numericId) && numericId > 0) {
        const song = await prisma.song.findFirst({
          where: { id: numericId, userId: user.id },
          select: { coverPath: true, albumId: true },
        })
        coverPath = song?.coverPath || null
        if (!coverPath && song?.albumId) {
          const albumSong = await prisma.song.findFirst({
            where: { userId: user.id, albumId: song.albumId, coverPath: { not: null } },
            select: { coverPath: true },
          })
          coverPath = albumSong?.coverPath || null
        }
      }

      if (!coverPath) {
        return new Response("Cover not found", { status: 404 })
      }

      const resolvedPath = resolveSafeDownloadPathForRead(coverPath)
      if (!resolvedPath) {
        return new Response("Access denied", { status: 403 })
      }

      const stat = await fsPromises.stat(resolvedPath)
      const stream = fs.createReadStream(resolvedPath)
      return new Response(nodeReadableToWebStream(stream), {
        headers: {
          "Content-Type": resolveMimeType(resolvedPath),
          "Content-Length": String(stat.size),
          "Cache-Control": "public, max-age=3600",
        },
      })
    }

    if (cmd === "search3") {
      const query = request.nextUrl.searchParams.get("query")?.trim() || ""
      if (!query) {
        return response(request, {
          searchResult3: {
            artist: [],
            album: [],
            song: [],
          },
        })
      }

      const artistCount = parseIntParam(request.nextUrl.searchParams.get("artistCount"), 20)
      const albumCount = parseIntParam(request.nextUrl.searchParams.get("albumCount"), 20)
      const songCount = parseIntParam(request.nextUrl.searchParams.get("songCount"), 20)
      const artistOffset = parseIntParam(request.nextUrl.searchParams.get("artistOffset"), 0)
      const albumOffset = parseIntParam(request.nextUrl.searchParams.get("albumOffset"), 0)
      const songOffset = parseIntParam(request.nextUrl.searchParams.get("songOffset"), 0)

      const [artists, albums, songs] = await Promise.all([
        prisma.artist.findMany({
          where: { userId: user.id, name: { contains: query } },
          orderBy: { name: "asc" },
          skip: artistOffset,
          take: artistCount,
        }),
        prisma.album.findMany({
          where: {
            userId: user.id,
            OR: [
              { title: { contains: query } },
              { albumArtist: { contains: query } },
            ],
          },
          orderBy: [{ year: "desc" }, { title: "asc" }],
          skip: albumOffset,
          take: albumCount,
          include: { artist: true },
        }),
        prisma.song.findMany({
          where: {
            userId: user.id,
            OR: [
              { title: { contains: query } },
              { artist: { contains: query } },
              { album: { contains: query } },
            ],
          },
          orderBy: { createdAt: "desc" },
          skip: songOffset,
          take: songCount,
        }),
      ])

      return response(request, {
        searchResult3: {
          artist: artists.map((artist) => ({
            id: String(artist.id),
            name: artist.name,
          })),
          album: albums.map((album) => ({
            id: String(album.id),
            name: album.title,
            artist: album.artist?.name || album.albumArtist || undefined,
            year: album.year || undefined,
          })),
          song: songs.map(mapSong),
        },
      })
    }

    if (cmd === "star" || cmd === "unstar") {
      const songIds = extractSongIds(request)
      if (songIds.length === 0) {
        return response(request, { error: { code: 10, message: "Missing song id(s)" } }, "failed")
      }

      await prisma.song.updateMany({
        where: {
          userId: user.id,
          id: { in: songIds },
        },
        data: {
          starredAt: cmd === "star" ? new Date() : null,
        },
      })

      return response(request, {})
    }

    if (cmd === "scrobble") {
      const songIds = extractSongIds(request)
      if (songIds.length === 0) {
        return response(request, { error: { code: 10, message: "Missing song id(s)" } }, "failed")
      }

      const submission = request.nextUrl.searchParams.get("submission") === "true"
      const timeRaw = request.nextUrl.searchParams.get("time")
      const timeMillis = Number.parseInt(timeRaw || "", 10)
      const playedAt = Number.isInteger(timeMillis) && timeMillis > 0 ? new Date(timeMillis) : new Date()

      await Promise.all(
        songIds.map((songId) =>
          prisma.song.updateMany({
            where: {
              userId: user.id,
              id: songId,
            },
            data: {
              lastPlayedAt: playedAt,
              ...(submission ? { playCount: { increment: 1 } } : {}),
            },
          })
        )
      )

      return response(request, {})
    }

    if (cmd === "getStarred2") {
      const songs = await prisma.song.findMany({
        where: {
          userId: user.id,
          starredAt: { not: null },
        },
        orderBy: [{ starredAt: "desc" }, { id: "desc" }],
        take: 500,
      })

      return response(request, {
        starred2: {
          song: songs.map(mapSong),
        },
      })
    }

    return response(request, { error: { code: 0, message: `Unsupported command: ${cmd}` } }, "failed")
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unhandled server error"
    return response(request, { error: { code: 0, message } }, "failed")
  }
}
