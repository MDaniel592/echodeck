import { spawn } from "child_process"
import { createHmac } from "crypto"
import fs from "fs"
import path from "path"
import { Readable } from "stream"
import { pipeline } from "stream/promises"
import type { ReadableStream as NodeReadableStream } from "stream/web"
import { getFfmpegDir } from "./binaries"
import { runWithConcurrency } from "./asyncPool"
import { waitRandomDelay } from "./downloadThrottle"

const DOWNLOADS_DIR = path.join(process.cwd(), "downloads")
const LUCIDA_BASE_URL = (process.env.LUCIDA_BASE_URL || "https://api.lucida.to").replace(/\/+$/, "")
const SPOTFETCH_API_URL = (process.env.SPOTFETCH_API_URL || "https://spotify.afkarxyz.fun/api").replace(/\/+$/, "")
const SONGLINK_API_URL = "https://api.song.link/v1-alpha.1/links?url="
const AMAZON_TRACK_API_BASE_URL = "https://amazon.afkarxyz.fun/api/track/"
const TIDAL_TRACK_API_BASE_URLS = [
  "https://triton.squid.wtf",
  "https://hifi-one.spotisaver.net",
  "https://hifi-two.spotisaver.net",
  "https://tidal.kinoplus.online",
  "https://tidal-api.binimum.org",
]

const SPOTIFY_PUBLIC_API_TOKEN_URL =
  "https://open.spotify.com/api/token?reason=init&productType=web-player"
const SPOTIFY_WEB_TOKEN_URL =
  "https://open.spotify.com/get_access_token?reason=transport&productType=web_player"

function readEnv(name: string): string | null {
  const value = process.env[name]?.trim()
  return value && value.length > 0 ? value : null
}

function requireProviderEnv(provider: string, names: string[]): string[] {
  const values = names.map((name) => readEnv(name))
  const missing = names.filter((_, index) => !values[index])
  if (missing.length > 0) {
    throw new Error(
      `${provider} provider skipped: missing ${missing.join(", ")} env var(s). ` +
      `Set them in .env to enable ${provider} matching.`
    )
  }
  return values as string[]
}

const QUALITY_RANK: Record<string, number> = {
  "24-bit/192kHz": 7,
  "24-bit/96kHz": 6,
  "24-bit/44.1kHz": 5,
  "16-bit/44.1kHz": 4,
  lossless: 3,
  high: 2,
  standard: 1,
}

const SOURCE_LIMIT_PER_PROVIDER = 5
const SPOTIFY_DOWNLOAD_CONCURRENCY = 4
const SPOTIFY_DOWNLOAD_DELAY_MIN_MS = 1000
const SPOTIFY_DOWNLOAD_DELAY_MAX_MS = 3000

type SpotifyType = "track" | "playlist" | "album" | "artist"
type ProviderName = "tidal" | "deezer" | "qobuz" | "amazon"

export interface SpotdlDownloadOptions {
  url: string
  format: "mp3" | "flac" | "wav" | "ogg"
  concurrency?: number
  shouldDownloadTrack?: (
    track: {
      title: string
      artists: string[]
      sourceUrl: string | null
    },
    context: { index: number; total: number }
  ) => Promise<boolean> | boolean
}

export interface SpotdlDownloadResult {
  filePath: string
  title: string
  artist: string | null
  album: string | null
  albumArtist: string | null
  trackNumber: number | null
  discNumber: number | null
  isrc: string | null
  duration: number | null
  fileSize: number | null
  format: "mp3" | "flac" | "wav" | "ogg"
  thumbnail: string | null
  sourceUrl: string | null
  quality: string | null
  releaseDate: string | null
}

interface SpotifyTrack {
  id: string
  title: string
  artists: string[]
  duration: number | null
  thumbnail: string | null
  albumName: string | null
  releaseDate: string | null
  trackNumber: number | null
  discNumber: number | null
  isrc: string | null
  sourceUrl: string | null
}

export interface SpotifySearchResult {
  provider: "spotify"
  title: string
  artist: string | null
  url: string
  duration: number | null
  thumbnail: string | null
  album: string | null
}

interface TrackMetadata {
  trackName: string
  artistName: string
  albumName: string | null
  duration: number | null
  coverArt: string | null
  releaseDate: string | null
  quality: string
  source: string
  sourceId: string | null
  sourceUrl: string | null
}

interface ProviderMatch {
  service: ProviderName
  quality: string
  downloadUrl: string
  similarity: number
  metadata: TrackMetadata
  decryptionKey?: string | null
}

interface ProviderCandidate {
  queryTitle: string
  queryArtist: string
  similarity: number
  metadata: TrackMetadata
}

interface SpotifyImage {
  url?: string
}

interface SpotifyArtist {
  name?: string
}

interface SpotifyAlbum {
  id?: string
  name?: string
  release_date?: string
  images?: SpotifyImage[]
}

interface SpotifyTrackItem {
  id?: string
  name?: string
  duration_ms?: number
  disc_number?: number
  track_number?: number
  external_ids?: { isrc?: string }
  artists?: SpotifyArtist[]
  album?: SpotifyAlbum
  external_urls?: {
    spotify?: string
  }
}

let spotifyTokenCache: { token: string; expiresAt: number } | null = null
let tidalTokenCache: { token: string; expiresAt: number } | null = null
let qobuzTokenCache: { token: string; expiresAt: number } | null = null

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null) {
    return value as Record<string, unknown>
  }
  return null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function readString(record: Record<string, unknown> | null, key: string): string | null {
  if (!record) return null
  const value = record[key]
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function readNumber(record: Record<string, unknown> | null, key: string): number | null {
  if (!record) return null
  return toFiniteNumber(record[key])
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return null
}

function summarizeErrorBody(body: string, maxLength = 280): string {
  const compact = body.replace(/\s+/g, " ").trim()
  if (!compact) return ""
  if (compact.length <= maxLength) return compact
  return `${compact.slice(0, maxLength)}...`
}

function generateSpotifyWebTotp(): { code: string; version: number } {
  const secrets: Record<number, number[]> = {
    59: [
      123, 105, 79, 70, 110, 59, 52, 125, 60, 49, 80, 70, 89, 75, 80, 86,
      63, 53, 123, 37, 117, 49, 52, 93, 77, 62, 47, 86, 48, 104, 68, 72,
    ],
    60: [
      79, 109, 69, 123, 90, 65, 46, 74, 94, 34, 58, 48, 70, 71, 92, 85,
      122, 63, 91, 64, 87, 87,
    ],
    61: [
      44, 55, 47, 42, 70, 40, 34, 114, 76, 74, 50, 111, 120, 97, 75, 76,
      94, 102, 43, 69, 49, 120, 118, 80, 64, 78,
    ],
  }

  const version = 61
  const base = secrets[version]
  const transformed = base.map((byte, index) => byte ^ ((index % 33) + 9))
  const secretBytes = Buffer.from(transformed.map((value) => String(value)).join(""), "utf8")

  const counter = Math.floor(Date.now() / 1000 / 30)
  const counterBuffer = Buffer.alloc(8)
  counterBuffer.writeBigUInt64BE(BigInt(counter))

  const hmac = createHmac("sha1", secretBytes).update(counterBuffer).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)

  const code = (binary % 1_000_000).toString().padStart(6, "0")
  return { code, version }
}

function sanitizeFileNameSegment(value: string, fallback: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!cleaned) return fallback
  return cleaned.slice(0, 80)
}

