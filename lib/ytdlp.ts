import { spawn } from "child_process"
import path from "path"
import fs from "fs"
import { getYtdlpPath, getFfmpegDir } from "./binaries"

const DOWNLOADS_DIR = path.join(process.cwd(), "downloads")

export interface VideoInfo {
  title: string
  artist: string | null
  album: string | null
  albumArtist: string | null
  trackNumber: number | null
  discNumber: number | null
  genre: string | null
  isrc: string | null
  year: number | null
  duration: number | null
  thumbnail: string | null
  formats: string[]
}

export interface PlaylistEntryInfo {
  id: string
  url: string
  title: string
  artist: string | null
  duration: number | null
  thumbnail: string | null
}

export interface PlaylistInfo {
  id: string | null
  title: string
  entries: PlaylistEntryInfo[]
}

export interface DownloadOptions {
  url: string
  format: "opus" | "flac"
  quality: "256" | "192" | "128" | "96" | "64"
}

export interface DownloadResult {
  filePath: string
  format: string
  title: string
  artist: string | null
  duration: number | null
  thumbnail: string | null
  fileSize: number | null
}

export interface SourceSearchResult {
  provider: "youtube" | "soundcloud"
  title: string
  artist: string | null
  url: string
  duration: number | null
  thumbnail: string | null
}

interface ThumbnailCandidate {
  url?: string
  width?: number
  height?: number
}

interface ParsedVideoInfo {
  id?: string
  url?: string
  title?: string
  track?: string
  track_number?: number | string
  disc_number?: number | string
  genre?: string
  genres?: string[]
  isrc?: string
  artist?: string
  creator?: string
  uploader?: string
  album?: string
  album_artist?: string
  release_year?: number | string
  release_date?: string
  upload_date?: string
  timestamp?: number
  duration?: number
  thumbnail?: string
  thumbnails?: ThumbnailCandidate[]
  entries?: ParsedVideoInfo[]
  webpage_url?: string
  original_url?: string
}

function resolveYtdlpJsRuntimes(): string {
  const configured = (process.env.YTDLP_JS_RUNTIMES || "").trim()
  return configured || "node"
}

export function buildYtdlpArgs(baseArgs: string[]): string[] {
  return ["--js-runtimes", resolveYtdlpJsRuntimes(), ...baseArgs]
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function parseYearValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const year = Math.trunc(value)
    return year >= 1000 && year <= 9999 ? year : null
  }
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null

  // ytdlp date fields often use YYYYMMDD format.
  const yyyymmdd = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (yyyymmdd) {
    const year = Number.parseInt(yyyymmdd[1], 10)
    return year >= 1000 && year <= 9999 ? year : null
  }

  const yearOnly = trimmed.match(/^(\d{4})$/)
  if (yearOnly) {
    const year = Number.parseInt(yearOnly[1], 10)
    return year >= 1000 && year <= 9999 ? year : null
  }

  const parsedDate = new Date(trimmed)
  if (!Number.isNaN(parsedDate.getTime())) {
    const year = parsedDate.getUTCFullYear()
    return year >= 1000 && year <= 9999 ? year : null
  }

  return null
}

function parseTimestampYear(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  const parsedDate = new Date(value * 1000)
  if (Number.isNaN(parsedDate.getTime())) return null
  const year = parsedDate.getUTCFullYear()
  return year >= 1000 && year <= 9999 ? year : null
}

function parsePositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = Math.trunc(value)
    return parsed > 0 ? parsed : null
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return null
}

function pickGenre(info: ParsedVideoInfo): string | null {
  if (typeof info.genre === "string" && info.genre.trim()) return info.genre.trim()
  if (Array.isArray(info.genres)) {
    for (const item of info.genres) {
      if (typeof item === "string" && item.trim()) return item.trim()
    }
  }
  return null
}

function inferYearFromParsedInfo(info: ParsedVideoInfo): number | null {
  return (
    parseYearValue(info.release_year) ||
    parseYearValue(info.release_date) ||
    parseYearValue(info.upload_date) ||
    parseTimestampYear(info.timestamp)
  )
}

function ytdlpEnv() {
  const dir = getFfmpegDir()
  return {
    ...process.env,
    PATH: `${dir}:${process.env.PATH}`,
  }
}

function normalizedThumbnailUrl(value: string): string {
  try {
    const parsed = new URL(value)
    parsed.search = ""
    return parsed.toString()
  } catch {
    return value
  }
}

function thumbnailUrlTier(value: string): number {
  const url = value.toLowerCase()
  if (url.includes("maxresdefault")) return 5
  if (url.includes("sddefault")) return 4
  if (url.includes("hqdefault")) return 3
  if (url.includes("mqdefault")) return 2
  if (url.includes("/default")) return 1
  return 0
}

