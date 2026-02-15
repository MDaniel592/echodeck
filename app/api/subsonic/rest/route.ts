import { NextRequest } from "next/server"
import fs from "fs"
import fsPromises from "fs/promises"
import path from "path"
import { spawn } from "child_process"
import prisma from "../../../../lib/prisma"
import { verifyPassword } from "../../../../lib/auth"
import { checkRateLimit } from "../../../../lib/rateLimit"
import { sanitizeSong } from "../../../../lib/sanitize"
import { resolveSafeDownloadPathForRead } from "../../../../lib/downloadPaths"
import { nodeReadableToWebStream } from "../../../../lib/nodeReadableToWebStream"
import { getFfmpegDir } from "../../../../lib/binaries"
import {
  getPlaylistSongsForUser,
  replacePlaylistEntriesForUser,
} from "../../../../lib/playlistEntries"
import { enqueueLibraryScan } from "../../../../lib/libraryScanQueue"
import {
  mapSubsonicSong as mapSong,
  mapSubsonicUser,
  parseByteRange,
  parseIntParam,
  parseNumericId,
  resolveMediaMimeType as resolveMimeType,
  subsonicResponse as response,
} from "../../../../lib/subsonicAdapter"
import {
  createSubsonicTokenFromPassword,
  decryptSubsonicPassword,
  encryptSubsonicPassword,
} from "../../../../lib/subsonicPassword"

type SubsonicUser = {
  id: number
  username: string
}

const SUBSONIC_MAX_FAILED_ATTEMPTS_PER_ACCOUNT = 20
const SUBSONIC_MAX_FAILED_ATTEMPTS_PER_CLIENT = 80
const SUBSONIC_WINDOW_MS = 15 * 60 * 1000
const TRUST_PROXY = process.env.TRUST_PROXY === "1"

function getClientIdentifier(request: NextRequest): string {
  if (!TRUST_PROXY) {
    const userAgent = request.headers.get("user-agent") || "unknown-agent"
    const acceptLanguage = request.headers.get("accept-language") || "unknown-lang"
    return `ua:${userAgent.slice(0, 120)}|lang:${acceptLanguage.slice(0, 64)}`
  }

  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "proxied-client"
  )
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
  const tokenRaw = request.nextUrl.searchParams.get("t") || ""
  const salt = request.nextUrl.searchParams.get("s") || ""
  if (!username || (!passwordRaw && !(tokenRaw && salt))) return null

  const user = await prisma.user.findUnique({
    where: { username },
    select: {
      id: true,
      username: true,
      passwordHash: true,
      subsonicToken: true,
      subsonicPasswordEnc: true,
      disabledAt: true,
    },
  })
  if (!user || user.disabledAt) return null

  let valid = false
  if (passwordRaw) {
    const password = decodePassword(passwordRaw)
    valid = await verifyPassword(password, user.passwordHash)
    if (valid && !user.subsonicPasswordEnc) {
      const encrypted = encryptSubsonicPassword(password)
      if (encrypted) {
        await prisma.user.update({
          where: { id: user.id },
          data: { subsonicPasswordEnc: encrypted },
        }).catch(() => {})
      }
    }
  } else if (tokenRaw && salt) {
    const storedPassword = decryptSubsonicPassword(user.subsonicPasswordEnc)
    if (storedPassword) {
      const expectedFromPassword = createSubsonicTokenFromPassword(storedPassword, salt)
      valid = expectedFromPassword.toLowerCase() === tokenRaw.toLowerCase()
    }

    if (!valid && user.subsonicToken) {
      const expectedFromLegacyToken = createSubsonicTokenFromPassword(user.subsonicToken, salt)
      valid = expectedFromLegacyToken.toLowerCase() === tokenRaw.toLowerCase()
    }
  }

  if (!valid) {
    const client = getClientIdentifier(request)
    const perClientLimit = checkRateLimit(
      `subsonic:failed:client:${client}`,
      SUBSONIC_MAX_FAILED_ATTEMPTS_PER_CLIENT,
      SUBSONIC_WINDOW_MS
    )
    const accountKey = `subsonic:failed:account:${username.toLowerCase()}:${client}`
    const accountLimit = checkRateLimit(
      accountKey,
      SUBSONIC_MAX_FAILED_ATTEMPTS_PER_ACCOUNT,
      SUBSONIC_WINDOW_MS
    )
    if (!perClientLimit.allowed || !accountLimit.allowed) {
      return null
    }
    return null
  }

  return { id: user.id, username: user.username }
}