function extFromContentType(contentType: string | null): string | null {
  if (!contentType) return null
  const normalized = contentType.toLowerCase()

  if (normalized.includes("flac")) return "flac"
  if (normalized.includes("mpeg")) return "mp3"
  if (normalized.includes("wav")) return "wav"
  if (normalized.includes("ogg")) return "ogg"
  if (normalized.includes("aac")) return "aac"
  if (normalized.includes("mp4")) return "m4a"
  if (normalized.includes("webm")) return "webm"

  return null
}

function extFromUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl)
    const ext = path.extname(parsed.pathname).replace(/^\./, "").toLowerCase()
    return ext || null
  } catch {
    return null
  }
}

function normalizeExtension(ext: string | null): string | null {
  if (!ext) return null
  const normalized = ext.toLowerCase().replace(/^\./, "")
  if (normalized === "m4a") return "m4a"
  if (normalized === "mp4") return "m4a"
  if (normalized === "opus") return "opus"
  if (normalized === "webm") return "webm"
  if (normalized === "mp3") return "mp3"
  if (normalized === "flac") return "flac"
  if (normalized === "wav") return "wav"
  if (normalized === "ogg") return "ogg"
  if (normalized === "aac") return "aac"
  return null
}

function normalizeQualityLabel(rawQuality: string | null): string {
  if (!rawQuality) return "standard"
  const normalized = rawQuality.toLowerCase()

  if (normalized.includes("24") && normalized.includes("192")) return "24-bit/192kHz"
  if (normalized.includes("24") && normalized.includes("96")) return "24-bit/96kHz"
  if (normalized.includes("24") && normalized.includes("44")) return "24-bit/44.1kHz"
  if (normalized.includes("16") && normalized.includes("44")) return "16-bit/44.1kHz"
  if (normalized.includes("lossless")) return "lossless"
  if (normalized.includes("high")) return "high"
  if (normalized.includes("standard")) return "standard"

  return rawQuality
}

function qualityRank(label: string | null): number {
  if (!label) return 0
  const normalized = normalizeQualityLabel(label)
  return QUALITY_RANK[normalized] ?? 0
}

function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\[\](){}\-_.]/g, " ")
    .replace(/\s+(feat|ft|featuring)\.?\s+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = []
  for (let i = 0; i <= str2.length; i += 1) {
    matrix[i] = [i]
  }
  for (let j = 0; j <= str1.length; j += 1) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= str2.length; i += 1) {
    for (let j = 1; j <= str1.length; j += 1) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        )
      }
    }
  }

  return matrix[str2.length][str1.length]
}

function stringSimilarity(str1: string, str2: string): number {
  if (!str1 || !str2) return 0

  const s1 = normalizeString(str1)
  const s2 = normalizeString(str2)

  if (s1 === s2) return 100
  if (s1.includes(s2) || s2.includes(s1)) return 90

  const words1 = s1.split(/\s+/)
  const words2 = s2.split(/\s+/)

  let matchCount = 0
  words1.forEach((word1) => {
    words2.forEach((word2) => {
      if (word1 === word2) {
        matchCount += 1
      } else if (word1.includes(word2) || word2.includes(word1)) {
        matchCount += 0.8
      } else if (
        word1.length > 3 &&
        word2.length > 3 &&
        levenshteinDistance(word1, word2) <= 1
      ) {
        matchCount += 0.6
      }
    })
  })

  const maxWords = Math.max(words1.length, words2.length)
  return Math.round((matchCount / maxWords) * 100)
}

function calculateOverallSimilarity(metadata1: TrackMetadata, metadata2: TrackMetadata): number {
  const weights = {
    trackName: 0.4,
    artistName: 0.3,
    albumName: 0.2,
    duration: 0.1,
  }

  const trackSimilarity = stringSimilarity(metadata1.trackName, metadata2.trackName)
  const artistSimilarity = stringSimilarity(metadata1.artistName, metadata2.artistName)
  const albumSimilarity = metadata1.albumName && metadata2.albumName
    ? stringSimilarity(metadata1.albumName, metadata2.albumName)
    : 50

  let durationSimilarity = 50
  if (metadata1.duration && metadata2.duration) {
    const diff = Math.abs(metadata1.duration - metadata2.duration)
    durationSimilarity = diff <= 3 ? 100 : diff <= 7 ? 80 : diff <= 15 ? 60 : diff <= 30 ? 30 : 0
  }

  return Math.round(
    trackSimilarity * weights.trackName +
    artistSimilarity * weights.artistName +
    albumSimilarity * weights.albumName +
    durationSimilarity * weights.duration
  )
}

function isLikelyMatch(similarity: number): boolean {
  return similarity >= 45
}

function spotifyTypeAndId(spotifyUrl: string): { type: SpotifyType; id: string } | null {
  const match = spotifyUrl.match(/spotify\.com\/(?:intl-[a-z-]+\/)?(track|playlist|album|artist)\/([A-Za-z0-9]+)/i)
  if (!match) return null

  const type = match[1].toLowerCase() as SpotifyType
  const id = match[2]

  if (!id) return null
  return { type, id }
}

function firstImageUrl(images: SpotifyImage[] | undefined): string | null {
  if (!Array.isArray(images) || images.length === 0) return null
  for (const image of images) {
    if (image && typeof image.url === "string" && image.url.trim()) {
      return image.url
    }
  }
  return null
}

function mapSpotifyTrack(track: SpotifyTrackItem, albumOverride?: SpotifyAlbum): SpotifyTrack | null {
  const id = typeof track.id === "string" && track.id.trim() ? track.id : null
  const title = typeof track.name === "string" && track.name.trim() ? track.name : null
  if (!id || !title) return null

  const artists = Array.isArray(track.artists)
    ? track.artists
      .map((artist) => (typeof artist?.name === "string" ? artist.name.trim() : ""))
      .filter(Boolean)
    : []

  const album = track.album ?? albumOverride
  const duration = typeof track.duration_ms === "number" && Number.isFinite(track.duration_ms)
    ? Math.round(track.duration_ms / 1000)
    : null

  return {
    id,
    title,
    artists,
    duration,
    thumbnail: firstImageUrl(album?.images),
    albumName: album?.name ?? null,
    releaseDate: album?.release_date ?? null,
    trackNumber: typeof track.track_number === "number" && Number.isFinite(track.track_number) ? track.track_number : null,
    discNumber: typeof track.disc_number === "number" && Number.isFinite(track.disc_number) ? track.disc_number : null,
    isrc:
      typeof track.external_ids?.isrc === "string" && track.external_ids.isrc.trim()
        ? track.external_ids.isrc.trim()
        : null,
    sourceUrl: track.external_urls?.spotify ?? (id ? `https://open.spotify.com/track/${id}` : null),
  }
}

function spotifyApiUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    return pathOrUrl
  }
  return `https://api.spotify.com/v1${pathOrUrl}`
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function spotifyFetchJson<T>(pathOrUrl: string, token: string): Promise<T> {
  const response = await fetchWithTimeout(
    spotifyApiUrl(pathOrUrl),
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "echodeck/1.0",
      },
    },
    20000
  )

  if (!response.ok) {
    const retryAfter = response.headers.get("retry-after")
    const retryInfo = retryAfter ? ` Retry-After: ${retryAfter}s.` : ""
    const body = summarizeErrorBody(await response.text().catch(() => ""))
    throw new Error(`Spotify API error (${response.status}).${retryInfo}${body ? ` ${body}` : ""}`)
  }

  return (await response.json()) as T
}

