import { NextRequest, NextResponse } from "next/server"
import path from "path"
import { normalizeSongTitle } from "./songTitle"

type SubsonicSong = {
  id: number
  title: string
  artist: string | null
  album: string | null
  coverPath?: string | null
  artistId?: number | null
  duration: number | null
  trackNumber: number | null
  year: number | null
  genre: string | null
  starredAt?: Date | null
  playCount?: number
  rating?: number | null
  albumId?: number | null
  createdAt?: Date | null
  filePath?: string | null
  format?: string | null
  bitrate?: number | null
  replayGainTrackDb?: number | null
  replayGainAlbumDb?: number | null
  replayGainTrackPeak?: number | null
  replayGainAlbumPeak?: number | null
}

export function subsonicResponse(
  request: NextRequest,
  payload: Record<string, unknown>,
  status = "ok"
) {
  const format = request.nextUrl.searchParams.get("f") || "json"
  const root = {
    status,
    version: "1.16.1",
    type: "EchoDeck",
    openSubsonic: true,
    serverVersion: "1.0.0",
    ...payload,
  }

  if (format === "json") {
    return NextResponse.json({
      "subsonic-response": root,
    })
  }

  if (format !== "xml") {
    return NextResponse.json(
      {
        "subsonic-response": {
          ...root,
          error: { code: 0, message: "Unsupported format. Use json or xml." },
        },
      },
      { status: 400 }
    )
  }

  const attrs = `status="${xmlEscape(status)}" version="1.16.1" type="EchoDeck" openSubsonic="true" serverVersion="1.0.0" xmlns="http://subsonic.org/restapi"`
  const xmlBody = objectToXml(payload)
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<subsonic-response ${attrs}>${xmlBody}</subsonic-response>`

  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  })
}

export function mapSubsonicSong(song: SubsonicSong) {
  const coverArtId = song.albumId
    ? `al-${song.albumId}`
    : song.coverPath
      ? String(song.id)
      : undefined
  const duration = typeof song.duration === "number" && song.duration > 0 ? song.duration : undefined
  const track = typeof song.trackNumber === "number" && song.trackNumber > 0 ? song.trackNumber : undefined

  return {
    id: String(song.id),
    isDir: false,
    type: "music",
    title: normalizeSongTitle(song.title || "Unknown title"),
    artist: song.artist || "",
    album: song.album || "",
    albumId: song.albumId ? String(song.albumId) : "",
    artistId: song.artistId ? String(song.artistId) : "",
    coverArt: coverArtId,
    duration,
    track,
    year: song.year || 1970,
    genre: song.genre || "",
    suffix: song.format || undefined,
    contentType: song.filePath ? resolveMediaMimeType(song.filePath) : undefined,
    bitRate:
      typeof song.bitrate === "number" && Number.isFinite(song.bitrate) && song.bitrate > 0
        ? Math.round(song.bitrate / 1000)
        : undefined,
    created: song.createdAt ? song.createdAt.toISOString() : undefined,
    starred: song.starredAt ? song.starredAt.toISOString() : undefined,
    playCount: song.playCount ?? 0,
    userRating: song.rating ?? undefined,
    ...(buildReplayGainObject(song)),
  }
}

function buildReplayGainObject(song: SubsonicSong): Record<string, unknown> {
  const rg = song.replayGainTrackDb ?? song.replayGainAlbumDb
  if (typeof rg !== "number") return {}
  return {
    replayGain: {
      ...(typeof song.replayGainTrackDb === "number" ? { trackGain: song.replayGainTrackDb } : {}),
      ...(typeof song.replayGainAlbumDb === "number" ? { albumGain: song.replayGainAlbumDb } : {}),
      ...(typeof song.replayGainTrackPeak === "number" ? { trackPeak: song.replayGainTrackPeak } : {}),
      ...(typeof song.replayGainAlbumPeak === "number" ? { albumPeak: song.replayGainAlbumPeak } : {}),
    },
  }
}

export function parseIntParam(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}

export function parseNumericId(raw: string | null): number | null {
  const value = Number.parseInt(raw || "", 10)
  return Number.isInteger(value) && value > 0 ? value : null
}

export function resolveMediaMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === ".mp3") return "audio/mpeg"
  if (ext === ".flac") return "audio/flac"
  if (ext === ".wav") return "audio/wav"
  if (ext === ".ogg" || ext === ".oga") return "audio/ogg"
  if (ext === ".opus") return "audio/opus"
  if (ext === ".aac") return "audio/aac"
  if (ext === ".m4a" || ext === ".mp4") return "audio/mp4"
  if (ext === ".webm" || ext === ".weba") return "audio/webm"
  if (ext === ".png") return "image/png"
  if (ext === ".webp") return "image/webp"
  if (ext === ".gif") return "image/gif"
  return "image/jpeg"
}

export function parseByteRange(
  rangeHeader: string,
  fileSize: number
): { start: number; end: number } | null {
  if (fileSize <= 0) return null

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
  if (!match) return null

  const [, startPart, endPart] = match
  if (!startPart && !endPart) return null

  if (!startPart) {
    const suffixLength = Number(endPart)
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return null
    const start = Math.max(fileSize - suffixLength, 0)
    return { start, end: fileSize - 1 }
  }

  const start = Number(startPart)
  if (!Number.isInteger(start) || start < 0 || start >= fileSize) return null

  if (!endPart) {
    return { start, end: fileSize - 1 }
  }

  const end = Number(endPart)
  if (!Number.isInteger(end) || end < start) return null
  return { start, end: Math.min(end, fileSize - 1) }
}

export function mapSubsonicUser(row: { username: string; role: "admin" | "user" }) {
  const adminRole = row.role === "admin"
  return {
    username: row.username,
    scrobblingEnabled: true,
    adminRole,
    settingsRole: adminRole,
    downloadRole: true,
    uploadRole: adminRole,
    playlistRole: true,
    coverArtRole: true,
    commentRole: true,
    podcastRole: adminRole,
    streamRole: true,
    jukeboxRole: true,
    shareRole: true,
    videoConversionRole: false,
  }
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function objectToXml(value: unknown, keyName?: string): string {
  if (value === null || value === undefined) return ""

  if (Array.isArray(value)) {
    return value.map((entry) => objectToXml(entry, keyName)).join("")
  }

  if (typeof value === "object") {
    if (!keyName) {
      return Object.entries(value as Record<string, unknown>)
        .map(([key, val]) => objectToXml(val, key))
        .join("")
    }

    const record = value as Record<string, unknown>
    const attributes: Array<[string, string]> = []
    const children: Array<[string, unknown]> = []

    for (const [key, val] of Object.entries(record)) {
      if (val === null || val === undefined) continue
      if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
        attributes.push([key, String(val)])
      } else {
        children.push([key, val])
      }
    }

    const childXml = children.map(([key, val]) => objectToXml(val, key)).join("")

    const attrText = attributes
      .map(([key, val]) => ` ${key}="${xmlEscape(val)}"`)
      .join("")

    if (!childXml) {
      return `<${keyName}${attrText}/>`
    }
    return `<${keyName}${attrText}>${childXml}</${keyName}>`
  }

  if (!keyName) return ""
  return `<${keyName}>${xmlEscape(String(value))}</${keyName}>`
}