function commandFromRequest(request: NextRequest): string {
  const raw = request.nextUrl.searchParams.get("command")
  if (raw) return raw

  return "ping"
}

async function buildSearchResult(
  userId: number,
  query: string,
  artistCount: number,
  albumCount: number,
  songCount: number,
  artistOffset: number,
  albumOffset: number,
  songOffset: number
) {
  const [artists, albums, songs] = await Promise.all([
    prisma.artist.findMany({
      where: { userId, name: { contains: query } },
      orderBy: { name: "asc" },
      skip: artistOffset,
      take: artistCount,
    }),
    prisma.album.findMany({
      where: {
        userId,
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
        userId,
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

  return {
    artists,
    albums,
    songs,
  }
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

function canTranscodeToBitrate(songBitrate: number | null | undefined, maxBitRateKbps: number): boolean {
  if (!songBitrate || maxBitRateKbps <= 0) return false
  return songBitrate > maxBitRateKbps * 1000
}

function transcodeToMp3(filePath: string, maxBitRateKbps: number) {
  const ffmpegDir = getFfmpegDir()
  const ffmpegPath = path.join(ffmpegDir, "ffmpeg")
  if (!fs.existsSync(ffmpegPath)) return null

  const proc = spawn(ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    filePath,
    "-vn",
    "-map_metadata",
    "-1",
    "-codec:a",
    "libmp3lame",
    "-b:a",
    `${maxBitRateKbps}k`,
    "-f",
    "mp3",
    "pipe:1",
  ], {
    stdio: ["ignore", "pipe", "pipe"],
  })

  proc.stderr.on("data", () => {
    // keep stderr drained to avoid backpressure stalling ffmpeg
  })
  return proc
}

export async function GET(request: NextRequest) {
  try {
    const cmd = commandFromRequest(request)

    if (cmd === "ping" || cmd === "getLicense") {
      return response(request, cmd === "getLicense" ? { license: { valid: true } } : {})
    }

    if (cmd === "getOpenSubsonicExtensions") {
      return response(request, {
        openSubsonicExtensions: {
          openSubsonicExtension: [
            { name: "apiKeyAuthentication", versions: "1" },
            { name: "formPost", versions: "1" },
            { name: "transcodeOffset", versions: "1" },
          ],
        },
      })
    }

    const user = await authenticate(request)
    if (!user) {
      return response(request, { error: { code: 40, message: "Wrong username or password" } }, "failed")
    }
    const subsonicDeviceId = `subsonic:${user.username}`

    if (cmd === "getUser") {
      const targetUsername = request.nextUrl.searchParams.get("username")?.trim() || user.username
      const target = await prisma.user.findFirst({
        where: { username: targetUsername },
        select: { username: true, role: true },
      })
      if (!target) {
        return response(request, { error: { code: 70, message: "User not found" } }, "failed")
      }

      // Non-admin users can only introspect themselves.
      if (target.username !== user.username) {
        const me = await prisma.user.findFirst({
          where: { id: user.id },
          select: { role: true },
        })
        if (me?.role !== "admin") {
          return response(request, { error: { code: 50, message: "Not authorized" } }, "failed")
        }
      }

      return response(request, {
        user: mapSubsonicUser(target),
      })
    }

    if (cmd === "getUsers") {
      const me = await prisma.user.findFirst({
        where: { id: user.id },
        select: { username: true, role: true },
      })
      if (!me) {
        return response(request, { error: { code: 70, message: "User not found" } }, "failed")
      }

      if (me.role !== "admin") {
        return response(request, {
          users: {
            user: [mapSubsonicUser(me)],
          },
        })
      }

      const users = await prisma.user.findMany({
        where: { disabledAt: null },
        orderBy: { username: "asc" },
        select: { username: true, role: true },
      })
      return response(request, {
        users: {
          user: users.map(mapSubsonicUser),
        },
      })
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

    if (cmd === "getArtistInfo2") {
      const id = parseNumericId(request.nextUrl.searchParams.get("id"))
      if (!id) {
        return response(request, { error: { code: 10, message: "Missing artist id" } }, "failed")
      }

      const artist = await prisma.artist.findFirst({
        where: { id, userId: user.id },
      })
      if (!artist) {
        return response(request, { error: { code: 70, message: "Artist not found" } }, "failed")
      }

      return response(request, {
        artistInfo2: {
          biography: "",
          musicBrainzId: artist.mbid || "",
          lastFmUrl: "",
          smallImageUrl: `/api/subsonic/rest/getCoverArt.view?id=ar-${artist.id}`,
          mediumImageUrl: `/api/subsonic/rest/getCoverArt.view?id=ar-${artist.id}`,
          largeImageUrl: `/api/subsonic/rest/getCoverArt.view?id=ar-${artist.id}`,
          similarArtist: [],
        },
      })
    }

    if (cmd === "getMusicDirectory") {
      const rawId = request.nextUrl.searchParams.get("id")
      if (!rawId) {
        return response(request, { error: { code: 10, message: "Missing directory id" } }, "failed")
      }

      const libraryId = parseNumericId(rawId)
      if (libraryId) {
        const library = await prisma.library.findFirst({
          where: { id: libraryId, userId: user.id },
        })
        if (!library) {
          return response(request, { error: { code: 70, message: "Directory not found" } }, "failed")
        }

        const artists = await prisma.artist.findMany({
          where: {
            userId: user.id,
            songs: { some: { libraryId: library.id } },
          },
          orderBy: { name: "asc" },
        })

        return response(request, {
          directory: {
            id: String(library.id),
            name: library.name,
            child: artists.map((artist) => ({
              id: `ar-${artist.id}`,
              parent: String(library.id),
              title: artist.name,
              isDir: true,
            })),
          },
        })
      }

      if (rawId.startsWith("ar-")) {
        const artistId = parseNumericId(rawId.slice(3))
        if (!artistId) {
          return response(request, { error: { code: 10, message: "Invalid artist directory id" } }, "failed")
        }

        const artist = await prisma.artist.findFirst({
          where: { id: artistId, userId: user.id },
          include: {
            albums: {
              where: { userId: user.id },
              orderBy: [{ year: "desc" }, { title: "asc" }],
            },
          },
        })
        if (!artist) {
          return response(request, { error: { code: 70, message: "Directory not found" } }, "failed")
        }

        return response(request, {
          directory: {
            id: `ar-${artist.id}`,
            name: artist.name,
            child: artist.albums.map((album) => ({
              id: `al-${album.id}`,
              parent: `ar-${artist.id}`,
              title: album.title,
              isDir: true,
              year: album.year || undefined,
            })),
          },
        })
      }

      if (rawId.startsWith("al-")) {
        const albumId = parseNumericId(rawId.slice(3))
        if (!albumId) {
          return response(request, { error: { code: 10, message: "Invalid album directory id" } }, "failed")
        }

        const album = await prisma.album.findFirst({
          where: { id: albumId, userId: user.id },
          include: {
            songs: {
              where: { userId: user.id },
              orderBy: [{ discNumber: "asc" }, { trackNumber: "asc" }, { createdAt: "asc" }],
            },
          },
        })
        if (!album) {
          return response(request, { error: { code: 70, message: "Directory not found" } }, "failed")
        }

        return response(request, {
          directory: {
            id: `al-${album.id}`,
            name: album.title,
            child: album.songs.map((song) => ({
              ...mapSong(song),
              parent: `al-${album.id}`,
              isDir: false,
            })),
          },
        })
      }

      return response(request, { error: { code: 0, message: "Unsupported directory id" } }, "failed")
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
        include: { _count: { select: { entries: true } } },
      })

      return response(request, {
        playlists: {
          playlist: playlists.map((playlist) => ({
            id: String(playlist.id),
            name: playlist.name,
            songCount: playlist._count.entries,
            created: playlist.createdAt.toISOString(),
          })),
        },
      })
    }

    if (cmd === "getNowPlaying") {
      const sessions = await prisma.playbackSession.findMany({
        where: {
          userId: user.id,
          isPlaying: true,
          currentSongId: { not: null },
        },
        orderBy: { updatedAt: "desc" },
        take: 25,
        include: {
          currentSong: true,
        },
      })

      return response(request, {
        nowPlaying: {
          entry: sessions
            .map((session) => session.currentSong)
            .filter((song): song is NonNullable<typeof song> => Boolean(song))
            .map(mapSong),
        },
      })
    }

    if (cmd === "getPlayQueue") {
      const session = await prisma.playbackSession.findUnique({
        where: {
          userId_deviceId: {
            userId: user.id,
            deviceId: subsonicDeviceId,
          },
        },
        include: {
          currentSong: true,
          queueItems: {
            orderBy: { sortOrder: "asc" },
            include: { song: true },
          },
        },
      })

      return response(request, {
        playQueue: {
          current: session?.currentSongId ? String(session.currentSongId) : undefined,
          position: session ? Math.max(0, Math.round(session.positionSec * 1000)) : 0,
          changed: session?.updatedAt.toISOString(),
          entry: session?.queueItems.map((item) => mapSong(item.song)) || [],
        },
      })
    }

    if (cmd === "savePlayQueue") {
      const rawIds = request.nextUrl.searchParams.getAll("id")
      const queueSongIds = rawIds
        .map((raw) => Number.parseInt(raw, 10))
        .filter((id): id is number => Number.isInteger(id) && id > 0)
      const currentRaw = request.nextUrl.searchParams.get("current")
      const currentSongId = currentRaw ? Number.parseInt(currentRaw, 10) : null
      const positionRaw = request.nextUrl.searchParams.get("position")
      const positionMs = positionRaw ? Number.parseInt(positionRaw, 10) : 0

      const uniqueSongIds = Array.from(new Set(queueSongIds))
      if (uniqueSongIds.length > 0) {
        const songs = await prisma.song.findMany({
          where: { userId: user.id, id: { in: uniqueSongIds } },
          select: { id: true },
        })
        if (songs.length !== uniqueSongIds.length) {
          return response(request, { error: { code: 70, message: "One or more songs were not found" } }, "failed")
        }
      }

      if (currentSongId !== null && Number.isInteger(currentSongId) && currentSongId > 0) {
        const currentSong = await prisma.song.findFirst({
          where: { userId: user.id, id: currentSongId },
          select: { id: true },
        })
        if (!currentSong) {
          return response(request, { error: { code: 70, message: "Current song not found" } }, "failed")
        }
      }

      await prisma.$transaction(async (tx) => {
        const session = await tx.playbackSession.upsert({
          where: {
            userId_deviceId: {
              userId: user.id,
              deviceId: subsonicDeviceId,
            },
          },
          create: {
            userId: user.id,
            deviceId: subsonicDeviceId,
            currentSongId:
              currentSongId !== null && Number.isInteger(currentSongId) && currentSongId > 0
                ? currentSongId
                : null,
            positionSec: Number.isInteger(positionMs) && positionMs > 0 ? positionMs / 1000 : 0,
            isPlaying: false,
          },
          update: {
            currentSongId:
              currentSongId !== null && Number.isInteger(currentSongId) && currentSongId > 0
                ? currentSongId
                : null,
            positionSec: Number.isInteger(positionMs) && positionMs > 0 ? positionMs / 1000 : 0,
          },
          select: { id: true },
        })

        await tx.playbackQueueItem.deleteMany({
          where: { sessionId: session.id },
        })

        if (queueSongIds.length > 0) {
          await tx.playbackQueueItem.createMany({
            data: queueSongIds.map((songId, index) => ({
              sessionId: session.id,
              songId,
              sortOrder: index,
            })),
          })
        }
      })

      return response(request, {})
    }

    if (cmd === "getRandomSongs") {
      const size = Math.min(500, Math.max(1, parseIntParam(request.nextUrl.searchParams.get("size"), 50)))
      const total = await prisma.song.count({ where: { userId: user.id } })
      if (total === 0) {
        return response(request, { randomSongs: { song: [] } })
      }

      const take = Math.min(size, total)
      const randomIds = await prisma.song.findMany({
        where: { userId: user.id },
        orderBy: { id: "asc" },
        select: { id: true },
      })
      const shuffled = randomIds
        .map((row) => row.id)
        .sort(() => Math.random() - 0.5)
        .slice(0, take)

      const songs = await prisma.song.findMany({
        where: { userId: user.id, id: { in: shuffled } },
      })

      return response(request, {
        randomSongs: {
          song: songs.map(mapSong),
        },
      })
    }

    if (cmd === "getAlbumList2") {
      const type = (request.nextUrl.searchParams.get("type") || "newest").toLowerCase()
      const size = Math.min(500, Math.max(1, parseIntParam(request.nextUrl.searchParams.get("size"), 50)))
      const offset = Math.max(0, parseIntParam(request.nextUrl.searchParams.get("offset"), 0))

      let orderBy: Array<{ createdAt?: "asc" | "desc"; year?: "asc" | "desc"; title?: "asc" | "desc" }>
      if (type === "alphabeticalbyname") {
        orderBy = [{ title: "asc" }]
      } else if (type === "byyear") {
        orderBy = [{ year: "desc" }, { title: "asc" }]
      } else {
        orderBy = [{ createdAt: "desc" }]
      }

      const albums = await prisma.album.findMany({
        where: { userId: user.id },
        orderBy,
        skip: offset,
        take: size,
        include: {
          artist: { select: { id: true, name: true } },
        },
      })

      return response(request, {
        albumList2: {
          album: albums.map((album) => ({
            id: String(album.id),
            name: album.title,
            artist: album.artist?.name || album.albumArtist || undefined,
            year: album.year || undefined,
          })),
        },
      })
    }

    if (cmd === "getAlbumList") {
      const type = (request.nextUrl.searchParams.get("type") || "newest").toLowerCase()
      const size = Math.min(500, Math.max(1, parseIntParam(request.nextUrl.searchParams.get("size"), 50)))
      const offset = Math.max(0, parseIntParam(request.nextUrl.searchParams.get("offset"), 0))

      let orderBy: Array<{ createdAt?: "asc" | "desc"; year?: "asc" | "desc"; title?: "asc" | "desc" }>
      if (type === "alphabeticalbyname") {
        orderBy = [{ title: "asc" }]
      } else if (type === "byyear") {
        orderBy = [{ year: "desc" }, { title: "asc" }]
      } else {
        orderBy = [{ createdAt: "desc" }]
      }

      const albums = await prisma.album.findMany({
        where: { userId: user.id },
        orderBy,
        skip: offset,
        take: size,
        include: {
          artist: { select: { id: true, name: true } },
        },
      })

      return response(request, {
        albumList: {
          album: albums.map((album) => ({
            id: String(album.id),
            name: album.title,
            artist: album.artist?.name || album.albumArtist || undefined,
            year: album.year || undefined,
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
      })
      if (!playlist) {
        return response(request, { error: { code: 70, message: "Playlist not found" } }, "failed")
      }

      const playlistSongs = await getPlaylistSongsForUser(user.id, playlist.id)

      return response(request, {
        playlist: {
          id: String(playlist.id),
          name: playlist.name,
          songCount: playlistSongs.length,
          entry: playlistSongs.map(mapSong),
        },
      })
    }

    if (cmd === "createPlaylist") {
      const name = request.nextUrl.searchParams.get("name")?.trim() || ""
      if (!name) {
        return response(request, { error: { code: 10, message: "Missing playlist name" } }, "failed")
      }

      const songIds = extractSongIds(request)
      const playlist = await prisma.playlist.create({
        data: {
          userId: user.id,
          name,
        },
      })

      if (songIds.length > 0) {
        await replacePlaylistEntriesForUser(user.id, playlist.id, songIds)
      }

      const updatedSongs = await getPlaylistSongsForUser(user.id, playlist.id)

      return response(request, {
        playlist: {
          id: String(playlist.id),
          name: playlist.name,
          songCount: updatedSongs.length,
          entry: updatedSongs.map(mapSong),
        },
      })
    }

    if (cmd === "updatePlaylist") {
      const playlistId = Number.parseInt(request.nextUrl.searchParams.get("playlistId") || "", 10)
      if (!Number.isInteger(playlistId) || playlistId <= 0) {
        return response(request, { error: { code: 10, message: "Missing playlistId" } }, "failed")
      }

      const playlist = await prisma.playlist.findFirst({
        where: { id: playlistId, userId: user.id },
      })
      if (!playlist) {
        return response(request, { error: { code: 70, message: "Playlist not found" } }, "failed")
      }

      const newName = request.nextUrl.searchParams.get("name")?.trim() || null
      const addSongIds = request.nextUrl.searchParams
        .getAll("songIdToAdd")
        .map((raw) => Number.parseInt(raw, 10))
        .filter((id): id is number => Number.isInteger(id) && id > 0)
      const removeIndices = request.nextUrl.searchParams
        .getAll("songIndexToRemove")
        .map((raw) => Number.parseInt(raw, 10))
        .filter((index): index is number => Number.isInteger(index) && index >= 0)

      if (newName) {
        await prisma.playlist.update({
          where: { id: playlist.id },
          data: { name: newName },
        })
      }

      const currentSongs = await getPlaylistSongsForUser(user.id, playlist.id)
      let orderedIds = currentSongs.map((song) => song.id)
      if (removeIndices.length > 0) {
        const removeSet = new Set(removeIndices)
        orderedIds = orderedIds.filter((_songId, index) => !removeSet.has(index))
      }
      if (addSongIds.length > 0) {
        for (const songId of addSongIds) {
          orderedIds.push(songId)
        }
      }
      await replacePlaylistEntriesForUser(user.id, playlist.id, orderedIds)

      return response(request, {})
    }

    if (cmd === "deletePlaylist") {
      const id = Number.parseInt(request.nextUrl.searchParams.get("id") || "", 10)
      if (!Number.isInteger(id) || id <= 0) {
        return response(request, { error: { code: 10, message: "Missing playlist id" } }, "failed")
      }
      const playlist = await prisma.playlist.findFirst({
        where: { id, userId: user.id },
      })
      if (!playlist) {
        return response(request, { error: { code: 70, message: "Playlist not found" } }, "failed")
      }
      await prisma.playlist.delete({ where: { id: playlist.id } })
      return response(request, {})
    }

    if (cmd === "getGenres") {
      const songs = await prisma.song.findMany({
        where: { userId: user.id, genre: { not: null } },
        select: { genre: true },
      })
      const counts = new Map<string, number>()
      for (const song of songs) {
        const genre = song.genre?.trim()
        if (!genre) continue
        counts.set(genre, (counts.get(genre) || 0) + 1)
      }
      return response(request, {
        genres: {
          genre: Array.from(counts.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([value, songCount]) => ({
              value,
              songCount,
            })),
        },
      })
    }

    if (cmd === "getSongsByGenre") {
      const genre = request.nextUrl.searchParams.get("genre")?.trim() || ""
      const count = Math.min(500, Math.max(1, parseIntParam(request.nextUrl.searchParams.get("count"), 50)))
      const offset = Math.max(0, parseIntParam(request.nextUrl.searchParams.get("offset"), 0))
      if (!genre) {
        return response(request, { error: { code: 10, message: "Missing genre" } }, "failed")
      }

      const songs = await prisma.song.findMany({
        where: { userId: user.id, genre: { equals: genre } },
        orderBy: [{ artist: "asc" }, { album: "asc" }, { discNumber: "asc" }, { trackNumber: "asc" }],
        skip: offset,
        take: count,
      })

      return response(request, {
        songsByGenre: {
          song: songs.map(mapSong),
        },
      })
    }

    if (cmd === "getTopSongs") {
      const artistName = request.nextUrl.searchParams.get("artist")?.trim() || ""
      if (!artistName) {
        return response(request, { error: { code: 10, message: "Missing artist" } }, "failed")
      }

      const songs = await prisma.song.findMany({
        where: {
          userId: user.id,
          artist: { equals: artistName },
        },
        orderBy: [{ playCount: "desc" }, { lastPlayedAt: "desc" }, { createdAt: "desc" }],
        take: 50,
      })

      return response(request, {
        topSongs: {
          song: songs.map(mapSong),
        },
      })
    }

    if (cmd === "getAlbumInfo2") {
      const id = Number.parseInt(request.nextUrl.searchParams.get("id") || "", 10)
      if (!Number.isInteger(id) || id <= 0) {
        return response(request, { error: { code: 10, message: "Missing album id" } }, "failed")
      }

      const album = await prisma.album.findFirst({
        where: { id, userId: user.id },
        include: {
          songs: {
            select: { duration: true },
          },
        },
      })
      if (!album) {
        return response(request, { error: { code: 70, message: "Album not found" } }, "failed")
      }

      const songCount = album.songs.length
      const duration = album.songs.reduce((sum, song) => sum + (song.duration || 0), 0)
      return response(request, {
        albumInfo: {
          notes: "",
          musicBrainzId: "",
          smallImageUrl: "",
          mediumImageUrl: "",
          largeImageUrl: "",
          songCount,
          duration,
        },
      })
    }

    if (cmd === "getAlbumInfo") {
      const id = Number.parseInt(request.nextUrl.searchParams.get("id") || "", 10)
      if (!Number.isInteger(id) || id <= 0) {
        return response(request, { error: { code: 10, message: "Missing album id" } }, "failed")
      }

      const album = await prisma.album.findFirst({
        where: { id, userId: user.id },
        include: {
          songs: {
            select: { duration: true },
          },
        },
      })
      if (!album) {
        return response(request, { error: { code: 70, message: "Album not found" } }, "failed")
      }

      const songCount = album.songs.length
      const duration = album.songs.reduce((sum, song) => sum + (song.duration || 0), 0)
      return response(request, {
        albumInfo: {
          notes: "",
          musicBrainzId: "",
          smallImageUrl: "",
          mediumImageUrl: "",
          largeImageUrl: "",
          songCount,
          duration,
        },
      })
    }

    if (cmd === "getArtistInfo") {
      const id = parseNumericId(request.nextUrl.searchParams.get("id"))
      if (!id) {
        return response(request, { error: { code: 10, message: "Missing artist id" } }, "failed")
      }

      const artist = await prisma.artist.findFirst({
        where: { id, userId: user.id },
      })
      if (!artist) {
        return response(request, { error: { code: 70, message: "Artist not found" } }, "failed")
      }

      return response(request, {
        artistInfo: {
          biography: "",
          musicBrainzId: artist.mbid || "",
          lastFmUrl: "",
          smallImageUrl: `/api/subsonic/rest/getCoverArt.view?id=ar-${artist.id}`,
          mediumImageUrl: `/api/subsonic/rest/getCoverArt.view?id=ar-${artist.id}`,
          largeImageUrl: `/api/subsonic/rest/getCoverArt.view?id=ar-${artist.id}`,
          similarArtist: [],
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

      let stat: Awaited<ReturnType<typeof fsPromises.stat>>
      try {
        stat = await fsPromises.stat(resolvedPath)
      } catch {
        return new Response("File not found", { status: 404 })
      }

      const fileSize = stat.size
      const contentType = resolveMimeType(resolvedPath)
      const range = request.headers.get("range")
      if (range) {
        const parsedRange = parseByteRange(range, fileSize)
        if (!parsedRange) {
          return new Response(null, {
            status: 416,
            headers: {
              "Content-Range": `bytes */${fileSize}`,
              "Accept-Ranges": "bytes",
              "Content-Type": contentType,
            },
          })
        }

        const { start, end } = parsedRange
        const chunkSize = end - start + 1
        const stream = fs.createReadStream(resolvedPath, { start, end })
        return new Response(nodeReadableToWebStream(stream), {
          status: 206,
          headers: {
            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
            "Accept-Ranges": "bytes",
            "Content-Length": String(chunkSize),
            "Content-Type": contentType,
          },
        })
      }

      const maxBitRate = parseIntParam(request.nextUrl.searchParams.get("maxBitRate"), 0)
      if (canTranscodeToBitrate(song.bitrate, maxBitRate)) {
        const transcoder = transcodeToMp3(resolvedPath, maxBitRate)
        if (transcoder?.stdout) {
          return new Response(nodeReadableToWebStream(transcoder.stdout), {
            headers: {
              "Content-Type": "audio/mpeg",
              "Accept-Ranges": "none",
            },
          })
        }
      }

      const stream = fs.createReadStream(resolvedPath)
      return new Response(nodeReadableToWebStream(stream), {
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(fileSize),
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

    if (cmd === "getAvatar") {
      const targetUsername = request.nextUrl.searchParams.get("username")?.trim() || user.username
      const target = await prisma.user.findFirst({
        where: { username: targetUsername },
        select: { id: true, role: true, username: true },
      })
      if (!target) {
        return new Response("User not found", { status: 404 })
      }

      const me = await prisma.user.findFirst({
        where: { id: user.id },
        select: { role: true, username: true },
      })
      if (!me) {
        return new Response("User not found", { status: 404 })
      }

      if (target.username !== me.username && me.role !== "admin") {
        return new Response("Not authorized", { status: 403 })
      }

      const song = await prisma.song.findFirst({
        where: { userId: target.id, coverPath: { not: null } },
        select: { coverPath: true },
      })
      const coverPath = song?.coverPath || null
      if (!coverPath) {
        return new Response("Avatar not found", { status: 404 })
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

      const { artists, albums, songs } = await buildSearchResult(
        user.id,
        query,
        artistCount,
        albumCount,
        songCount,
        artistOffset,
        albumOffset,
        songOffset
      )

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

    if (cmd === "search2") {
      const query = request.nextUrl.searchParams.get("query")?.trim() || ""
      if (!query) {
        return response(request, {
          searchResult2: {
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

      const { artists, albums, songs } = await buildSearchResult(
        user.id,
        query,
        artistCount,
        albumCount,
        songCount,
        artistOffset,
        albumOffset,
        songOffset
      )

      return response(request, {
        searchResult2: {
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

    if (cmd === "search") {
      const query = request.nextUrl.searchParams.get("query")?.trim() || ""
      if (!query) {
        return response(request, {
          searchResult: {
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

      const { artists, albums, songs } = await buildSearchResult(
        user.id,
        query,
        artistCount,
        albumCount,
        songCount,
        artistOffset,
        albumOffset,
        songOffset
      )

      return response(request, {
        searchResult: {
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

    if (cmd === "getStarred") {
      const songs = await prisma.song.findMany({
        where: {
          userId: user.id,
          starredAt: { not: null },
        },
        orderBy: [{ starredAt: "desc" }, { id: "desc" }],
        take: 500,
      })

      return response(request, {
        starred: {
          song: songs.map(mapSong),
        },
      })
    }

    if (cmd === "getSimilarSongs2" || cmd === "getSimilarSongs") {
      const id = parseNumericId(request.nextUrl.searchParams.get("id"))
      const count = Math.min(100, Math.max(1, parseIntParam(request.nextUrl.searchParams.get("count"), 50)))
      if (!id) {
        return response(request, { error: { code: 10, message: "Missing song id" } }, "failed")
      }

      const sourceSong = await prisma.song.findFirst({
        where: { id, userId: user.id },
        select: { artist: true, album: true },
      })
      if (!sourceSong) {
        return response(request, { error: { code: 70, message: "Song not found" } }, "failed")
      }

      const similarityFilters: Array<{ artist: string } | { album: string }> = []
      if (sourceSong.artist) {
        similarityFilters.push({ artist: sourceSong.artist })
      }
      if (sourceSong.album) {
        similarityFilters.push({ album: sourceSong.album })
      }

      if (similarityFilters.length === 0) {
        return response(request, {
          [cmd === "getSimilarSongs" ? "similarSongs" : "similarSongs2"]: {
            song: [],
          },
        })
      }

      const similarSongs = await prisma.song.findMany({
        where: {
          userId: user.id,
          id: { not: id },
          OR: similarityFilters,
        },
        orderBy: [{ playCount: "desc" }, { createdAt: "desc" }],
        take: count,
      })

      const payloadKey = cmd === "getSimilarSongs" ? "similarSongs" : "similarSongs2"
      return response(request, {
        [payloadKey]: {
          song: similarSongs.map(mapSong),
        },
      })
    }

    if (cmd === "getLyricsBySongId") {
      const id = parseNumericId(request.nextUrl.searchParams.get("id"))
      if (!id) {
        return response(request, { error: { code: 10, message: "Missing song id" } }, "failed")
      }

      const song = await prisma.song.findFirst({
        where: { id, userId: user.id },
        select: { title: true, artist: true, lyrics: true },
      })
      if (!song) {
        return response(request, { error: { code: 70, message: "Song not found" } }, "failed")
      }

      return response(request, {
        lyricsList: {
          structuredLyrics: [],
          lyrics: song.lyrics
            ? [
                {
                  artist: song.artist || undefined,
                  title: song.title,
                  value: song.lyrics,
                },
              ]
            : [],
        },
      })
    }

    if (cmd === "startScan") {
      const libraries = await prisma.library.findMany({
        where: { userId: user.id },
        select: { id: true },
      })

      let queued = 0
      for (const library of libraries) {
        const result = await enqueueLibraryScan(user.id, library.id)
        if (result.accepted) queued += 1
      }

      return response(request, {
        scanStatus: {
          scanning: queued > 0,
          count: queued,
        },
      })
    }

    if (cmd === "getScanStatus") {
      const active = await prisma.libraryScanRun.count({
        where: {
          library: { userId: user.id },
          status: { in: ["queued", "running"] },
        },
      })
      return response(request, {
        scanStatus: {
          scanning: active > 0,
          count: active,
        },
      })
    }

    if (cmd === "getLyrics") {
      const artist = request.nextUrl.searchParams.get("artist")?.trim() || ""
      const title = request.nextUrl.searchParams.get("title")?.trim() || ""
      if (!artist || !title) {
        return response(request, { error: { code: 10, message: "Missing artist/title" } }, "failed")
      }

      const song = await prisma.song.findFirst({
        where: {
          userId: user.id,
          artist: { equals: artist },
          title: { equals: title },
        },
        select: { title: true, artist: true, lyrics: true },
      })

      return response(request, {
        lyrics: {
          artist,
          title,
          value: song?.lyrics || "",
        },
      })
    }

    return response(request, { error: { code: 0, message: `Unsupported command: ${cmd}` } }, "failed")
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unhandled server error"
    return response(request, { error: { code: 0, message } }, "failed")
  }
}