async function getSpotifyAccessToken(): Promise<string> {
  if (spotifyTokenCache && Date.now() < spotifyTokenCache.expiresAt - 60_000) {
    return spotifyTokenCache.token
  }

  const tokenErrors: string[] = []

  // Match SpotiFLAC behavior first: fetch Spotify web-player token (no account).
  try {
    const totp = generateSpotifyWebTotp()
    const apiTokenUrl =
      `${SPOTIFY_PUBLIC_API_TOKEN_URL}` +
      `&totp=${encodeURIComponent(totp.code)}` +
      `&totpVer=${totp.version}` +
      `&totpServer=${encodeURIComponent(totp.code)}`

    const response = await fetchWithTimeout(
      apiTokenUrl,
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json;charset=UTF-8",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
        },
      },
      15000
    )

    if (!response.ok) {
      const body = summarizeErrorBody(await response.text().catch(() => ""))
      tokenErrors.push(`open_api token failed (${response.status})${body ? `: ${body}` : ""}`)
    } else {
      const data = (await response.json()) as {
        accessToken?: string
        accessTokenExpirationTimestampMs?: number
      }

      if (!data.accessToken) {
        tokenErrors.push("open_api token response did not include accessToken")
      } else {
        const expiresAt =
          typeof data.accessTokenExpirationTimestampMs === "number"
            ? data.accessTokenExpirationTimestampMs
            : Date.now() + 60 * 60 * 1000

        spotifyTokenCache = {
          token: data.accessToken,
          expiresAt,
        }
        return data.accessToken
      }
    }
  } catch (error) {
    tokenErrors.push(
      `open_api token error: ${error instanceof Error ? error.message : "Unknown error"}`
    )
  }

  try {
    const response = await fetchWithTimeout(
      SPOTIFY_WEB_TOKEN_URL,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
          Referer: "https://open.spotify.com/",
          Origin: "https://open.spotify.com",
        },
      },
      15000
    )

    if (!response.ok) {
      const body = summarizeErrorBody(await response.text().catch(() => ""))
      tokenErrors.push(`web_player token failed (${response.status})${body ? `: ${body}` : ""}`)
    } else {
      const data = (await response.json()) as {
        accessToken?: string
        accessTokenExpirationTimestampMs?: number
      }

      if (!data.accessToken) {
        tokenErrors.push("web_player response did not include accessToken")
      } else {
        const expiresAt =
          typeof data.accessTokenExpirationTimestampMs === "number"
            ? data.accessTokenExpirationTimestampMs
            : Date.now() + 60 * 60 * 1000

        spotifyTokenCache = {
          token: data.accessToken,
          expiresAt,
        }
        return data.accessToken
      }
    }
  } catch (error) {
    tokenErrors.push(
      `web_player token error: ${error instanceof Error ? error.message : "Unknown error"}`
    )
  }

  const explicitAuthToken = process.env.SPOTIFY_AUTH_TOKEN?.trim()
  if (explicitAuthToken) {
    spotifyTokenCache = {
      token: explicitAuthToken,
      expiresAt: Date.now() + 15 * 60 * 1000,
    }
    return explicitAuthToken
  }

  const spotifyClientId = process.env.SPOTIFY_CLIENT_ID?.trim()
  const spotifyClientSecret = process.env.SPOTIFY_CLIENT_SECRET?.trim()
  if (spotifyClientId && spotifyClientSecret) {
    try {
      const auth = Buffer.from(`${spotifyClientId}:${spotifyClientSecret}`).toString("base64")
      const response = await fetchWithTimeout(
        "https://accounts.spotify.com/api/token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${auth}`,
            "User-Agent": "echodeck/1.0",
          },
          body: new URLSearchParams({
            grant_type: "client_credentials",
          }).toString(),
        },
        15000
      )

      if (!response.ok) {
        const body = summarizeErrorBody(await response.text().catch(() => ""))
        tokenErrors.push(
          `client_credentials failed (${response.status})${body ? `: ${body}` : ""}`
        )
      } else {
        const data = (await response.json()) as {
          access_token?: string
          expires_in?: number
        }

        if (!data.access_token) {
          tokenErrors.push("client_credentials response did not include access_token")
        } else {
          const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600
          spotifyTokenCache = {
            token: data.access_token,
            expiresAt: Date.now() + expiresIn * 1000,
          }
          return data.access_token
        }
      }
    } catch (error) {
      tokenErrors.push(
        `client_credentials error: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    }
  }

  const details = tokenErrors.length ? ` ${tokenErrors.join(" | ")}` : ""
  throw new Error(
    "Failed to get Spotify web token (no-account flow)." +
    details
  )
}

async function getSpotifyTracks(type: SpotifyType, id: string, token: string): Promise<SpotifyTrack[]> {
  const tracks: SpotifyTrack[] = []

  if (type === "track") {
    const track = await spotifyFetchJson<SpotifyTrackItem>(`/tracks/${id}`, token)
    const mapped = mapSpotifyTrack(track)
    return mapped ? [mapped] : []
  }

  if (type === "playlist") {
    let endpoint = `/playlists/${id}/tracks?limit=100&offset=0`

    while (endpoint) {
      const data = await spotifyFetchJson<{
        items?: Array<{ track?: SpotifyTrackItem | null; is_local?: boolean }>
        next?: string | null
      }>(endpoint, token)

      const items = Array.isArray(data.items) ? data.items : []
      for (const item of items) {
        if (item?.is_local) continue
        if (!item?.track) continue
        const mapped = mapSpotifyTrack(item.track)
        if (mapped) tracks.push(mapped)
      }

      endpoint = data.next ?? ""
    }

    return tracks
  }

  if (type === "album") {
    const album = await spotifyFetchJson<{
      name?: string
      release_date?: string
      images?: SpotifyImage[]
      tracks?: {
        items?: SpotifyTrackItem[]
        next?: string | null
      }
    }>(`/albums/${id}`, token)

    const albumInfo: SpotifyAlbum = {
      id,
      name: album.name,
      release_date: album.release_date,
      images: album.images,
    }

    const initialItems = Array.isArray(album.tracks?.items) ? album.tracks?.items : []
    for (const item of initialItems) {
      const mapped = mapSpotifyTrack(item, albumInfo)
      if (mapped) tracks.push(mapped)
    }

    let endpoint = album.tracks?.next ?? ""
    while (endpoint) {
      const data = await spotifyFetchJson<{
        items?: SpotifyTrackItem[]
        next?: string | null
      }>(endpoint, token)

      const items = Array.isArray(data.items) ? data.items : []
      for (const item of items) {
        const mapped = mapSpotifyTrack(item, albumInfo)
        if (mapped) tracks.push(mapped)
      }

      endpoint = data.next ?? ""
    }

    return tracks
  }

  if (type === "artist") {
    const data = await spotifyFetchJson<{
      tracks?: SpotifyTrackItem[]
    }>(`/artists/${id}/top-tracks?market=US`, token)

    const items = Array.isArray(data.tracks) ? data.tracks : []
    for (const item of items) {
      const mapped = mapSpotifyTrack(item)
      if (mapped) tracks.push(mapped)
    }

    return tracks
  }

  return tracks
}

export async function searchSpotifyTracks(query: string, limit = 5): Promise<SpotifySearchResult[]> {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) return []
  const safeLimit = Math.min(Math.max(limit, 1), 25)
  const token = await getSpotifyAccessToken()

  const payload = await spotifyFetchJson<{
    tracks?: {
      items?: SpotifyTrackItem[]
    }
  }>(`/search?type=track&limit=${safeLimit}&q=${encodeURIComponent(trimmedQuery)}`, token)

  const items = Array.isArray(payload?.tracks?.items) ? payload.tracks.items : []
  return items
    .map((item) => mapSpotifyTrack(item))
    .filter((item): item is SpotifyTrack => item !== null)
    .map((item) => ({
      provider: "spotify" as const,
      title: item.title,
      artist: item.artists.join(", ") || null,
      url: item.sourceUrl || `https://open.spotify.com/track/${item.id}`,
      duration: item.duration,
      thumbnail: item.thumbnail,
      album: item.albumName,
    }))
}