function isApproximatelySquare(width: number, height: number): boolean {
  if (width <= 0 || height <= 0) return false
  const ratio = width / height
  return ratio >= 0.9 && ratio <= 1.1
}

function rankThumbnailCandidates(
  a: { url: string; width: number; height: number },
  b: { url: string; width: number; height: number }
): number {
  const areaDiff = b.width * b.height - a.width * a.height
  if (areaDiff !== 0) return areaDiff

  const tierDiff = thumbnailUrlTier(b.url) - thumbnailUrlTier(a.url)
  if (tierDiff !== 0) return tierDiff

  return b.url.length - a.url.length
}

function pickBestThumbnail(candidates: ThumbnailCandidate[]): string | null {
  const valid = candidates
    .map((candidate) => ({
      url: typeof candidate.url === "string" ? candidate.url.trim() : "",
      width: numeric(candidate.width),
      height: numeric(candidate.height),
    }))
    .filter((candidate) => candidate.url.length > 0)

  if (valid.length === 0) {
    return null
  }

  const deduped = new Map<string, { url: string; width: number; height: number }>()
  for (const candidate of valid) {
    const key = normalizedThumbnailUrl(candidate.url)
    const existing = deduped.get(key)
    if (!existing || candidate.width * candidate.height > existing.width * existing.height) {
      deduped.set(key, candidate)
    }
  }

  const dedupedValues = Array.from(deduped.values())
  const squareCandidates = dedupedValues.filter((candidate) =>
    isApproximatelySquare(candidate.width, candidate.height)
  )

  const ranked = (squareCandidates.length > 0 ? squareCandidates : dedupedValues).sort(rankThumbnailCandidates)

  return ranked[0]?.url ?? null
}

function pickInfoRoot(parsed: ParsedVideoInfo): ParsedVideoInfo {
  return Array.isArray(parsed.entries) && parsed.entries.length > 0
    ? parsed.entries[0]
    : parsed
}

function collectThumbnailCandidates(info: ParsedVideoInfo): ThumbnailCandidate[] {
  const thumbnailCandidates: ThumbnailCandidate[] = []
  if (typeof info.thumbnail === "string" && info.thumbnail.trim()) {
    thumbnailCandidates.push({ url: info.thumbnail })
  }
  if (Array.isArray(info.thumbnails)) {
    for (const thumb of info.thumbnails) {
      if (typeof thumb?.url === "string" && thumb.url.trim()) {
        thumbnailCandidates.push({
          url: thumb.url,
          width: thumb.width,
          height: thumb.height,
        })
      }
    }
  }
  return thumbnailCandidates
}

