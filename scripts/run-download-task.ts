import fs from "fs"
import path from "path"
import prisma from "../lib/prisma"
import { downloadSongArtwork, getSpotifyThumbnail } from "../lib/artwork"
import {
  appendTaskEvent,
  drainQueuedTaskWorkers,
  trimTaskEvents,
  YOUTUBE_HOSTS,
  normalizeFormat,
  normalizeQuality,
  normalizeBestAudioPreference,
  updateTaskHeartbeat,
} from "../lib/downloadTasks"
import { ensureArtistAlbumRefs } from "../lib/artistAlbumRefs"
import { normalizeSongTitle, cleanYouTubeTitle } from "../lib/songTitle"
import { runWithConcurrency } from "../lib/asyncPool"
import { waitRandomDelay } from "../lib/downloadThrottle"
import { downloadSpotify } from "../lib/spotdl"
import { downloadAudio, getPlaylistInfo, getVideoInfo, type DownloadOptions } from "../lib/ytdlp"
import { redactSensitiveText } from "../lib/sanitize"
import { findReusableSongBySourceUrl, normalizeSoundCloudUrl, normalizeSpotifyTrackUrl } from "../lib/songDedup"
import { assignSongToPlaylistForUser } from "../lib/playlistEntries"
import { lookupLyrics } from "../lib/lyricsProvider"

const YOUTUBE_VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{11}$/
const YOUTUBE_DOWNLOAD_CONCURRENCY = 6
const SPOTIFY_DOWNLOAD_CONCURRENCY = 4
const DOWNLOAD_DELAY_MIN_MS = 200
const DOWNLOAD_DELAY_MAX_MS = 800
const VIDEO_INFO_TIMEOUT_MS = 15_000
const DOWNLOAD_RETRY_ATTEMPTS = 3
const DOWNLOAD_RETRY_BASE_DELAY_MS = 1500
const DOWNLOADS_ROOT = path.resolve(process.cwd(), "downloads")
const EXPORT_LRC_SIDECAR = /^1|true|yes|on$/i.test(process.env.EXPORT_LRC_SIDECAR || "")
const DOWNLOAD_ASCII_FILENAMES = /^1|true|yes|on$/i.test(process.env.DOWNLOAD_ASCII_FILENAMES || "")

function extractVideoIdFromMixList(listId: string): string | null {
  if (!listId.startsWith("RD")) return null

  const directId = listId.slice(2)
  if (YOUTUBE_VIDEO_ID_REGEX.test(directId)) return directId

  const trailingMatch = listId.match(/([A-Za-z0-9_-]{11})$/)
  if (trailingMatch?.[1] && YOUTUBE_VIDEO_ID_REGEX.test(trailingMatch[1])) {
    return trailingMatch[1]
  }

  return null
}

function normalizeYouTubeUrl(inputUrl: string): string {
  const parsed = new URL(inputUrl)
  const host = parsed.hostname.toLowerCase()

  if (host === "youtu.be") {
    const videoId = parsed.pathname.split("/").filter(Boolean)[0]
    if (!videoId) return inputUrl
    return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
  }

  if (!YOUTUBE_HOSTS.has(host)) {
    return inputUrl
  }

  if (parsed.pathname === "/playlist") {
    const listId = parsed.searchParams.get("list")
    if (listId) {
      const mixVideoId = extractVideoIdFromMixList(listId)
      if (mixVideoId) {
        const normalized = new URL("https://www.youtube.com/watch")
        normalized.searchParams.set("v", mixVideoId)
        return normalized.toString()
      }
    }
  }

  const pathParts = parsed.pathname.split("/").filter(Boolean)
  let videoId = parsed.searchParams.get("v")
  if (!videoId && pathParts[0] === "shorts" && pathParts[1]) {
    videoId = pathParts[1]
  }
  if (!videoId && pathParts[0] === "live" && pathParts[1]) {
    videoId = pathParts[1]
  }
  if (!videoId) {
    return inputUrl
  }

  const normalized = new URL("https://www.youtube.com/watch")
  normalized.searchParams.set("v", videoId)
  return normalized.toString()
}

function isExplicitYouTubePlaylistUrl(inputUrl: string): boolean {
  const parsed = new URL(inputUrl)
  const host = parsed.hostname.toLowerCase()
  if (!YOUTUBE_HOSTS.has(host)) return false
  if (!parsed.searchParams.has("list")) return false
  return parsed.pathname === "/playlist" || parsed.pathname === "/watch"
}

function cleanupFileIfExists(filePath: string | null | undefined) {
  if (!filePath) return

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  } catch {
    // Ignore best-effort cleanup failures.
  }
}

function sanitizePathSegment(value: string | null | undefined, fallback: string): string {
  const raw = (value || "").trim()
  if (!raw) return fallback
  let normalized = raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
  if (DOWNLOAD_ASCII_FILENAMES) {
    normalized = normalized.replace(/[^\x20-\x7E]/g, " ")
  }
  normalized = normalized
    .replace(/\s+/g, " ")
    .trim()
  return normalized.length > 0 ? normalized.slice(0, 120) : fallback
}