function extractSpotifyTrackId(sourceUrl: string | null): string | null {
  if (!sourceUrl) return null
  const match = sourceUrl.match(/spotify\.com\/track\/([A-Za-z0-9]+)/i)
  return match?.[1] ?? null
}

function parseArtistsList(value: string | null): string[] {
  if (!value) return []
  const normalized = value.replace(/\s*&\s*/g, ", ")
  return normalized
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
}

function mapSpotFetchTrack(record: Record<string, unknown>, index: number): SpotifyTrack | null {
  const title = readString(record, "name") || readString(record, "title")
  if (!title) return null

  const artistsRaw =
    readString(record, "artists") ||
    readString(record, "artist") ||
    readString(record, "album_artist")
  const artists = parseArtistsList(artistsRaw)

  const sourceUrl = readString(record, "external_urls") || readString(record, "external_url")
  const spotifyId = readString(record, "spotify_id") || extractSpotifyTrackId(sourceUrl)

  const durationRaw = readNumber(record, "duration_ms") ?? readNumber(record, "duration")
  const duration =
    durationRaw && durationRaw > 1000
      ? Math.round(durationRaw / 1000)
      : durationRaw
        ? Math.round(durationRaw)
        : null

  return {
    id: spotifyId || `spotfetch-${Date.now()}-${index + 1}`,
    title,
    artists,
    duration,
    thumbnail: readString(record, "images") || readString(record, "cover"),
    albumName: readString(record, "album_name") || readString(record, "album"),
    releaseDate: readString(record, "release_date"),
    trackNumber: readNumber(record, "track_number"),
    discNumber: readNumber(record, "disc_number"),
    isrc: readString(record, "isrc"),
    sourceUrl: sourceUrl || (spotifyId ? `https://open.spotify.com/track/${spotifyId}` : null),
  }
}

async function fetchSpotFetchPayload(type: SpotifyType, id: string): Promise<unknown> {
  const response = await fetchWithTimeout(
    `${SPOTFETCH_API_URL}/${type}/${id}`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
      },
    },
    25000
  )

  if (!response.ok) {
    const body = summarizeErrorBody(await response.text().catch(() => ""))
    throw new Error(`SpotFetch API failed (${response.status})${body ? `: ${body}` : ""}`)
  }

  return await response.json()
}

async function getSpotifyTracksViaSpotFetchApi(type: SpotifyType, id: string): Promise<SpotifyTrack[]> {
  const payload = await fetchSpotFetchPayload(type, id)
  const root = asRecord(payload)
  if (!root) return []

  if (type === "track") {
    const single = asRecord(root.track) || root
    if (!single) return []
    const mapped = mapSpotFetchTrack(single, 0)
    return mapped ? [mapped] : []
  }

  const rows = [
    ...asArray(root.track_list),
    ...asArray(root.tracks),
    ...asArray(root.items),
  ]

  const mapped = rows
    .map((row, index) => mapSpotFetchTrack(asRecord(row) || {}, index))
    .filter((track): track is SpotifyTrack => track !== null)

  if (mapped.length === 0) {
    return []
  }

  const deduped = new Map<string, SpotifyTrack>()
  for (const track of mapped) {
    if (!deduped.has(track.id)) {
      deduped.set(track.id, track)
    }
  }

  return [...deduped.values()]
}

function extractSongLinkTrackId(track: SpotifyTrack): string | null {
  if (track.id && !track.id.startsWith("spotfetch-")) {
    return track.id
  }
  return extractSpotifyTrackId(track.sourceUrl)
}

function extractTidalTrackId(tidalUrl: string): string | null {
  const match = tidalUrl.match(/\/track\/(\d+)/i)
  return match?.[1] ?? null
}

function extractAmazonAsin(amazonUrl: string): string | null {
  const trackAsinMatch = amazonUrl.match(/[?&]trackAsin=([A-Z0-9]{10})/i)
  if (trackAsinMatch) return trackAsinMatch[1].toUpperCase()

  const pathAsinMatch = amazonUrl.match(/\/tracks\/([A-Z0-9]{10})/i)
  if (pathAsinMatch) return pathAsinMatch[1].toUpperCase()

  const genericAsinMatch = amazonUrl.match(/\b(B[0-9A-Z]{9})\b/i)
  if (genericAsinMatch) return genericAsinMatch[1].toUpperCase()

  return null
}

function mapAmazonQuality(streamUrl: string | null): string {
  if (!streamUrl) return "high"
  const upper = streamUrl.toUpperCase()
  if (upper.includes("UHD_192")) return "24-bit/192kHz"
  if (upper.includes("UHD_96")) return "24-bit/96kHz"
  if (upper.includes("UHD")) return "24-bit/44.1kHz"
  if (upper.includes("HD")) return "lossless"
  return "high"
}

async function getSongLinkPlatforms(
  spotifyTrackId: string
): Promise<{ tidalUrl: string | null; amazonUrl: string | null }> {
  const spotifyTrackUrl = `https://open.spotify.com/track/${spotifyTrackId}`
  const response = await fetchWithTimeout(
    `${SONGLINK_API_URL}${encodeURIComponent(spotifyTrackUrl)}&userCountry=US`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
      },
    },
    20000
  )

  if (!response.ok) {
    const body = summarizeErrorBody(await response.text().catch(() => ""))
    throw new Error(`song.link failed (${response.status})${body ? `: ${body}` : ""}`)
  }

  const payload = (await response.json().catch(() => null)) as unknown
  const root = asRecord(payload)
  const linksByPlatform = asRecord(root?.linksByPlatform)

  const tidal = asRecord(linksByPlatform?.tidal)
  const amazonMusic = asRecord(linksByPlatform?.amazonMusic)

  return {
    tidalUrl: readString(tidal, "url"),
    amazonUrl: readString(amazonMusic, "url"),
  }
}

async function resolveTidalViaSongLink(
  track: SpotifyTrack,
  tidalUrl: string
): Promise<ProviderMatch | null> {
  const trackId = extractTidalTrackId(tidalUrl)
  if (!trackId) return null

  for (const apiBase of TIDAL_TRACK_API_BASE_URLS) {
    try {
      const response = await fetchWithTimeout(
        `${apiBase}/track/?id=${encodeURIComponent(trackId)}&quality=LOSSLESS`,
        {
          headers: {
            Accept: "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
          },
        },
        20000
      )

      if (!response.ok) {
        continue
      }

      const payload = (await response.json().catch(() => null)) as unknown
      const root = asRecord(payload)

      let downloadUrl: string | null = null
      let quality = "lossless"

      const data = asRecord(root?.data)
      if (data) {
        const audioQuality = readString(data, "audioQuality")
        if (audioQuality) {
          quality = normalizeQualityLabel(audioQuality)
        }

        const manifestEncoded = readString(data, "manifest")
        if (manifestEncoded) {
          try {
            const decoded = Buffer.from(manifestEncoded, "base64").toString("utf8")
            const manifest = asRecord(JSON.parse(decoded) as unknown)
            const urls = asArray(manifest?.urls)
            if (urls.length > 0 && typeof urls[0] === "string" && urls[0].trim()) {
              downloadUrl = (urls[0] as string).trim()
            }
          } catch {
            // ignore and try other payload shapes
          }
        }
      }

      if (!downloadUrl) {
        const direct = readString(root, "OriginalTrackUrl") || readString(root, "originalTrackUrl")
        if (direct) {
          downloadUrl = direct
        } else if (Array.isArray(payload)) {
          for (const row of payload) {
            const item = asRecord(row)
            const url =
              readString(item, "OriginalTrackUrl") ||
              readString(item, "originalTrackUrl")
            if (url) {
              downloadUrl = url
              break
            }
          }
        }
      }

      if (!downloadUrl) {
        continue
      }

      return {
        service: "tidal",
        quality,
        downloadUrl,
        similarity: 0,
        metadata: {
          trackName: track.title,
          artistName: track.artists.join(", "),
          albumName: track.albumName,
          duration: track.duration,
          coverArt: track.thumbnail,
          releaseDate: track.releaseDate,
          quality,
          source: "tidal",
          sourceId: trackId,
          sourceUrl: tidalUrl,
        },
      }
    } catch {
      // try next API
    }
  }

  return null
}