function fetchVideoInfoJson(url: string, extraArgs: string[] = []): Promise<ParsedVideoInfo> {
  return new Promise((resolve, reject) => {
    const bin = getYtdlpPath()
    if (!fs.existsSync(bin)) {
      reject(new Error("yt-dlp not found. Run: npm run setup"))
      return
    }

    const args = buildYtdlpArgs(["--dump-single-json", "--no-download", "--no-playlist", ...extraArgs, url])
    const proc = spawn(bin, args, { env: ytdlpEnv() })

    let stdout = ""
    let stderr = ""

    proc.stdout.on("data", (data) => {
      stdout += data.toString()
    })
    proc.stderr.on("data", (data) => {
      stderr += data.toString()
    })
    proc.on("error", (err) => {
      reject(new Error(`Failed to start yt-dlp: ${err.message}`))
    })
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp info failed: ${stderr}`))
        return
      }
      try {
        resolve(JSON.parse(stdout.trim()) as ParsedVideoInfo)
      } catch {
        reject(new Error("Failed to parse yt-dlp output"))
      }
    })
  })
}

export async function getPlaylistInfo(url: string): Promise<PlaylistInfo> {
  return new Promise((resolve, reject) => {
    const bin = getYtdlpPath()
    if (!fs.existsSync(bin)) {
      reject(new Error("yt-dlp not found. Run: npm run setup"))
      return
    }

    const proc = spawn(bin, buildYtdlpArgs(["--flat-playlist", "--dump-single-json", "--skip-download", url]), {
      env: ytdlpEnv(),
    })

    let stdout = ""
    let stderr = ""

    proc.stdout.on("data", (data) => {
      stdout += data.toString()
    })
    proc.stderr.on("data", (data) => {
      stderr += data.toString()
    })

    proc.on("error", (err) => {
      reject(new Error(`Failed to start yt-dlp: ${err.message}`))
    })

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp playlist info failed: ${stderr}`))
        return
      }

      try {
        type FlatThumbnail = { url?: string; width?: number; height?: number }
        type FlatEntry = {
          id?: string
          url?: string
          title?: string
          uploader?: string
          channel?: string
          artist?: string
          duration?: number
          thumbnail?: string
          thumbnails?: FlatThumbnail[]
        }
        type FlatPlaylist = {
          id?: string
          title?: string
          entries?: FlatEntry[]
        }

        const parsed = JSON.parse(stdout.trim()) as FlatPlaylist
        const rawEntries = Array.isArray(parsed.entries) ? parsed.entries : []
        const entries: PlaylistEntryInfo[] = rawEntries
          .map((entry, index) => {
            const id = typeof entry.id === "string" ? entry.id : ""
            const rawUrl = typeof entry.url === "string" ? entry.url : ""
            const url =
              rawUrl.startsWith("http://") || rawUrl.startsWith("https://")
                ? rawUrl
                : id
                ? `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`
                : ""

            if (!url) {
              return null
            }

            const title =
              typeof entry.title === "string" && entry.title.trim()
                ? entry.title.trim()
                : `Track ${index + 1}`

            const artist =
              (typeof entry.artist === "string" && entry.artist.trim()) ||
              (typeof entry.uploader === "string" && entry.uploader.trim()) ||
              (typeof entry.channel === "string" && entry.channel.trim()) ||
              null

            const duration =
              typeof entry.duration === "number" && Number.isFinite(entry.duration)
                ? Math.round(entry.duration)
                : null

            const thumbnailCandidates: ThumbnailCandidate[] = []
            if (typeof entry.thumbnail === "string" && entry.thumbnail.trim()) {
              thumbnailCandidates.push({ url: entry.thumbnail })
            }
            if (Array.isArray(entry.thumbnails)) {
              for (const thumb of entry.thumbnails) {
                if (typeof thumb?.url === "string" && thumb.url.trim()) {
                  thumbnailCandidates.push({
                    url: thumb.url,
                    width: thumb.width,
                    height: thumb.height,
                  })
                }
              }
            }
            const thumbnail = pickBestThumbnail(thumbnailCandidates)

            return {
              id: id || `entry-${index + 1}`,
              url,
              title,
              artist,
              duration,
              thumbnail,
            }
          })
          .filter((entry): entry is PlaylistEntryInfo => entry !== null)

        resolve({
          id: typeof parsed.id === "string" ? parsed.id : null,
          title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : "Playlist",
          entries,
        })
      } catch {
        reject(new Error("Failed to parse yt-dlp playlist output"))
      }
    })
  })
}

export async function searchAudioSource(
  provider: "youtube" | "soundcloud",
  query: string,
  limit = 5
): Promise<SourceSearchResult[]> {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) return []
  const safeLimit = Math.min(Math.max(limit, 1), 20)

  return new Promise((resolve, reject) => {
    const bin = getYtdlpPath()
    if (!fs.existsSync(bin)) {
      reject(new Error("yt-dlp not found. Run: npm run setup"))
      return
    }

    const searchPrefix = provider === "youtube" ? "ytsearch" : "scsearch"
    const searchQuery = `${searchPrefix}${safeLimit}:${trimmedQuery}`
    const proc = spawn(
      bin,
      buildYtdlpArgs([
        "--flat-playlist",
        "--dump-single-json",
        "--skip-download",
        searchQuery,
      ]),
      { env: ytdlpEnv() }
    )

    let stdout = ""
    let stderr = ""

    proc.stdout.on("data", (data) => {
      stdout += data.toString()
    })
    proc.stderr.on("data", (data) => {
      stderr += data.toString()
    })
    proc.on("error", (err) => {
      reject(new Error(`Failed to start yt-dlp search: ${err.message}`))
    })
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp search failed: ${stderr}`))
        return
      }

      try {
        const parsed = JSON.parse(stdout.trim()) as ParsedVideoInfo
        const rawEntries = Array.isArray(parsed.entries) ? parsed.entries : []
        const results = rawEntries
          .map((entry): SourceSearchResult | null => {
            const title =
              (typeof entry.title === "string" && entry.title.trim()) ||
              (typeof entry.track === "string" && entry.track.trim()) ||
              "Unknown title"
            const rawUrl =
              (typeof entry.webpage_url === "string" && entry.webpage_url.trim()) ||
              (typeof entry.original_url === "string" && entry.original_url.trim()) ||
              (typeof entry.url === "string" && entry.url.trim()) ||
              null
            const url = (() => {
              if (!rawUrl) return null
              if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) return rawUrl
              if (provider === "youtube") {
                return `https://www.youtube.com/watch?v=${encodeURIComponent(rawUrl)}`
              }
              return `https://soundcloud.com/${rawUrl}`
            })()
            if (!url) return null

            return {
              provider,
              title,
              artist: entry.artist || entry.creator || entry.uploader || null,
              url,
              duration: typeof entry.duration === "number" ? Math.max(0, Math.round(entry.duration)) : null,
              thumbnail: typeof entry.thumbnail === "string" && entry.thumbnail.trim() ? entry.thumbnail.trim() : null,
            }
          })
          .filter((entry): entry is SourceSearchResult => entry !== null)
          .slice(0, safeLimit)
        resolve(results)
      } catch {
        reject(new Error("Failed to parse yt-dlp search output"))
      }
    })
  })
}