function buildOrganizedRelativePath(input: {
  artist: string | null
  album: string | null
  year: number | null
  discNumber?: number | null
  trackNumber?: number | null
  title: string
  ext: string
}): string {
  const artistDir = sanitizePathSegment(input.artist, "Unknown Artist")
  const albumPart = sanitizePathSegment(input.album, "Singles")
  const yearPrefix = input.year && Number.isFinite(input.year) ? String(input.year) : "0000"
  const albumDir = `${yearPrefix} - ${albumPart}`

  const discPrefix = input.discNumber && input.discNumber > 0 ? `${String(input.discNumber).padStart(2, "0")}-` : ""
  const trackPrefix = input.trackNumber && input.trackNumber > 0 ? `${String(input.trackNumber).padStart(2, "0")} - ` : ""
  const titlePart = sanitizePathSegment(input.title, "Unknown title")
  const fileName = `${discPrefix}${trackPrefix}${titlePart}.${input.ext.replace(/^\./, "")}`

  return path.join("music", artistDir, albumDir, fileName)
}

function ensureUniquePath(targetPath: string): string {
  if (!fs.existsSync(targetPath)) return targetPath
  const parsed = path.parse(targetPath)
  for (let i = 2; i < 1000; i += 1) {
    const candidate = path.join(parsed.dir, `${parsed.name} (${i})${parsed.ext}`)
    if (!fs.existsSync(candidate)) return candidate
  }
  return path.join(parsed.dir, `${parsed.name}-${Date.now()}${parsed.ext}`)
}

function moveFileToPath(sourcePath: string, targetPath: string): string {
  if (path.resolve(sourcePath) === path.resolve(targetPath)) return targetPath
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  const uniqueTarget = ensureUniquePath(targetPath)
  try {
    fs.renameSync(sourcePath, uniqueTarget)
    return uniqueTarget
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err.code !== "EXDEV") throw error
    fs.copyFileSync(sourcePath, uniqueTarget)
    fs.unlinkSync(sourcePath)
    return uniqueTarget
  }
}

function deriveRelativePath(filePath: string): string | null {
  const absolute = path.resolve(filePath)
  if (!absolute.startsWith(`${DOWNLOADS_ROOT}${path.sep}`) && absolute !== DOWNLOADS_ROOT) return null
  return path.relative(DOWNLOADS_ROOT, absolute)
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)
    promise
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch((error) => {
        clearTimeout(timer)
        reject(error)
      })
  })
}

function isRetryableDownloadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  return (
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("http error 429") ||
    message.includes("http error 500") ||
    message.includes("http error 502") ||
    message.includes("http error 503") ||
    message.includes("http error 504") ||
    message.includes("connection reset") ||
    message.includes("temporary failure") ||
    message.includes("network is unreachable") ||
    message.includes("remote end closed connection")
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function formatDurationLabel(seconds: number | null | undefined): string | null {
  if (!seconds || !Number.isFinite(seconds) || seconds < 1) return null
  const total = Math.round(seconds)
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return `${mins}:${secs.toString().padStart(2, "0")}`
}

function summarizeTrackMetadata(input: {
  title: string
  artist: string | null
  album: string | null
  year: number | null
  duration: number | null
  trackNumber?: number | null
  discNumber?: number | null
  genre?: string | null
  isrc?: string | null
}): string {
  const parts = [
    input.title ? `title=${input.title}` : null,
    input.artist ? `artist=${input.artist}` : null,
    input.album ? `album=${input.album}` : null,
    input.trackNumber ? `track=${input.trackNumber}` : null,
    input.discNumber ? `disc=${input.discNumber}` : null,
    input.year ? `year=${input.year}` : null,
    input.genre ? `genre=${input.genre}` : null,
    input.isrc ? `isrc=${input.isrc}` : null,
    formatDurationLabel(input.duration) ? `duration=${formatDurationLabel(input.duration)}` : null,
  ].filter((part): part is string => Boolean(part))

  return parts.join(" | ")
}

function parseProgressPayload(message: string): Record<string, unknown> | null {
  const downloadMatch = message.match(
    /\[download\]\s+(\d+(?:\.\d+)?)%.*?(?:of\s+([^\s]+))?.*?(?:at\s+([^\s]+))?.*?(?:ETA\s+([0-9:]+))?/i
  )
  if (downloadMatch) {
    const percent = Number.parseFloat(downloadMatch[1] || "")
    return {
      kind: "ytdlp_progress",
      percent: Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : null,
      total: downloadMatch[2] || null,
      speed: downloadMatch[3] || null,
      eta: downloadMatch[4] || null,
    }
  }

  const retryMatch = message.match(/Retrying download \((\d+)\/(\d+)\)\.\.\./i)
  if (retryMatch) {
    return {
      kind: "retry",
      attempt: Number.parseInt(retryMatch[1], 10),
      maxAttempts: Number.parseInt(retryMatch[2], 10),
    }
  }

  const transientMatch = message.match(/Transient download error:\s*(.+)\.\s*Retrying in\s*(\d+)s/i)
  if (transientMatch) {
    return {
      kind: "transient_error",
      message: transientMatch[1],
      retryInSec: Number.parseInt(transientMatch[2], 10),
    }
  }

  if (/Already in library, skipping download\./i.test(message)) {
    return { kind: "skip", reason: "file_exists" }
  }
  if (/No provider match found, skipping\./i.test(message)) {
    return { kind: "skip", reason: "no_provider_match" }
  }
  if (/Provider lookup skipped:/i.test(message)) {
    return { kind: "skip", reason: "provider_lookup_skipped" }
  }
  if (/song\.link fallback skipped:/i.test(message)) {
    return { kind: "skip", reason: "songlink_fallback_skipped" }
  }

  return null
}

async function downloadAudioWithRetry(
  options: DownloadOptions,
  onProgress: (message: string) => void
): Promise<Awaited<ReturnType<typeof downloadAudio>>> {
  let lastError: unknown = null

  for (let attempt = 1; attempt <= DOWNLOAD_RETRY_ATTEMPTS; attempt += 1) {
    if (attempt > 1) {
      onProgress(`Retrying download (${attempt}/${DOWNLOAD_RETRY_ATTEMPTS})...`)
    }

    try {
      return await downloadAudio(options, onProgress)
    } catch (error) {
      lastError = error
      const canRetry = attempt < DOWNLOAD_RETRY_ATTEMPTS && isRetryableDownloadError(error)
      if (!canRetry) {
        break
      }
      const backoffMs = DOWNLOAD_RETRY_BASE_DELAY_MS * attempt
      const message = error instanceof Error ? error.message : "Unknown download error"
      onProgress(`Transient download error: ${message}. Retrying in ${Math.round(backoffMs / 1000)}s...`)
      await sleep(backoffMs)
    }
  }

  throw (lastError instanceof Error ? lastError : new Error("Download failed"))
}

function parseYearCandidate(value: string | null | undefined): number | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
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
  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return null
  const year = parsed.getUTCFullYear()
  return year >= 1000 && year <= 9999 ? year : null
}