async function resolveAmazonViaSongLink(
  track: SpotifyTrack,
  amazonUrl: string
): Promise<ProviderMatch | null> {
  const asin = extractAmazonAsin(amazonUrl)
  if (!asin) return null

  const response = await fetchWithTimeout(
    `${AMAZON_TRACK_API_BASE_URL}${encodeURIComponent(asin)}`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
      },
    },
    25000
  )

  if (!response.ok) {
    return null
  }

  const payload = (await response.json().catch(() => null)) as unknown
  const root = asRecord(payload)
  const streamUrl = readString(root, "streamUrl")
  if (!streamUrl) {
    return null
  }

  const decryptionKey = readString(root, "decryptionKey")
  const quality = mapAmazonQuality(streamUrl)

  return {
    service: "amazon",
    quality,
    downloadUrl: streamUrl,
    similarity: 0,
    decryptionKey,
    metadata: {
      trackName: track.title,
      artistName: track.artists.join(", "),
      albumName: track.albumName,
      duration: track.duration,
      coverArt: track.thumbnail,
      releaseDate: track.releaseDate,
      quality,
      source: "amazon",
      sourceId: asin,
      sourceUrl: amazonUrl,
    },
  }
}

async function resolveViaSongLink(
  track: SpotifyTrack,
  onProgress: (message: string) => void
): Promise<ProviderMatch | null> {
  const spotifyTrackId = extractSongLinkTrackId(track)
  if (!spotifyTrackId) {
    return null
  }

  const platforms = await getSongLinkPlatforms(spotifyTrackId)
  const candidates: ProviderMatch[] = []

  if (platforms.tidalUrl) {
    onProgress("Trying Tidal via song.link...")
    const tidal = await resolveTidalViaSongLink(track, platforms.tidalUrl)
    if (tidal) candidates.push(tidal)
  }

  if (platforms.amazonUrl) {
    onProgress("Trying Amazon via song.link...")
    const amazon = await resolveAmazonViaSongLink(track, platforms.amazonUrl)
    if (amazon) candidates.push(amazon)
  }

  if (candidates.length === 0) {
    return null
  }

  candidates.sort((a, b) => qualityRank(b.quality) - qualityRank(a.quality))
  return candidates[0]
}

function toTargetMetadata(track: SpotifyTrack): TrackMetadata {
  return {
    trackName: track.title,
    artistName: track.artists.join(", "),
    albumName: track.albumName,
    duration: track.duration,
    coverArt: track.thumbnail,
    releaseDate: track.releaseDate,
    quality: "standard",
    source: "spotify",
    sourceId: track.id,
    sourceUrl: track.sourceUrl,
  }
}

async function pollLucidaDownloadUrl(service: ProviderName, jobId: string): Promise<string | null> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000))

    const response = await fetchWithTimeout(
      `${LUCIDA_BASE_URL}/${service}/status/${encodeURIComponent(jobId)}`,
      {
        headers: {
          "User-Agent": "echodeck/1.0",
        },
      },
      15000
    )

    if (!response.ok) {
      continue
    }

    const raw = (await response.json().catch(() => null)) as unknown
    const record = asRecord(raw)
    if (!record) continue

    const directUrl = readString(record, "url")
    if (directUrl) {
      return directUrl
    }

    const data = asRecord(record.data)
    const nestedUrl = readString(data, "url")
    if (nestedUrl) {
      return nestedUrl
    }

    const status = (readString(record, "status") || readString(data, "status") || "").toLowerCase()
    if (status.includes("error") || status.includes("failed")) {
      return null
    }
  }

  return null
}

async function requestLucidaDownloadUrl(
  service: ProviderName,
  query: { title: string; artist: string }
): Promise<string | null> {
  const response = await fetchWithTimeout(
    `${LUCIDA_BASE_URL}/${service}/play`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "echodeck/1.0",
      },
      body: JSON.stringify({ query }),
    },
    20000
  )

  if (!response.ok) {
    return null
  }

  const raw = (await response.json().catch(() => null)) as unknown
  const data = asRecord(raw)
  if (!data) {
    return null
  }

  const directUrl = readString(data, "url")
  if (directUrl) {
    return directUrl
  }

  const nestedData = asRecord(data.data)
  const nestedUrl = readString(nestedData, "url")
  if (nestedUrl) {
    return nestedUrl
  }

  const jobId = readString(data, "jobId") || readString(nestedData, "jobId")
  if (jobId) {
    return pollLucidaDownloadUrl(service, jobId)
  }

  return null
}

function bestCandidates(candidates: ProviderCandidate[]): ProviderCandidate[] {
  const sorted = [...candidates].sort((a, b) => b.similarity - a.similarity)
  const likely = sorted.filter((candidate) => isLikelyMatch(candidate.similarity))
  return (likely.length ? likely : sorted).slice(0, SOURCE_LIMIT_PER_PROVIDER)
}

async function searchDeezer(track: SpotifyTrack): Promise<ProviderMatch | null> {
  const query = `${track.title} ${track.artists.join(" ")}`
  const response = await fetchWithTimeout(
    `https://api.deezer.com/search?q=${encodeURIComponent(query)}`,
    {
      headers: {
        "User-Agent": "echodeck/1.0",
      },
    },
    20000
  )

  if (!response.ok) {
    return null
  }

  const payload = (await response.json().catch(() => null)) as unknown
  const root = asRecord(payload)
  const rows = asArray(root?.data)
  if (rows.length === 0) {
    return null
  }

  const target = toTargetMetadata(track)
  const candidates: ProviderCandidate[] = []

  for (const row of rows) {
    const item = asRecord(row)
    if (!item) continue

    const artist = asRecord(item.artist)
    const album = asRecord(item.album)

    const title = readString(item, "title") || readString(item, "title_short")
    const artistName = readString(artist, "name")
    if (!title || !artistName) continue

    const metadata: TrackMetadata = {
      trackName: title,
      artistName,
      albumName: readString(album, "title"),
      duration: readNumber(item, "duration"),
      coverArt:
        readString(album, "cover_xl") ||
        readString(album, "cover_big") ||
        readString(album, "cover"),
      releaseDate: null,
      quality: "lossless",
      source: "deezer",
      sourceId: readString(item, "id") || String(readNumber(item, "id") ?? ""),
      sourceUrl: readString(item, "link"),
    }

    candidates.push({
      queryTitle: title,
      queryArtist: artistName,
      similarity: calculateOverallSimilarity(metadata, target),
      metadata,
    })
  }

  for (const candidate of bestCandidates(candidates)) {
    const downloadUrl = await requestLucidaDownloadUrl("deezer", {
      title: candidate.queryTitle,
      artist: candidate.queryArtist,
    })

    if (downloadUrl) {
      return {
        service: "deezer",
        quality: normalizeQualityLabel(candidate.metadata.quality),
        downloadUrl,
        similarity: candidate.similarity,
        metadata: candidate.metadata,
      }
    }
  }

  return null
}