export async function getVideoInfo(url: string): Promise<VideoInfo> {
  const primaryParsed = await fetchVideoInfoJson(url)
  const primaryInfo = pickInfoRoot(primaryParsed)
  const thumbnailCandidates = collectThumbnailCandidates(primaryInfo)

  // Best-effort: web_music client exposes additional square album-art URLs (lh3).
  try {
    const musicParsed = await fetchVideoInfoJson(url, [
      "--ignore-no-formats-error",
      "--extractor-args",
      "youtube:player_client=web_music",
    ])
    const musicInfo = pickInfoRoot(musicParsed)
    thumbnailCandidates.push(...collectThumbnailCandidates(musicInfo))
  } catch {
    // Keep primary metadata path if web_music metadata is unavailable.
  }

  return {
    title: primaryInfo.track || primaryInfo.title || "Unknown",
    artist: primaryInfo.artist || primaryInfo.creator || primaryInfo.uploader || null,
    album: primaryInfo.album || null,
    albumArtist: primaryInfo.album_artist || primaryInfo.artist || primaryInfo.creator || primaryInfo.uploader || null,
    trackNumber: parsePositiveInt(primaryInfo.track_number),
    discNumber: parsePositiveInt(primaryInfo.disc_number),
    genre: pickGenre(primaryInfo),
    isrc: typeof primaryInfo.isrc === "string" && primaryInfo.isrc.trim() ? primaryInfo.isrc.trim() : null,
    year: inferYearFromParsedInfo(primaryInfo),
    duration: primaryInfo.duration ? Math.round(primaryInfo.duration) : null,
    thumbnail: pickBestThumbnail(thumbnailCandidates),
    formats: ["opus", "flac"],
  }
}

export function downloadAudio(
  options: DownloadOptions,
  onProgress: (message: string) => void
): Promise<DownloadResult> {
  return new Promise((resolve, reject) => {
    const bin = getYtdlpPath()
    if (!fs.existsSync(bin)) {
      reject(new Error("yt-dlp not found. Run: npm run setup"))
      return
    }

    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true })

    const { url, format, quality } = options
    const downloadId = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
    const outputTemplate = path.join(DOWNLOADS_DIR, `${downloadId}-%(title).100s.%(ext)s`)
    const ffmpegLocation = getFfmpegDir()

    const args = [
      "--output", outputTemplate,
      "--no-playlist",
      "--newline",
      "-f", "bestaudio/best",
      "-x",
      "--audio-format", format,
      "--ffmpeg-location", ffmpegLocation,
    ]

    if (format === "opus") {
      args.push("--audio-quality", `${quality}k`)
    }

    args.push(url)

    onProgress(`Downloading as ${format.toUpperCase()}${format === "opus" ? ` at ${quality} kbps` : " (lossless)"}`)

    const proc = spawn(bin, buildYtdlpArgs(args), { env: ytdlpEnv() })
    let stderr = ""

    proc.stdout.on("data", (data) => {
      const text = data.toString()
      const lines = text.split("\n").filter((l: string) => l.trim())
      for (const line of lines) {
        onProgress(line.trim())
      }
    })

    proc.stderr.on("data", (data) => {
      const text = data.toString()
      stderr += text
      const lines = text.split("\n").filter((l: string) => l.trim())
      for (const line of lines) {
        onProgress(line.trim())
      }
    })

    proc.on("error", (err) => {
      reject(new Error(`Failed to start yt-dlp: ${err.message}`))
    })

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp download failed: ${stderr}`))
        return
      }

      try {
        const files = fs.readdirSync(DOWNLOADS_DIR)
          .filter((f) => f.startsWith(`${downloadId}-`))
          .map((f) => path.join(DOWNLOADS_DIR, f))
          .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)

        if (files.length === 0) {
          reject(new Error("Could not find downloaded file"))
          return
        }

        const filePath = files[0]
        const stats = fs.statSync(filePath)
        const parsed = path.parse(filePath)
        const title = parsed.name.startsWith(`${downloadId}-`)
          ? parsed.name.slice(downloadId.length + 1)
          : parsed.name
        const detectedFormat = parsed.ext.replace(/^\./, "").toLowerCase() || format

        resolve({
          filePath,
          format: detectedFormat,
          title,
          artist: null,
          duration: null,
          thumbnail: null,
          fileSize: stats.size,
        })
      } catch {
        reject(new Error("Failed to locate downloaded file"))
      }
    })
  })
}
