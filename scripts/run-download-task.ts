import fs from "fs"
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
import { runWithConcurrency } from "../lib/asyncPool"
import { waitRandomDelay } from "../lib/downloadThrottle"
import { downloadSpotify } from "../lib/spotdl"
import { downloadAudio, getPlaylistInfo, getVideoInfo } from "../lib/ytdlp"
import { redactSensitiveText } from "../lib/sanitize"
import { findReusableSongBySourceUrl, normalizeSoundCloudUrl, normalizeSpotifyTrackUrl } from "../lib/songDedup"
import { assignSongToPlaylistForUser } from "../lib/playlistEntries"

const YOUTUBE_VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{11}$/
const DOWNLOAD_CONCURRENCY = 4
const DOWNLOAD_DELAY_MIN_MS = 1000
const DOWNLOAD_DELAY_MAX_MS = 3000

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
    const total = playlist.entries.length
    if (total === 0) {
      throw new Error("No downloadable tracks were found in this playlist.")
    }

    await prisma.downloadTask.update({
      where: { id: taskId },
      data: {
        isPlaylist: true,
        playlistTitle: playlist.title,
        totalItems: total,
      },
    })

    await logEvent(taskId, "info", `Playlist: ${playlist.title}`)
    await logEvent(
      taskId,
      "status",
      `Found ${total} tracks. Starting background queue (${DOWNLOAD_CONCURRENCY} parallel downloads)...`
    )

    await runWithConcurrency(playlist.entries, DOWNLOAD_CONCURRENCY, async (entry, index) => {
      const progressPrefix = `[${index + 1}/${total}]`
      const normalizedTrackUrl = normalizeYouTubeUrl(entry.url)
      let shouldThrottle = false

      try {
        const reusableSong = await findReusableSongBySourceUrl(userId, source, normalizedTrackUrl)
        if (reusableSong) {
          await assignSongToTaskPlaylistIfNeeded(userId, reusableSong, taskPlaylistId)
          await logEvent(taskId, "status", `${progressPrefix} Already in library: ${reusableSong.title}`)
          await logEvent(taskId, "track", `${progressPrefix} Reused: ${reusableSong.title}`, {
            songId: reusableSong.id,
          })
          await updateTaskCounts(taskId, { processed: 1, successful: 1 })
          return
        }

        await logEvent(taskId, "status", `${progressPrefix} Downloading: ${entry.title}`)
        shouldThrottle = true

        const result = await downloadAudio(
          { url: normalizedTrackUrl, format, quality, bestAudioPreference },
          (message) => {
            void logEvent(taskId, "progress", `${progressPrefix} ${message}`)
          }
        )

        const existingAfterDownload = await findReusableSongBySourceUrl(userId, source, normalizedTrackUrl)
        if (existingAfterDownload) {
          await assignSongToTaskPlaylistIfNeeded(userId, existingAfterDownload, taskPlaylistId)
          cleanupFileIfExists(result.filePath)
          await logEvent(taskId, "track", `${progressPrefix} Reused: ${existingAfterDownload.title}`, {
            songId: existingAfterDownload.id,
          })
          await updateTaskCounts(taskId, { processed: 1, successful: 1 })
          return
        }

        let fileSize: number | null = null
        try {
          const stats = fs.statSync(result.filePath)
          fileSize = stats.size
        } catch {
          // ignore
        }

        const thumbnail = result.thumbnail || entry.thumbnail
        const songCreateData = {
          userId,
          title: result.title || entry.title,
          artist: result.artist || entry.artist,
          duration: result.duration ?? entry.duration,
          format: result.format,
          quality: quality === "best" ? `source:${bestAudioPreference}` : `${quality}kbps`,
          source,
          sourceUrl: normalizedTrackUrl,
          filePath: result.filePath,
          thumbnail,
          coverPath: null,
          fileSize: fileSize || result.fileSize,
          downloadTaskId: taskId,
          playlistId: taskPlaylistId,
        }

        const createdSong = await prisma.song.create({ data: songCreateData }).catch(async (error) => {
          if (isUniqueConstraintError(error)) {
            const concurrentSong = await findReusableSongBySourceUrl(userId, source, normalizedTrackUrl)
            if (concurrentSong) {
              await assignSongToTaskPlaylistIfNeeded(userId, concurrentSong, taskPlaylistId)
              cleanupFileIfExists(result.filePath)
              await logEvent(taskId, "track", `${progressPrefix} Reused: ${concurrentSong.title}`, {
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

        await assignSongToTaskPlaylistIfNeeded(userId, createdSong, taskPlaylistId)

        let song = createdSong

        const coverPath = await downloadSongArtwork(song.id, thumbnail)
        if (coverPath) {
          song = await prisma.song.update({
            where: { id: song.id },
            data: { coverPath },
          })
        }

        await logEvent(taskId, "track", `${progressPrefix} Added: ${song.title}`, { songId: song.id })
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
  if (reusableSong) {
    await assignSongToTaskPlaylistIfNeeded(userId, reusableSong, taskPlaylistId)
    await logEvent(taskId, "status", "Song already downloaded. Reusing existing file.")
    await logEvent(taskId, "track", `Reused: ${reusableSong.title}`, { songId: reusableSong.id })
    await updateTaskCounts(taskId, { processed: 1, successful: 1 })
    return
  }

  await logEvent(taskId, "status", "Fetching media info...")
  const info = await getVideoInfo(normalizedUrl)
  await logEvent(taskId, "info", `Track: ${info.title}`)
  await logEvent(taskId, "status", "Starting download...")

  const result = await downloadAudio(
    { url: normalizedUrl, format, quality, bestAudioPreference },
    (message) => {
      void logEvent(taskId, "progress", message)
    }
  )

  const existingAfterDownload = await findReusableSongBySourceUrl(userId, source, normalizedUrl)
  if (existingAfterDownload) {
    await assignSongToTaskPlaylistIfNeeded(userId, existingAfterDownload, taskPlaylistId)
    cleanupFileIfExists(result.filePath)
    await logEvent(taskId, "track", `Reused: ${existingAfterDownload.title}`, { songId: existingAfterDownload.id })
    await updateTaskCounts(taskId, { processed: 1, successful: 1 })
    return
  }

  let fileSize: number | null = null
  try {
    const stats = fs.statSync(result.filePath)
    fileSize = stats.size
  } catch {
    // ignore
  }

  const thumbnail = result.thumbnail || info.thumbnail
  const songCreateData = {
    userId,
    title: result.title || info.title,
    artist: result.artist || info.artist,
    duration: result.duration || info.duration,
    format: result.format,
    quality: quality === "best" ? `source:${bestAudioPreference}` : `${quality}kbps`,
    source,
    sourceUrl: normalizedUrl,
    filePath: result.filePath,
    thumbnail,
    coverPath: null,
    fileSize: fileSize || result.fileSize,
    downloadTaskId: taskId,
    playlistId: taskPlaylistId,
  }

  const createdSong = await prisma.song.create({ data: songCreateData }).catch(async (error) => {
    if (isUniqueConstraintError(error)) {
      const concurrentSong = await findReusableSongBySourceUrl(userId, source, normalizedUrl)
      if (concurrentSong) {
        await assignSongToTaskPlaylistIfNeeded(userId, concurrentSong, taskPlaylistId)
        cleanupFileIfExists(result.filePath)
        await logEvent(taskId, "track", `Reused: ${concurrentSong.title}`, { songId: concurrentSong.id })
        await updateTaskCounts(taskId, { processed: 1, successful: 1 })
        return null
      }
    }
    throw error
  })

  if (!createdSong) {
    return
  }

  await assignSongToTaskPlaylistIfNeeded(userId, createdSong, taskPlaylistId)

  let song = createdSong

  const coverPath = await downloadSongArtwork(song.id, thumbnail)
  if (coverPath) {
    song = await prisma.song.update({
      where: { id: song.id },
      data: { coverPath },
    })
  }

  await logEvent(taskId, "track", `Added: ${song.title}`, { songId: song.id })
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
      concurrency: DOWNLOAD_CONCURRENCY,
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
      await logEvent(taskId, "track", `Reused: ${reusableSong.title}`, { songId: reusableSong.id })
      await updateTaskCounts(taskId, { processed: 1, successful: 1 })
      continue
    }

    const thumbnail = result.thumbnail || spotifyThumbnail
    const normalizedSourceUrl = normalizeSpotifyTrackUrl(result.sourceUrl)

    const songSourceUrl = normalizedSourceUrl || result.sourceUrl || null
    const songCreateData = {
      userId,
      title: result.title,
      artist: result.artist,
      duration: result.duration,
      format: result.format,
      quality: result.quality,
      source: "spotify",
      sourceUrl: songSourceUrl,
      filePath: result.filePath,
      thumbnail,
      coverPath: null,
      fileSize: result.fileSize,
      downloadTaskId: taskId,
      playlistId: taskPlaylistId,
    }

    const createdSong = await prisma.song.create({ data: songCreateData }).catch(async (error) => {
      if (isUniqueConstraintError(error)) {
        const concurrentSong = await findReusableBySpotifyUrl(songSourceUrl)
        if (concurrentSong) {
          await assignSongToTaskPlaylistIfNeeded(userId, concurrentSong, taskPlaylistId)
          cleanupFileIfExists(result.filePath)
          await logEvent(taskId, "track", `Reused: ${concurrentSong.title}`, { songId: concurrentSong.id })
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

    const coverPath = await downloadSongArtwork(song.id, thumbnail)
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
  await appendTaskEvent(activeTaskUserId, taskId, level, message, payload)
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
