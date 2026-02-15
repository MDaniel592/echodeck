import { spawn } from "child_process"
import path from "path"
import fs from "fs"
import { getYtdlpPath, getFfmpegDir } from "./binaries"

const DOWNLOADS_DIR = path.join(process.cwd(), "downloads")

export interface VideoInfo {
  title: string
  artist: string | null
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
  format: "mp3" | "flac" | "wav" | "ogg"
  quality: "best" | "320" | "256" | "192" | "128"
  bestAudioPreference?: "auto" | "opus" | "aac"
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

interface ThumbnailCandidate {
  url?: string
  width?: number
  height?: number
}

interface RawAudioFormat {
  format_id?: string
  ext?: string
  vcodec?: string | null
  acodec?: string | null
  abr?: number | null
  tbr?: number | null
  asr?: number | null
  audio_channels?: number | null
}

interface ParsedVideoInfo {
  title?: string
  artist?: string
  uploader?: string
  duration?: number
  thumbnail?: string
  thumbnails?: ThumbnailCandidate[]
  entries?: ParsedVideoInfo[]
}

function codecPreferenceScore(codec: string | null | undefined, preference: "auto" | "opus" | "aac"): number {
  if (!codec) return 0
  const normalized = codec.toLowerCase()
  const isOpus = normalized.includes("opus")
  const isAac = normalized.includes("aac") || normalized.includes("mp4a")

  if (preference === "opus") {
    if (isOpus) return 3
    if (isAac) return 2
    return 1
  }

  if (preference === "aac") {
    if (isAac) return 3
    if (isOpus) return 2
    return 1
  }

  // Auto: lightly prefer opus, then aac, when other metrics are tied.
  if (isOpus) return 3
  if (isAac) return 2
  return 1
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

async function getPreferredAudioFormatId(
  url: string,
  preference: "auto" | "opus" | "aac"
): Promise<{ formatId: string; summary: string } | null> {
  return new Promise((resolve, reject) => {
    const bin = getYtdlpPath()
    if (!fs.existsSync(bin)) {
      reject(new Error("yt-dlp not found. Run: npm run setup"))
      return
    }

    const proc = spawn(bin, ["--dump-single-json", "--no-download", "--no-playlist", url], {
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
        reject(new Error(`yt-dlp info failed: ${stderr}`))
        return
      }

      try {
        const data = JSON.parse(stdout) as { formats?: RawAudioFormat[] }
        const formats = Array.isArray(data.formats) ? data.formats : []
        const audioOnly = formats.filter(
          (format) =>
            typeof format.format_id === "string" &&
            format.format_id.length > 0 &&
            format.acodec &&
            format.acodec !== "none" &&
            (format.vcodec === "none" || format.vcodec === null || format.vcodec === undefined)
        )

        if (audioOnly.length === 0) {
          resolve(null)
          return
        }

        audioOnly.sort((a, b) => {
          const bitrateDiff = (numeric(b.abr) || numeric(b.tbr)) - (numeric(a.abr) || numeric(a.tbr))
          if (bitrateDiff !== 0) return bitrateDiff

          const sampleRateDiff = numeric(b.asr) - numeric(a.asr)
          if (sampleRateDiff !== 0) return sampleRateDiff

          const channelsDiff = numeric(b.audio_channels) - numeric(a.audio_channels)
          if (channelsDiff !== 0) return channelsDiff

          return codecPreferenceScore(b.acodec, preference) - codecPreferenceScore(a.acodec, preference)
        })

        const selected = audioOnly[0]
        resolve({
          formatId: selected.format_id as string,
          summary: `${selected.format_id} ${selected.ext || "audio"} ${selected.acodec || "unknown"} ${Math.round(
            numeric(selected.abr) || numeric(selected.tbr)
          )}k`,
        })
      } catch {
        resolve(null)
      }
    })
  })
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

    const args = ["--dump-single-json", "--no-download", "--no-playlist", ...extraArgs, url]
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

    const proc = spawn(bin, ["--flat-playlist", "--dump-single-json", "--skip-download", url], {
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
    title: primaryInfo.title || "Unknown",
    artist: primaryInfo.artist || primaryInfo.uploader || null,
    duration: primaryInfo.duration ? Math.round(primaryInfo.duration) : null,
    thumbnail: pickBestThumbnail(thumbnailCandidates),
    formats: ["mp3", "flac", "wav", "ogg"],
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

    const { url, format, quality, bestAudioPreference = "auto" } = options
    const downloadId = `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
    const outputTemplate = path.join(DOWNLOADS_DIR, `${downloadId}-%(title).100s.%(ext)s`)

    const ffmpegLocation = getFfmpegDir()

    const runDownload = (formatSelector: string) => {
      const args = [
        "--output", outputTemplate,
        "--no-playlist",
        "--newline",
      ]

      if (quality === "best") {
        // Download source audio directly without transcoding.
        args.push("-f", formatSelector)
      } else {
        args.push(
          "-x",
          "--audio-format", format,
          "--ffmpeg-location", ffmpegLocation
        )

        if (format === "mp3") {
          args.push("--audio-quality", `${quality}k`)
        }
      }

      args.push(url)

      const proc = spawn(bin, args, { env: ytdlpEnv() })
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

        // Find the downloaded file by this invocation's unique prefix.
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
    }

    if (quality === "best") {
      if (bestAudioPreference === "auto") {
        onProgress("Using bestaudio/best")
        runDownload("bestaudio/best")
        return
      }

      const formatSelectionTimeoutMs = 12000
      Promise.race([
        getPreferredAudioFormatId(url, bestAudioPreference).then((selection) => ({
          kind: "selection" as const,
          selection,
        })),
        new Promise<{ kind: "timeout" }>((resolve) => {
          setTimeout(() => resolve({ kind: "timeout" }), formatSelectionTimeoutMs)
        }),
      ])
        .then((result) => {
          if (result.kind === "timeout") {
            onProgress("Format selection timed out, falling back to bestaudio/best")
            runDownload("bestaudio/best")
            return
          }

          if (result.selection) {
            onProgress(`Selected audio format: ${result.selection.summary}`)
            runDownload(result.selection.formatId)
            return
          }

          onProgress("Could not rank audio formats, falling back to bestaudio/best")
          runDownload("bestaudio/best")
        })
        .catch((error) => {
          onProgress(
            `Format selection failed (${error instanceof Error ? error.message : "unknown error"}), falling back`
          )
          runDownload("bestaudio/best")
        })
      return
    }

    runDownload("bestaudio/best")
  })
}