async function getTidalToken(): Promise<string | null> {
  if (tidalTokenCache && Date.now() < tidalTokenCache.expiresAt - 60_000) {
    return tidalTokenCache.token
  }
  const [tidalBasicAuth, tidalTokenHeader] = requireProviderEnv("Tidal", [
    "TIDAL_BASIC_AUTH",
    "TIDAL_TOKEN_HEADER",
  ])

  const response = await fetchWithTimeout(
    "https://auth.tidal.com/v1/oauth2/token",
    {
      method: "POST",
      headers: {
        Authorization: tidalBasicAuth,
        "x-tidal-token": tidalTokenHeader,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "echodeck/1.0",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: "r_usr+w_usr+w_sub",
      }).toString(),
    },
    15000
  )

  if (!response.ok) {
    return null
  }

  const data = (await response.json().catch(() => null)) as
    | {
      access_token?: string
      expires_in?: number
    }
    | null

  if (!data?.access_token) {
    return null
  }

  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600
  tidalTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  }

  return data.access_token
}

async function searchTidal(track: SpotifyTrack): Promise<ProviderMatch | null> {
  const token = await getTidalToken()
  if (!token) {
    return null
  }

  const query = `${track.title} ${track.artists.join(" ")}`
  const response = await fetchWithTimeout(
    `https://openapi.tidal.com/v2/searchresults/${encodeURIComponent(query)}?countryCode=US&include=artists,albums,tracks&limit=20`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.api+json",
        "User-Agent": "echodeck/1.0",
      },
    },
    20000
  )

  if (!response.ok) {
    return null
  }

  const payload = (await response.json().catch(() => null)) as unknown
  const root = asRecord(payload)
  const included = asArray(root?.included)
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => item !== null)

  const trackItems = included.filter((item) => readString(item, "type") === "tracks")
  if (trackItems.length === 0) {
    return null
  }

  const target = toTargetMetadata(track)
  const candidates: ProviderCandidate[] = []

  for (const trackItem of trackItems) {
    const attributes = asRecord(trackItem.attributes)
    const relationships = asRecord(trackItem.relationships)

    const artistRel = asRecord(relationships?.artists)
    const artistRelData = asArray(artistRel?.data)
    const artistId = readString(asRecord(artistRelData[0]), "id")

    const albumRel = asRecord(relationships?.albums)
    const albumRelData = asArray(albumRel?.data)
    const albumId = readString(asRecord(albumRelData[0]), "id")

    const artistItem = included.find(
      (item) => readString(item, "type") === "artists" && readString(item, "id") === artistId
    )
    const albumItem = included.find(
      (item) => readString(item, "type") === "albums" && readString(item, "id") === albumId
    )

    const artistAttrs = asRecord(artistItem?.attributes)
    const albumAttrs = asRecord(albumItem?.attributes)

    const title = readString(attributes, "title")
    const artistName = readString(artistAttrs, "name")
    if (!title || !artistName) continue

    const coverImageId = readString(albumAttrs, "image")
    const coverArt = coverImageId
      ? `https://resources.tidal.com/images/${coverImageId.replace(/-/g, "/")}/1280x1280.jpg`
      : null

    const rawQuality = readString(attributes, "audioQuality")
    const normalizedQuality = normalizeQualityLabel(rawQuality)

    const metadata: TrackMetadata = {
      trackName: title,
      artistName,
      albumName: readString(albumAttrs, "title"),
      duration: readNumber(attributes, "duration"),
      coverArt,
      releaseDate: readString(albumAttrs, "releaseDate"),
      quality: normalizedQuality || "lossless",
      source: "tidal",
      sourceId: readString(trackItem, "id"),
      sourceUrl: readString(trackItem, "id")
        ? `https://tidal.com/browse/track/${readString(trackItem, "id")}`
        : null,
    }

    candidates.push({
      queryTitle: title,
      queryArtist: artistName,
      similarity: calculateOverallSimilarity(metadata, target),
      metadata,
    })
  }

  for (const candidate of bestCandidates(candidates)) {
    const downloadUrl = await requestLucidaDownloadUrl("tidal", {
      title: candidate.queryTitle,
      artist: candidate.queryArtist,
    })

    if (downloadUrl) {
      return {
        service: "tidal",
        quality: normalizeQualityLabel(candidate.metadata.quality),
        downloadUrl,
        similarity: candidate.similarity,
        metadata: candidate.metadata,
      }
    }
  }

  return null
}

async function getQobuzToken(): Promise<string | null> {
  if (qobuzTokenCache && Date.now() < qobuzTokenCache.expiresAt - 5 * 60_000) {
    return qobuzTokenCache.token
  }
  const [qobuzAppId, qobuzLoginEmail, qobuzLoginPasswordMd5] = requireProviderEnv("Qobuz", [
    "QOBUZ_APP_ID",
    "QOBUZ_LOGIN_EMAIL",
    "QOBUZ_LOGIN_PASSWORD_MD5",
  ])

  const loginUrl =
    `https://www.qobuz.com/api.json/0.2/user/login?app_id=${encodeURIComponent(qobuzAppId)}` +
    `&email=${encodeURIComponent(qobuzLoginEmail)}` +
    `&password_md5=${encodeURIComponent(qobuzLoginPasswordMd5)}`

  const response = await fetchWithTimeout(
    loginUrl,
    {
      headers: {
        "User-Agent": "echodeck/1.0",
      },
    },
    15000
  )

  if (!response.ok) {
    return null
  }

  const data = (await response.json().catch(() => null)) as { user_auth_token?: string } | null
  if (!data?.user_auth_token) {
    return null
  }

  qobuzTokenCache = {
    token: data.user_auth_token,
    expiresAt: Date.now() + 60 * 60 * 1000,
  }

  return data.user_auth_token
}

