import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import fsPromises from "fs/promises"
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
  const c = request.nextUrl.searchParams.get("c")
  if (c) return c

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
}) {
  return {
    id: String(song.id),
    title: song.title,
    artist: song.artist || undefined,
    album: song.album || undefined,
    duration: song.duration || undefined,
    track: song.trackNumber || undefined,
    year: song.year || undefined,
    genre: song.genre || undefined,
  }
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

    return response(request, { error: { code: 0, message: `Unsupported command: ${cmd}` } }, "failed")
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unhandled server error"
    return response(request, { error: { code: 0, message } }, "failed")
  }
}