function parsePositiveIntCandidate(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const parsed =
    typeof value === "number"
      ? Math.trunc(value)
      : Number.parseInt(String(value).trim(), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return parsed
}

function shouldReplaceExistingWithOpus(input: {
  source: string
  quality: "best" | "320" | "256" | "192" | "128"
  bestAudioPreference: "auto" | "opus" | "aac"
  existingFormat: string | null | undefined
}): boolean {
  if (input.source !== "youtube" && input.source !== "soundcloud") return false
  if (input.quality !== "best") return false
  if (input.bestAudioPreference !== "opus") return false
  return (input.existingFormat || "").toLowerCase() !== "opus"
}

async function organizeDownloadedAudio(input: {
  filePath: string
  artist: string | null
  album: string | null
  year: number | null
  discNumber?: number | null
  trackNumber?: number | null
  title: string
  preferredExt?: string | null
}): Promise<{ filePath: string; relativePath: string | null; fileSize: number | null }> {
  const sourcePath = path.resolve(input.filePath)
  const ext = (input.preferredExt || path.extname(sourcePath).replace(/^\./, "") || "mp3").toLowerCase()
  const relativePath = buildOrganizedRelativePath({
    artist: input.artist,
    album: input.album,
    year: input.year,
    discNumber: input.discNumber ?? null,
    trackNumber: input.trackNumber ?? null,
    title: input.title,
    ext,
  })
  const targetPath = path.join(DOWNLOADS_ROOT, relativePath)
  const finalPath = moveFileToPath(sourcePath, targetPath)
  let fileSize: number | null = null
  try {
    fileSize = fs.statSync(finalPath).size
  } catch {
    // ignore
  }
  return {
    filePath: finalPath,
    relativePath: deriveRelativePath(finalPath),
    fileSize,
  }
}

async function exportLyricsSidecarIfEnabled(taskId: number, songId: number): Promise<void> {
  if (!EXPORT_LRC_SIDECAR) return

  const song = await prisma.song.findUnique({
    where: { id: songId },
    select: { id: true, title: true, artist: true, album: true, duration: true, filePath: true, lyrics: true },
  })
  if (!song) return

  const lrcPath = song.filePath.replace(/\.[^.]+$/, ".lrc")
  if (fs.existsSync(lrcPath)) {
    await logEvent(taskId, "info", `Lyrics sidecar exists: ${path.basename(lrcPath)}`, {
      kind: "skip",
      reason: "lyrics_sidecar_exists",
      songId: song.id,
    })
    return
  }

  let lyrics = song.lyrics
  if (!lyrics) {
    lyrics = await lookupLyrics({
      title: song.title,
      artist: song.artist,
      album: song.album,
      duration: song.duration,
      timeoutMs: 6_000,
    })
    if (lyrics) {
      await prisma.song.update({ where: { id: song.id }, data: { lyrics } })
    }
  }

  if (!lyrics) {
    await logEvent(taskId, "info", `No lyrics sidecar match: ${song.title}`, {
      kind: "skip",
      reason: "lyrics_not_found",
      songId: song.id,
    })
    return
  }

  fs.writeFileSync(lrcPath, `${lyrics.trim()}\n`, "utf8")
  await logEvent(taskId, "info", `Lyrics sidecar saved: ${path.basename(lrcPath)}`, {
    kind: "lyrics_export",
    songId: song.id,
    path: lrcPath,
  })
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002")
}

async function updateTaskCounts(
  taskId: number,
  deltas: {
    processed?: number
    successful?: number
    failed?: number
  }
) {
  await prisma.downloadTask.update({
    where: { id: taskId },
    data: {
      processedItems: deltas.processed ? { increment: deltas.processed } : undefined,
      successfulItems: deltas.successful ? { increment: deltas.successful } : undefined,
      failedItems: deltas.failed ? { increment: deltas.failed } : undefined,
    },
  })
}

async function assignSongToTaskPlaylistIfNeeded(
  userId: number,
  song: { id: number; playlistId: number | null },
  taskPlaylistId: number | null
) {
  if (taskPlaylistId === null) {
    return
  }

  if (song.playlistId === taskPlaylistId) {
    const existing = await prisma.playlistSong.findFirst({
      where: { playlistId: taskPlaylistId, songId: song.id },
      select: { id: true },
    })
    if (existing) {
      return
    }
  }

  await assignSongToPlaylistForUser(userId, song.id, taskPlaylistId)
}

async function runVideoTask(taskId: number) {
  const task = await prisma.downloadTask.findUnique({ where: { id: taskId } })
  if (!task) return
  if (!task.userId) throw new Error("Task has no owner")

  const userId = task.userId
  const source = task.source
  const quality = normalizeQuality(task.quality)
  const format = normalizeFormat(task.format)
  const bestAudioPreference = normalizeBestAudioPreference(task.bestAudioPreference)
  const taskPlaylistId = task.playlistId
  const isPlaylist = source === "youtube" && isExplicitYouTubePlaylistUrl(task.sourceUrl)

  if (isPlaylist) {
    await logEvent(taskId, "status", "Fetching playlist info...")
    const playlist = await getPlaylistInfo(task.sourceUrl)
    const uniqueEntries = Array.from(
      new Map(
        playlist.entries.map((entry) => [normalizeYouTubeUrl(entry.url), { ...entry, url: normalizeYouTubeUrl(entry.url) }])
      ).values()
    )
    const totalRaw = playlist.entries.length
    const total = uniqueEntries.length
    if (total === 0) {
      throw new Error("No downloadable tracks were found in this playlist.")
    }

    const duplicateCount = Math.max(0, totalRaw - total)
    const candidateUrls = uniqueEntries.map((entry) => entry.url)
    const existingRows = candidateUrls.length > 0
      ? await prisma.song.findMany({
          where: {
            userId,
            source,
            sourceUrl: { in: candidateUrls },
          },
          select: { sourceUrl: true },
        })
      : []
    const existingUrlSet = new Set(existingRows.map((row) => row.sourceUrl).filter((value): value is string => Boolean(value)))
    const estimatedExisting = existingUrlSet.size
    const estimatedNew = Math.max(0, total - estimatedExisting)

    await prisma.downloadTask.update({
      where: { id: taskId },
      data: {
        isPlaylist: true,
        playlistTitle: playlist.title,
        totalItems: total,
      },
    })

    await logEvent(taskId, "info", `Playlist: ${playlist.title}`)
    if (duplicateCount > 0) {
      await logEvent(taskId, "info", `Playlist entries deduplicated: ${duplicateCount} duplicate item(s) removed.`)
    }
    await logEvent(
      taskId,
      "info",
      `Pre-check: unique=${total} already_in_library=${estimatedExisting} estimated_new=${estimatedNew}`
    )
    await logEvent(
      taskId,
      "status",
      `Found ${total} tracks. Starting background queue (${YOUTUBE_DOWNLOAD_CONCURRENCY} parallel downloads)...`
    )

    await runWithConcurrency(uniqueEntries, YOUTUBE_DOWNLOAD_CONCURRENCY, async (entry, index) => {
      const progressPrefix = `[${index + 1}/${total}]`
      const normalizedTrackUrl = entry.url
      let shouldThrottle = false
      let songToReplace: Awaited<ReturnType<typeof findReusableSongBySourceUrl>> | null = null

      try {
        const reusableSong = await findReusableSongBySourceUrl(userId, source, normalizedTrackUrl)
        if (reusableSong) {
          const shouldReplace = shouldReplaceExistingWithOpus({
            source,
            quality,
            bestAudioPreference,
            existingFormat: reusableSong.format,
          })
          if (shouldReplace) {
            songToReplace = reusableSong
            await logEvent(
              taskId,
              "status",
              `${progressPrefix} Existing file is ${reusableSong.format || "unknown"}, replacing with Opus...`
            )
          } else {
            await assignSongToTaskPlaylistIfNeeded(userId, reusableSong, taskPlaylistId)
            await logEvent(taskId, "status", `${progressPrefix} Already in library: ${reusableSong.title}`)
            await logEvent(taskId, "track", `${progressPrefix} Reused: ${reusableSong.title}`, {
              kind: "skip",
              reason: "file_exists",
              songId: reusableSong.id,
            })
            await updateTaskCounts(taskId, { processed: 1, successful: 1 })
            return
          }
        }

        await logEvent(taskId, "status", `${progressPrefix} Downloading: ${entry.title}`)
        shouldThrottle = true

        let entryInfo: Awaited<ReturnType<typeof getVideoInfo>> | null = null
        try {
          entryInfo = await withTimeout(getVideoInfo(normalizedTrackUrl), VIDEO_INFO_TIMEOUT_MS)
        } catch {
          // Keep playlist entry metadata as fallback when source lookup is unavailable.
        }

        const result = await downloadAudioWithRetry(
          { url: normalizedTrackUrl, format, quality, bestAudioPreference },
          (message) => {
            void logEvent(taskId, "progress", `${progressPrefix} ${message}`)
          }
        )

        const existingAfterDownload = await findReusableSongBySourceUrl(userId, source, normalizedTrackUrl)
        if (existingAfterDownload && (!songToReplace || existingAfterDownload.id !== songToReplace.id)) {
          await assignSongToTaskPlaylistIfNeeded(userId, existingAfterDownload, taskPlaylistId)
          cleanupFileIfExists(result.filePath)
          await logEvent(taskId, "track", `${progressPrefix} Reused: ${existingAfterDownload.title}`, {
            kind: "skip",
            reason: "file_exists",
            songId: existingAfterDownload.id,
          })
          await updateTaskCounts(taskId, { processed: 1, successful: 1 })
          return
        }

        const thumbnail = result.thumbnail || entryInfo?.thumbnail || entry.thumbnail
        const refs = await ensureArtistAlbumRefs({
          userId,
          artist: result.artist || entryInfo?.artist || entry.artist || null,
          album: entryInfo?.album || null,
          albumArtist: result.artist || entryInfo?.albumArtist || entryInfo?.artist || entry.artist || null,
          year: entryInfo?.year ?? null,
        })
        const rawTitle = result.title || entryInfo?.title || entry.title || "Unknown title"
        const organized = await organizeDownloadedAudio({
          filePath: result.filePath,
          artist: refs.artist,
          album: refs.album,
          year: entryInfo?.year ?? null,
          discNumber: parsePositiveIntCandidate(entryInfo?.discNumber),
          trackNumber: parsePositiveIntCandidate(entryInfo?.trackNumber),
          title: cleanYouTubeTitle(rawTitle, refs.artist || ""),
          preferredExt: result.format,
        })
        const songCreateData = {
          userId,
          title: cleanYouTubeTitle(rawTitle, refs.artist || ""),
          artist: refs.artist,
          album: refs.album,
          albumArtist: refs.albumArtist,
          artistId: refs.artistId,
          albumId: refs.albumId,
          trackNumber: parsePositiveIntCandidate(entryInfo?.trackNumber),
          discNumber: parsePositiveIntCandidate(entryInfo?.discNumber),
          genre: entryInfo?.genre ?? null,
          isrc: entryInfo?.isrc ?? null,
          year: entryInfo?.year ?? null,
          duration: result.duration ?? entryInfo?.duration ?? entry.duration,
          format: result.format,
          quality: quality === "best" ? `source:${bestAudioPreference}` : `${quality}kbps`,
          source,
          sourceUrl: normalizedTrackUrl,
          filePath: organized.filePath,
          relativePath: organized.relativePath,
          thumbnail,
          coverPath: null,
          fileSize: organized.fileSize || result.fileSize,
          downloadTaskId: taskId,
          playlistId: taskPlaylistId,
        }

        await logEvent(
          taskId,
          "info",
          `${progressPrefix} Metadata: ${summarizeTrackMetadata({
            title: songCreateData.title,
            artist: songCreateData.artist,
            album: songCreateData.album,
            trackNumber: songCreateData.trackNumber,
            discNumber: songCreateData.discNumber,
            year: songCreateData.year,
            genre: songCreateData.genre,
            isrc: songCreateData.isrc,
            duration: songCreateData.duration,
          })}`
        )

        let song: Awaited<ReturnType<typeof prisma.song.create>> | null = null
        if (songToReplace) {
          const previousFilePath = songToReplace.filePath
          song = await prisma.song.update({
            where: { id: songToReplace.id },
            data: {
              ...songCreateData,
              downloadTaskId: taskId,
              playlistId: taskPlaylistId,
            },
          })
          if (previousFilePath !== song.filePath) {
            cleanupFileIfExists(previousFilePath)
          }
          await logEvent(taskId, "track", `${progressPrefix} Replaced with Opus: ${song.title}`, {
            kind: "replace",
            reason: "prefer_opus",
            songId: song.id,
          })
        } else {
          const createdSong = await prisma.song.create({ data: songCreateData }).catch(async (error) => {
            if (isUniqueConstraintError(error)) {
              const concurrentSong = await findReusableSongBySourceUrl(userId, source, normalizedTrackUrl)
              if (concurrentSong) {
                await assignSongToTaskPlaylistIfNeeded(userId, concurrentSong, taskPlaylistId)
                cleanupFileIfExists(organized.filePath)
                await logEvent(taskId, "track", `${progressPrefix} Reused: ${concurrentSong.title}`, {
                  kind: "skip",
                  reason: "file_exists",
                  songId: concurrentSong.id,
                })
                await updateTaskCounts(taskId, { processed: 1, successful: 1 })
                return null
              }
            }
            throw error
          })

          if (!createdSong) {
            return
          }
          song = createdSong
        }

        if (!song) {
          return
        }
        await assignSongToTaskPlaylistIfNeeded(userId, song, taskPlaylistId)
        const coverPath = await downloadSongArtwork(song.id, thumbnail, song.filePath)
        if (coverPath) {
          song = await prisma.song.update({
            where: { id: song.id },
            data: { coverPath },
          })
        }

        await logEvent(taskId, "track", `${progressPrefix} Added: ${song.title}`, { songId: song.id })
        await exportLyricsSidecarIfEnabled(taskId, song.id)
        await updateTaskCounts(taskId, { processed: 1, successful: 1 })
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown track error"
        await logEvent(taskId, "error", `${progressPrefix} Failed: ${message}`)
        await updateTaskCounts(taskId, { processed: 1, failed: 1 })
      } finally {
        if (shouldThrottle) {
          const delayMs = await waitRandomDelay(DOWNLOAD_DELAY_MIN_MS, DOWNLOAD_DELAY_MAX_MS)
          await logEvent(taskId, "progress", `${progressPrefix} Cooldown ${Math.round(delayMs / 100) / 10}s`)
        }
      }
    })

    return
  }

  const normalizedUrl =
    source === "youtube"
      ? normalizeYouTubeUrl(task.sourceUrl)
      : normalizeSoundCloudUrl(task.sourceUrl)

  await prisma.downloadTask.update({
    where: { id: taskId },
    data: { isPlaylist: false, totalItems: 1 },
  })

  const reusableSong = await findReusableSongBySourceUrl(userId, source, normalizedUrl)
  const shouldReplaceExisting = reusableSong
    ? shouldReplaceExistingWithOpus({
        source,
        quality,
        bestAudioPreference,
        existingFormat: reusableSong.format,
      })
    : false
  if (reusableSong && !shouldReplaceExisting) {
    await assignSongToTaskPlaylistIfNeeded(userId, reusableSong, taskPlaylistId)
    await logEvent(taskId, "status", "Song already downloaded. Reusing existing file.")
    await logEvent(taskId, "track", `Reused: ${reusableSong.title}`, {
      kind: "skip",
      reason: "file_exists",
      songId: reusableSong.id,
    })
    await updateTaskCounts(taskId, { processed: 1, successful: 1 })
    return
  }
  if (reusableSong && shouldReplaceExisting) {
    await logEvent(taskId, "status", `Existing file is ${reusableSong.format || "unknown"}, replacing with Opus...`)
  }

  await logEvent(taskId, "status", "Fetching media info...")
  const info = await getVideoInfo(normalizedUrl)
  await logEvent(taskId, "info", `Track: ${info.title}`)
  await logEvent(taskId, "status", "Starting download...")

  const result = await downloadAudioWithRetry(
    { url: normalizedUrl, format, quality, bestAudioPreference },
    (message) => {
      void logEvent(taskId, "progress", message)
    }
  )

  const existingAfterDownload = await findReusableSongBySourceUrl(userId, source, normalizedUrl)
  if (existingAfterDownload && (!reusableSong || existingAfterDownload.id !== reusableSong.id)) {
    await assignSongToTaskPlaylistIfNeeded(userId, existingAfterDownload, taskPlaylistId)
    cleanupFileIfExists(result.filePath)
    await logEvent(taskId, "track", `Reused: ${existingAfterDownload.title}`, {
      kind: "skip",
      reason: "file_exists",
      songId: existingAfterDownload.id,
    })
    await updateTaskCounts(taskId, { processed: 1, successful: 1 })
    return
  }

  const thumbnail = result.thumbnail || info.thumbnail
  const refs = await ensureArtistAlbumRefs({
    userId,
    artist: result.artist || info.artist || null,
    album: info.album || null,
    albumArtist: result.artist || info.albumArtist || info.artist || null,
    year: info.year ?? null,
  })
  const rawTitle = result.title || info.title || "Unknown title"
  const organized = await organizeDownloadedAudio({
    filePath: result.filePath,
    artist: refs.artist,
    album: refs.album,
    year: info.year ?? null,
    discNumber: parsePositiveIntCandidate(info.discNumber),
    trackNumber: parsePositiveIntCandidate(info.trackNumber),
    title: cleanYouTubeTitle(rawTitle, refs.artist || ""),
    preferredExt: result.format,
  })
  const songCreateData = {
    userId,
    title: cleanYouTubeTitle(rawTitle, refs.artist || ""),
    artist: refs.artist,
    album: refs.album,
    albumArtist: refs.albumArtist,
    artistId: refs.artistId,
    albumId: refs.albumId,
    trackNumber: parsePositiveIntCandidate(info.trackNumber),
    discNumber: parsePositiveIntCandidate(info.discNumber),
    genre: info.genre ?? null,
    isrc: info.isrc ?? null,
    duration: result.duration || info.duration,
    year: info.year ?? null,
    format: result.format,
    quality: quality === "best" ? `source:${bestAudioPreference}` : `${quality}kbps`,
    source,
    sourceUrl: normalizedUrl,
    filePath: organized.filePath,
    relativePath: organized.relativePath,
    thumbnail,
    coverPath: null,
    fileSize: organized.fileSize || result.fileSize,
    downloadTaskId: taskId,
    playlistId: taskPlaylistId,
  }

  await logEvent(
    taskId,
    "info",
    `Metadata: ${summarizeTrackMetadata({
      title: songCreateData.title,
      artist: songCreateData.artist,
      album: songCreateData.album,
      trackNumber: songCreateData.trackNumber,
      discNumber: songCreateData.discNumber,
      year: songCreateData.year,
      genre: songCreateData.genre,
      isrc: songCreateData.isrc,
      duration: songCreateData.duration,
    })}`
  )

  let song: Awaited<ReturnType<typeof prisma.song.create>> | null = null
  if (reusableSong && shouldReplaceExisting) {
    const previousFilePath = reusableSong.filePath
    song = await prisma.song.update({
      where: { id: reusableSong.id },
      data: {
        ...songCreateData,
        downloadTaskId: taskId,
        playlistId: taskPlaylistId,
      },
    })
    if (previousFilePath !== song.filePath) {
      cleanupFileIfExists(previousFilePath)
    }
    await logEvent(taskId, "track", `Replaced with Opus: ${song.title}`, {
      kind: "replace",
      reason: "prefer_opus",
      songId: song.id,
    })
  } else {
    const createdSong = await prisma.song.create({ data: songCreateData }).catch(async (error) => {
      if (isUniqueConstraintError(error)) {
        const concurrentSong = await findReusableSongBySourceUrl(userId, source, normalizedUrl)
        if (concurrentSong) {
          await assignSongToTaskPlaylistIfNeeded(userId, concurrentSong, taskPlaylistId)
          cleanupFileIfExists(organized.filePath)
          await logEvent(taskId, "track", `Reused: ${concurrentSong.title}`, {
            kind: "skip",
            reason: "file_exists",
            songId: concurrentSong.id,
          })
          await updateTaskCounts(taskId, { processed: 1, successful: 1 })
          return null
        }
      }
      throw error
    })

    if (!createdSong) {
      return
    }
    song = createdSong
  }

  if (!song) {
    return
  }
  await assignSongToTaskPlaylistIfNeeded(userId, song, taskPlaylistId)

  const coverPath = await downloadSongArtwork(song.id, thumbnail, song.filePath)
  if (coverPath) {
    song = await prisma.song.update({
      where: { id: song.id },
      data: { coverPath },
    })
  }

  await logEvent(taskId, "track", `Added: ${song.title}`, { songId: song.id })
  await exportLyricsSidecarIfEnabled(taskId, song.id)
  await updateTaskCounts(taskId, { processed: 1, successful: 1 })
}

async function runSpotifyTask(taskId: number) {
  const task = await prisma.downloadTask.findUnique({ where: { id: taskId } })
  if (!task) return
  if (!task.userId) throw new Error("Task has no owner")

  const userId = task.userId
  const format = normalizeFormat(task.format)
  const taskPlaylistId = task.playlistId
  const spotifyThumbnail = await getSpotifyThumbnail(task.sourceUrl)
  await logEvent(taskId, "status", "Starting Spotify download...")

  const normalizedCache = new Map<string, Awaited<ReturnType<typeof findReusableSongBySourceUrl>>>()

  const findReusableBySpotifyUrl = async (sourceUrl: string | null) => {
    const normalized = normalizeSpotifyTrackUrl(sourceUrl)
    if (!normalized) return null

    if (normalizedCache.has(normalized)) {
      return normalizedCache.get(normalized) ?? null
    }

    const reusable = await findReusableSongBySourceUrl(userId, "spotify", normalized)
    normalizedCache.set(normalized, reusable)
    return reusable
  }

  const results = await downloadSpotify(
    {
      url: task.sourceUrl,
      format,
      concurrency: SPOTIFY_DOWNLOAD_CONCURRENCY,
      shouldDownloadTrack: async (track, context) => {
        if (context.total > 0) {
          await prisma.downloadTask.update({
            where: { id: taskId },
            data: { totalItems: context.total },
          })
        }

        const reusableSong = await findReusableBySpotifyUrl(track.sourceUrl)
        if (!reusableSong) {
          return true
        }

        await assignSongToTaskPlaylistIfNeeded(userId, reusableSong, taskPlaylistId)
        const progressPrefix = `[${context.index + 1}/${context.total}]`
        await logEvent(taskId, "status", `${progressPrefix} Already downloaded: ${reusableSong.title}`)
        await logEvent(taskId, "track", `${progressPrefix} Reused: ${reusableSong.title}`, {
          kind: "skip",
          reason: "file_exists",
          songId: reusableSong.id,
        })
        await updateTaskCounts(taskId, { processed: 1, successful: 1 })
        return false
      },
    },
    (message) => {
      void logEvent(taskId, "progress", message)
      const found = message.match(/^Found (\d+) Spotify track\(s\)\./)
      if (found) {
        const total = Number.parseInt(found[1], 10)
        if (Number.isFinite(total) && total > 0) {
          void prisma.downloadTask.update({
            where: { id: taskId },
            data: { totalItems: total },
          })
        }
      }
    }
  )

  for (const result of results) {
    const reusableSong = await findReusableBySpotifyUrl(result.sourceUrl)
    if (reusableSong) {
      await assignSongToTaskPlaylistIfNeeded(userId, reusableSong, taskPlaylistId)
      cleanupFileIfExists(result.filePath)
      await logEvent(taskId, "track", `Reused: ${reusableSong.title}`, {
        kind: "skip",
        reason: "file_exists",
        songId: reusableSong.id,
      })
      await updateTaskCounts(taskId, { processed: 1, successful: 1 })
      continue
    }

    const thumbnail = result.thumbnail || spotifyThumbnail
    const normalizedSourceUrl = normalizeSpotifyTrackUrl(result.sourceUrl)
    const refs = await ensureArtistAlbumRefs({
      userId,
      artist: result.artist || null,
      album: result.album || "Singles",
      albumArtist: result.albumArtist || result.artist || null,
      year: parseYearCandidate(result.releaseDate),
    })
    const normalizedTitle = normalizeSongTitle(result.title || "Unknown title")
    const organized = await organizeDownloadedAudio({
      filePath: result.filePath,
      artist: refs.artist,
      album: refs.album,
      year: parseYearCandidate(result.releaseDate),
      discNumber: parsePositiveIntCandidate(result.discNumber),
      trackNumber: parsePositiveIntCandidate(result.trackNumber),
      title: normalizedTitle,
      preferredExt: result.format,
    })

    const songSourceUrl = normalizedSourceUrl || result.sourceUrl || null
    const songCreateData = {
      userId,
      title: normalizedTitle,
      artist: refs.artist,
      album: refs.album,
      albumArtist: refs.albumArtist,
      artistId: refs.artistId,
      albumId: refs.albumId,
      trackNumber: parsePositiveIntCandidate(result.trackNumber),
      discNumber: parsePositiveIntCandidate(result.discNumber),
      isrc: result.isrc || null,
      year: parseYearCandidate(result.releaseDate),
      duration: result.duration,
      format: result.format,
      quality: result.quality,
      source: "spotify",
      sourceUrl: songSourceUrl,
      filePath: organized.filePath,
      relativePath: organized.relativePath,
      thumbnail,
      coverPath: null,
      fileSize: organized.fileSize || result.fileSize,
      downloadTaskId: taskId,
      playlistId: taskPlaylistId,
    }

    await logEvent(
      taskId,
      "info",
      `[spotify] Metadata: ${summarizeTrackMetadata({
        title: songCreateData.title,
        artist: songCreateData.artist,
        album: songCreateData.album,
        trackNumber: songCreateData.trackNumber,
        discNumber: songCreateData.discNumber,
        year: songCreateData.year,
        isrc: songCreateData.isrc,
        duration: songCreateData.duration,
      })}`
    )

    const createdSong = await prisma.song.create({ data: songCreateData }).catch(async (error) => {
      if (isUniqueConstraintError(error)) {
        const concurrentSong = await findReusableBySpotifyUrl(songSourceUrl)
        if (concurrentSong) {
          await assignSongToTaskPlaylistIfNeeded(userId, concurrentSong, taskPlaylistId)
          cleanupFileIfExists(organized.filePath)
          await logEvent(taskId, "track", `Reused: ${concurrentSong.title}`, {
            kind: "skip",
            reason: "file_exists",
            songId: concurrentSong.id,
          })
          await updateTaskCounts(taskId, { processed: 1, successful: 1 })
          return null
        }
      }
      throw error
    })

    if (!createdSong) {
      continue
    }

    await assignSongToTaskPlaylistIfNeeded(userId, createdSong, taskPlaylistId)

    let song = createdSong

    const coverPath = await downloadSongArtwork(song.id, thumbnail, song.filePath)
    if (coverPath) {
      song = await prisma.song.update({
        where: { id: song.id },
        data: { coverPath },
      })
    }

    if (normalizedSourceUrl) {
      normalizedCache.set(normalizedSourceUrl, song)
    }

    await logEvent(taskId, "track", `Added: ${song.title}`, { songId: song.id })
    await exportLyricsSidecarIfEnabled(taskId, song.id)
    await updateTaskCounts(taskId, { processed: 1, successful: 1 })
  }

  const refreshed = await prisma.downloadTask.findUnique({
    where: { id: taskId },
    select: { totalItems: true, processedItems: true, failedItems: true },
  })

  if (refreshed?.totalItems && refreshed.processedItems < refreshed.totalItems) {
    const remaining = refreshed.totalItems - refreshed.processedItems
    await updateTaskCounts(taskId, { processed: remaining, failed: remaining })
    await logEvent(taskId, "error", `${remaining} track(s) could not be downloaded.`)
  }
}

let eventCounter = 0
let activeTaskUserId = 0
async function logEvent(
  taskId: number,
  level: "status" | "progress" | "track" | "error" | "info",
  message: string,
  payload?: unknown
) {
  const normalizedPayload = payload === undefined && level === "progress"
    ? parseProgressPayload(message)
    : payload
  await appendTaskEvent(activeTaskUserId, taskId, level, message, normalizedPayload)
  eventCounter += 1
  if (eventCounter % 40 === 0) {
    await trimTaskEvents(activeTaskUserId, taskId)
  }
}

async function markTaskFailed(taskId: number, errorMessage: string) {
  const safeErrorMessage = redactSensitiveText(errorMessage)
  await prisma.downloadTask.update({
    where: { id: taskId },
    data: {
      status: "failed",
      errorMessage: safeErrorMessage,
      completedAt: new Date(),
      workerPid: null,
    },
  })
  await logEvent(taskId, "error", safeErrorMessage)
}

async function markTaskCompleted(taskId: number) {
  const task = await prisma.downloadTask.findUnique({
    where: { id: taskId },
    select: { failedItems: true },
  })

  const completedStatus = task && task.failedItems > 0 ? "completed_with_errors" : "completed"
  const statusMessage =
    completedStatus === "completed"
      ? "Task completed successfully."
      : "Task completed with some errors."

  await prisma.downloadTask.update({
    where: { id: taskId },
    data: {
      status: completedStatus,
      completedAt: new Date(),
      workerPid: null,
      errorMessage: null,
    },
  })

  await logEvent(taskId, "status", statusMessage)
}

async function runTask(taskId: number) {
  const task = await prisma.downloadTask.findUnique({
    where: { id: taskId },
    select: { id: true, source: true, status: true, startedAt: true, userId: true },
  })

  if (!task) {
    return
  }

  if (task.status !== "queued") {
    return
  }

  const claimed = await prisma.downloadTask.updateMany({
    where: { id: taskId, status: "queued" },
    data: {
      status: "running",
      startedAt: task.startedAt || new Date(),
      errorMessage: null,
      workerPid: process.pid,
    },
  })

  if (claimed.count === 0) {
    return
  }
  if (!task.userId) {
    await markTaskFailed(taskId, "Task has no owner.")
    return
  }

  activeTaskUserId = task.userId
  await logEvent(taskId, "status", `Worker started (PID ${process.pid}).`)

  // Periodic heartbeat so stale-task recovery knows we're alive
  const heartbeatInterval = setInterval(() => {
    void updateTaskHeartbeat(taskId)
  }, 30_000) // every 30 seconds

  try {
    await updateTaskHeartbeat(taskId)

    if (task.source === "spotify") {
      await runSpotifyTask(taskId)
    } else if (task.source === "youtube" || task.source === "soundcloud") {
      await runVideoTask(taskId)
    } else {
      throw new Error(`Unsupported task source: ${task.source}`)
    }

    await markTaskCompleted(taskId)
  } catch (error) {
    const message = redactSensitiveText(error instanceof Error ? error.message : "Unknown task failure")
    await markTaskFailed(taskId, message)
  } finally {
    clearInterval(heartbeatInterval)
    try {
      await drainQueuedTaskWorkers()
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to drain queued workers"
      console.error(message)
    }
    await prisma.$disconnect()
  }
}

async function main() {
  const taskIdRaw = process.argv[2]
  const taskId = Number.parseInt(taskIdRaw || "", 10)
  if (!Number.isInteger(taskId) || taskId <= 0) {
    process.exit(1)
    return
  }

  await runTask(taskId)
}

main().catch(async (error) => {
  // Last-resort error reporting if task-specific handling failed before task ID was parsed.
  console.error("Download task worker crashed:", error)
  try {
    await prisma.$disconnect()
  } catch {
    // ignore
  }
  process.exit(1)
})