async function searchQobuz(track: SpotifyTrack): Promise<ProviderMatch | null> {
  const [qobuzAppId] = requireProviderEnv("Qobuz", ["QOBUZ_APP_ID"])
  const token = await getQobuzToken()
  if (!token) {
    return null
  }

  const query = `${track.title} ${track.artists.join(" ")}`
  const response = await fetchWithTimeout(
    `https://www.qobuz.com/api.json/0.2/track/search?query=${encodeURIComponent(query)}&limit=20&app_id=${encodeURIComponent(qobuzAppId)}`,
    {
      headers: {
        "X-User-Auth-Token": token,
        "User-Agent": "echodeck/1.0",
      },
    },
    20000
  )

  if (!response.ok) {
    return null
  }

  const payload = (await response.json().catch(() => null)) as unknown
  const root = asRecord(payload)
  const tracksRecord = asRecord(root?.tracks)
  const rows = asArray(tracksRecord?.items)
  if (rows.length === 0) {
    return null
  }

  const target = toTargetMetadata(track)
  const candidates: ProviderCandidate[] = []

  for (const row of rows) {
    const item = asRecord(row)
    if (!item) continue

    const performer = asRecord(item.performer)
    const album = asRecord(item.album)
    const albumImage = asRecord(album?.image)

    const title = readString(item, "title")
    const artistName = readString(performer, "name")
    if (!title || !artistName) continue

    const bitDepth = readNumber(item, "maximum_bit_depth")
    const sampleRate = readNumber(item, "maximum_sampling_rate")

    let quality = "lossless"
    if (bitDepth && sampleRate) {
      quality = `${bitDepth}-bit/${sampleRate}kHz`
    } else if (bitDepth) {
      quality = `${bitDepth}-bit`
    } else if (sampleRate) {
      quality = `${sampleRate}kHz`
    }

    const metadata: TrackMetadata = {
      trackName: title,
      artistName,
      albumName: readString(album, "title"),
      duration: readNumber(item, "duration"),
      coverArt:
        readString(albumImage, "large") ||
        readString(albumImage, "small") ||
        readString(albumImage, "thumbnail"),
      releaseDate: readString(album, "release_date_original"),
      quality,
      source: "qobuz",
      sourceId: readString(item, "id") || String(readNumber(item, "id") ?? ""),
      sourceUrl: readString(album, "id")
        ? `https://www.qobuz.com/us-en/album/unknown/${readString(album, "id")}`
        : null,
    }

    candidates.push({
      queryTitle: title,
      queryArtist: artistName,
      similarity: calculateOverallSimilarity(metadata, target),
      metadata,
    })
  }

  for (const candidate of bestCandidates(candidates)) {
    const downloadUrl = await requestLucidaDownloadUrl("qobuz", {
      title: candidate.queryTitle,
      artist: candidate.queryArtist,
    })

    if (downloadUrl) {
      return {
        service: "qobuz",
        quality: normalizeQualityLabel(candidate.metadata.quality),
        downloadUrl,
        similarity: candidate.similarity,
        metadata: candidate.metadata,
      }
    }
  }

  return null
}

async function searchAmazon(track: SpotifyTrack): Promise<ProviderMatch | null> {
  const [amazonApiKey] = requireProviderEnv("Amazon", ["AMAZON_API_KEY"])
  const query = `${track.title} ${track.artists.join(" ")}`

  const response = await fetchWithTimeout(
    `https://api.music.amazon.dev/search?query=${encodeURIComponent(query)}&limit=20&type=track`,
    {
      headers: {
        "x-api-key": amazonApiKey,
        "User-Agent": "echodeck/1.0",
      },
    },
    20000
  )

  if (!response.ok) {
    return null
  }

  const payload = (await response.json().catch(() => null)) as unknown
  const root = asRecord(payload)
  const rows = [
    ...asArray(root?.tracks),
    ...asArray(root?.data),
  ]

  if (rows.length === 0) {
    return null
  }

  const target = toTargetMetadata(track)
  const candidates: ProviderCandidate[] = []

  for (const row of rows) {
    const item = asRecord(row)
    if (!item) continue

    const artists = asArray(item.artists)
      .map((artist) => {
        const artistRecord = asRecord(artist)
        return readString(artistRecord, "name")
      })
      .filter((name): name is string => Boolean(name))

    const album = asRecord(item.album)
    const artwork = asRecord(item.artwork)

    const title = readString(item, "title") || readString(item, "name")
    const artistName = artists.join(", ")
    if (!title || !artistName) continue

    const durationSeconds =
      readNumber(item, "duration") ??
      (readNumber(item, "duration_ms") ? Math.round((readNumber(item, "duration_ms") as number) / 1000) : null)

    const quality = normalizeQualityLabel(readString(item, "audioQuality") || "high")

    const metadata: TrackMetadata = {
      trackName: title,
      artistName,
      albumName: readString(album, "title") || readString(album, "name"),
      duration: durationSeconds,
      coverArt: readString(artwork, "url"),
      releaseDate: readString(item, "release_date"),
      quality,
      source: "amazon",
      sourceId: readString(item, "id") || String(readNumber(item, "id") ?? ""),
      sourceUrl: readString(item, "url"),
    }

    candidates.push({
      queryTitle: title,
      queryArtist: artists[0] || artistName,
      similarity: calculateOverallSimilarity(metadata, target),
      metadata,
    })
  }

  for (const candidate of bestCandidates(candidates)) {
    const downloadUrl = await requestLucidaDownloadUrl("amazon", {
      title: candidate.queryTitle,
      artist: candidate.queryArtist,
    })

    if (downloadUrl) {
      return {
        service: "amazon",
        quality: normalizeQualityLabel(candidate.metadata.quality),
        downloadUrl,
        similarity: candidate.similarity,
        metadata: candidate.metadata,
      }
    }
  }

  return null
}

async function resolveProviderMatch(
  track: SpotifyTrack,
  onProgress: (message: string) => void
): Promise<ProviderMatch | null> {
  const settled = await Promise.allSettled([
    searchTidal(track),
    searchDeezer(track),
    searchQobuz(track),
    searchAmazon(track),
  ])

  const matches: ProviderMatch[] = []

  for (const result of settled) {
    if (result.status === "fulfilled" && result.value) {
      matches.push(result.value)
      continue
    }

    if (result.status === "rejected") {
      const errorMessage =
        result.reason instanceof Error
          ? result.reason.message
          : "Unknown provider error"
      onProgress(`Provider lookup skipped: ${errorMessage}`)
    }
  }

  if (matches.length === 0) {
    try {
      const viaSongLink = await resolveViaSongLink(track, onProgress)
      if (viaSongLink) {
        return viaSongLink
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unknown song.link fallback error"
      onProgress(`song.link fallback skipped: ${errorMessage}`)
    }
    return null
  }

  matches.sort((a, b) => {
    const qualityDiff = qualityRank(b.quality) - qualityRank(a.quality)
    if (qualityDiff !== 0) return qualityDiff
    return b.similarity - a.similarity
  })

  return matches[0]
}

function transcodeArgsForFormat(format: SpotdlDownloadOptions["format"]): string[] {
  if (format === "mp3") {
    return ["-codec:a", "libmp3lame", "-q:a", "2"]
  }
  if (format === "flac") {
    return ["-codec:a", "flac", "-compression_level", "8"]
  }
  if (format === "wav") {
    return ["-codec:a", "pcm_s16le"]
  }
  return ["-codec:a", "libvorbis", "-q:a", "6"]
}

function transcodeAudio(
  inputPath: string,
  outputPath: string,
  format: SpotdlDownloadOptions["format"],
  onProgress: (message: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = path.join(getFfmpegDir(), "ffmpeg")
    if (!fs.existsSync(ffmpeg)) {
      reject(new Error("ffmpeg not found. Install ffmpeg-static."))
      return
    }

    const args = [
      "-y",
      "-i", inputPath,
      "-vn",
      ...transcodeArgsForFormat(format),
      outputPath,
    ]

    const proc = spawn(ffmpeg, args)
    let stderr = ""

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })

    proc.on("error", (error) => {
      reject(new Error(`Failed to start ffmpeg: ${error.message}`))
    })

    proc.on("close", (code) => {
      if (code === 0) {
        onProgress(`Transcoding complete: ${path.basename(outputPath)}`)
        resolve()
        return
      }

      reject(new Error(`ffmpeg transcoding failed (${code}): ${stderr}`))
    })
  })
}

function decryptAndTranscodeAudio(
  inputPath: string,
  outputPath: string,
  format: SpotdlDownloadOptions["format"],
  decryptionKey: string,
  onProgress: (message: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = path.join(getFfmpegDir(), "ffmpeg")
    if (!fs.existsSync(ffmpeg)) {
      reject(new Error("ffmpeg not found. Install ffmpeg-static."))
      return
    }

    const args = [
      "-y",
      "-decryption_key", decryptionKey,
      "-i", inputPath,
      "-vn",
      ...transcodeArgsForFormat(format),
      outputPath,
    ]

    const proc = spawn(ffmpeg, args)
    let stderr = ""

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })

    proc.on("error", (error) => {
      reject(new Error(`Failed to start ffmpeg decryption: ${error.message}`))
    })

    proc.on("close", (code) => {
      if (code === 0) {
        onProgress(`Decryption/transcoding complete: ${path.basename(outputPath)}`)
        resolve()
        return
      }
      reject(new Error(`ffmpeg decrypt/transcode failed (${code}): ${stderr}`))
    })
  })
}

async function downloadToFile(
  downloadUrl: string,
  track: SpotifyTrack,
  index: number,
  format: SpotdlDownloadOptions["format"],
  decryptionKey: string | null | undefined,
  onProgress: (message: string) => void
): Promise<{ filePath: string; fileSize: number | null }> {
  const safeArtist = sanitizeFileNameSegment(track.artists[0] || "Unknown Artist", "Unknown Artist")
  const safeTitle = sanitizeFileNameSegment(track.title || `Track ${index + 1}`, `Track ${index + 1}`)
  const uniquePrefix = `${Date.now()}-${index + 1}`

  const response = await fetchWithTimeout(
    downloadUrl,
    {
      headers: {
        "User-Agent": "echodeck/1.0",
      },
      redirect: "follow",
    },
    120000
  )

  if (!response.ok || !response.body) {
    throw new Error(`Failed to download audio (${response.status})`)
  }

  const sourceExt =
    normalizeExtension(extFromUrl(response.url)) ||
    normalizeExtension(extFromContentType(response.headers.get("content-type"))) ||
    "flac"

  const sourcePath = path.join(DOWNLOADS_DIR, `${uniquePrefix}-${safeArtist} - ${safeTitle}.source.${sourceExt}`)
  const outputPath = path.join(DOWNLOADS_DIR, `${uniquePrefix}-${safeArtist} - ${safeTitle}.${format}`)

  const totalSize = Number(response.headers.get("content-length") || "0")
  let downloaded = 0
  let nextProgressThreshold = 25

  const readStream = Readable.fromWeb(
    response.body as unknown as NodeReadableStream<Uint8Array>
  )
  readStream.on("data", (chunk: Buffer | string) => {
    downloaded += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length
    if (totalSize > 0) {
      const percent = Math.floor((downloaded / totalSize) * 100)
      if (percent >= nextProgressThreshold) {
        onProgress(`Downloading ${track.title}: ${percent}%`)
        nextProgressThreshold += 25
      }
    }
  })

  await pipeline(readStream, fs.createWriteStream(sourcePath))

  if (decryptionKey) {
    onProgress(`Decrypting ${track.title}...`)
    await decryptAndTranscodeAudio(sourcePath, outputPath, format, decryptionKey, onProgress)
    try {
      fs.unlinkSync(sourcePath)
    } catch {
      // ignore cleanup error
    }
  } else if (sourceExt === format) {
    fs.renameSync(sourcePath, outputPath)
  } else {
    onProgress(`Transcoding ${track.title} to ${format.toUpperCase()}...`)
    await transcodeAudio(sourcePath, outputPath, format, onProgress)
    try {
      fs.unlinkSync(sourcePath)
    } catch {
      // ignore cleanup error
    }
  }

  const stats = fs.statSync(outputPath)
  return {
    filePath: outputPath,
    fileSize: stats.size,
  }
}

export async function downloadSpotify(
  options: SpotdlDownloadOptions,
  onProgress: (message: string) => void
): Promise<SpotdlDownloadResult[]> {
  const { url, format, shouldDownloadTrack } = options
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? SPOTIFY_DOWNLOAD_CONCURRENCY))

  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true })

  const parsed = spotifyTypeAndId(url)
  if (!parsed) {
    throw new Error("Unsupported Spotify URL. Use track, playlist, album, or artist links.")
  }

  onProgress(`Resolving Spotify ${parsed.type} metadata...`)

  let tracks: SpotifyTrack[] = []
  const metadataErrors: string[] = []

  try {
    const spotifyToken = await getSpotifyAccessToken()
    tracks = await getSpotifyTracks(parsed.type, parsed.id, spotifyToken)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Spotify metadata error"
    metadataErrors.push(summarizeErrorBody(message))
    onProgress("Spotify web metadata blocked, trying SpotFetch API...")
  }

  if (tracks.length === 0) {
    try {
      tracks = await getSpotifyTracksViaSpotFetchApi(parsed.type, parsed.id)
      if (tracks.length > 0) {
        onProgress(`SpotFetch API resolved ${tracks.length} Spotify track(s).`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown SpotFetch API error"
      metadataErrors.push(summarizeErrorBody(message))
    }
  }

  if (tracks.length === 0) {
    const details = metadataErrors.length ? ` ${metadataErrors.join(" | ")}` : ""
    throw new Error(`No Spotify tracks found for this URL.${details}`)
  }

  onProgress(`Found ${tracks.length} Spotify track(s).`)

  const results: Array<SpotdlDownloadResult | null> = Array.from({ length: tracks.length }, () => null)
  let skippedByPolicy = 0

  await runWithConcurrency(tracks, concurrency, async (track, index) => {
    let shouldThrottle = false
    const artistLabel = track.artists.join(", ") || "Unknown Artist"

    try {
      if (shouldDownloadTrack) {
        const shouldDownload = await shouldDownloadTrack(
          {
            title: track.title,
            artists: track.artists,
            sourceUrl: track.sourceUrl,
          },
          { index, total: tracks.length }
        )

        if (!shouldDownload) {
          skippedByPolicy += 1
          onProgress(`[${index + 1}/${tracks.length}] Already in library, skipping download.`)
          return
        }
      }

      onProgress(`[${index + 1}/${tracks.length}] Matching: ${track.title} - ${artistLabel}`)

      const match = await resolveProviderMatch(track, onProgress)
      if (!match) {
        onProgress(`[${index + 1}/${tracks.length}] No provider match found, skipping.`)
        return
      }

      onProgress(
        `[${index + 1}/${tracks.length}] Using ${match.service.toUpperCase()} (${match.quality}).`
      )

      shouldThrottle = true
      const downloaded = await downloadToFile(
        match.downloadUrl,
        track,
        index,
        format,
        match.decryptionKey,
        onProgress
      )

      results[index] = {
        filePath: downloaded.filePath,
        title: track.title,
        artist: artistLabel,
        album: track.albumName,
        albumArtist: artistLabel,
        trackNumber: track.trackNumber,
        discNumber: track.discNumber,
        isrc: track.isrc,
        duration: track.duration,
        fileSize: downloaded.fileSize,
        format,
        thumbnail: track.thumbnail || match.metadata.coverArt,
        sourceUrl: track.sourceUrl,
        quality: match.quality,
        releaseDate: track.releaseDate,
      }

      onProgress(`[${index + 1}/${tracks.length}] Downloaded ${track.title}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Spotify track error"
      onProgress(`[${index + 1}/${tracks.length}] Failed: ${summarizeErrorBody(message)}`)
    } finally {
      if (shouldThrottle) {
        const delayMs = await waitRandomDelay(SPOTIFY_DOWNLOAD_DELAY_MIN_MS, SPOTIFY_DOWNLOAD_DELAY_MAX_MS)
        onProgress(`[${index + 1}/${tracks.length}] Cooldown ${Math.round(delayMs / 100) / 10}s`)
      }
    }
  })

  const downloadedResults = results.filter((result): result is SpotdlDownloadResult => Boolean(result))

  if (downloadedResults.length === 0 && skippedByPolicy === 0) {
    throw new Error("Unable to download any tracks from this Spotify URL")
  }

  return downloadedResults
}
