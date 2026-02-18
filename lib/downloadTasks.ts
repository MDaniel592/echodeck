import { spawn } from "child_process"
import fs from "fs"
import fsPromises from "fs/promises"
import { createRequire } from "module"
import path from "path"
import prisma from "./prisma"
import { redactSensitiveText } from "./sanitize"

export type DownloadTaskSource = "youtube" | "soundcloud" | "spotify" | "tidal" | "amazon"
export type DownloadTaskStatus =
  | "queued"
  | "running"
  | "completed"
  | "completed_with_errors"
  | "failed"

export const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "youtu.be", "m.youtube.com", "music.youtube.com"])
export const SOUNDCLOUD_HOSTS = new Set(["soundcloud.com", "www.soundcloud.com", "on.soundcloud.com"])
export const SPOTIFY_HOSTS = new Set(["open.spotify.com", "spotify.com", "www.spotify.com"])
export const TIDAL_HOSTS = new Set(["listen.tidal.com", "tidal.com", "www.tidal.com"])
export const AMAZON_MUSIC_HOSTS = new Set([
  "music.amazon.com",
  "www.music.amazon.com",
  "amazon.com",
  "www.amazon.com",
])

export const AUDIO_FORMATS = new Set(["mp3", "flac", "wav", "ogg"])
export const AUDIO_QUALITIES = new Set(["best", "320", "256", "192", "128"])
export const BEST_AUDIO_PREFERENCES = new Set(["auto", "opus", "aac"])
const DOWNLOAD_TASK_LOG_DIR =
  (process.env.DOWNLOAD_TASK_LOG_DIR || "").trim() ||
  path.join(process.cwd(), "logs", "download-tasks")
const DOWNLOAD_TASK_FILE_LOGGING_ENABLED = !/^(0|false|off|no)$/i.test(
  (process.env.DOWNLOAD_TASK_FILE_LOGGING || "1").trim()
)
const runtimeRequire = createRequire(path.join(process.cwd(), "package.json"))

export class PlaylistSelectionError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = "PlaylistSelectionError"
    this.status = status
  }
}

async function appendTaskEventToFile(input: {
  userId: number
  taskId: number
  level: "status" | "progress" | "track" | "error" | "info"
  message: string
  payload: string | null
}) {
  if (!DOWNLOAD_TASK_FILE_LOGGING_ENABLED) return

  const timestamp = new Date().toISOString()
  const dateBucket = timestamp.slice(0, 10)
  const logPath = path.join(DOWNLOAD_TASK_LOG_DIR, `${dateBucket}.jsonl`)
  const line = JSON.stringify({
    ts: timestamp,
    userId: input.userId,
    taskId: input.taskId,
    level: input.level,
    message: input.message,
    payload: input.payload,
  })

  try {
    await fsPromises.mkdir(DOWNLOAD_TASK_LOG_DIR, { recursive: true })
    await fsPromises.appendFile(logPath, `${line}\n`, "utf8")
  } catch (error) {
    // Best-effort disk logging should never break task processing.
    const reason = error instanceof Error ? error.message : String(error)
    console.error(`[download-task-log] Failed writing ${logPath}: ${reason}`)
  }
}

export function detectSourceFromUrl(url: string): DownloadTaskSource | null {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()

    if (YOUTUBE_HOSTS.has(host)) return "youtube"
    if (SOUNDCLOUD_HOSTS.has(host)) return "soundcloud"
    if (SPOTIFY_HOSTS.has(host)) return "spotify"
    if (TIDAL_HOSTS.has(host)) return "tidal"
    if (AMAZON_MUSIC_HOSTS.has(host)) return "amazon"
    return null
  } catch {
    return null
  }
}

export function normalizeFormat(input: unknown): "mp3" | "flac" | "wav" | "ogg" {
  const value = String(input || "mp3").toLowerCase()
  return AUDIO_FORMATS.has(value) ? (value as "mp3" | "flac" | "wav" | "ogg") : "mp3"
}

export function normalizeQuality(input: unknown): "best" | "320" | "256" | "192" | "128" {
  const value = String(input || "best").toLowerCase()
  return AUDIO_QUALITIES.has(value) ? (value as "best" | "320" | "256" | "192" | "128") : "best"
}

export function normalizeBestAudioPreference(input: unknown): "auto" | "opus" | "aac" {
  const value = String(input || "auto").toLowerCase()
  return BEST_AUDIO_PREFERENCES.has(value) ? (value as "auto" | "opus" | "aac") : "auto"
}

export async function resolveTaskPlaylistSelection(input: {
  userId: number
  playlistId?: unknown
  playlistName?: unknown
}): Promise<{ playlistId: number | null; playlistName: string | null; created: boolean }> {
  const rawPlaylistId = input.playlistId
  const hasPlaylistId =
    rawPlaylistId !== undefined &&
    rawPlaylistId !== null &&
    String(rawPlaylistId).trim() !== ""

  const playlistName = typeof input.playlistName === "string" ? input.playlistName.trim() : ""

  if (hasPlaylistId && playlistName) {
    throw new PlaylistSelectionError("Choose an existing playlist or create a new one, not both.")
  }

  if (hasPlaylistId) {
    const parsedId = Number.parseInt(String(rawPlaylistId), 10)
    if (!Number.isInteger(parsedId) || parsedId <= 0) {
      throw new PlaylistSelectionError("Invalid playlist selection.")
    }

    const playlist = await prisma.playlist.findFirst({
      where: { id: parsedId, userId: input.userId },
      select: { id: true, name: true },
    })
    if (!playlist) {
      throw new PlaylistSelectionError("Selected playlist was not found.", 404)
    }

    return { playlistId: playlist.id, playlistName: playlist.name, created: false }
  }

  if (!playlistName) {
    return { playlistId: null, playlistName: null, created: false }
  }

  if (playlistName.length > 80) {
    throw new PlaylistSelectionError("Playlist name is too long.")
  }

  const existing = await prisma.playlist.findUnique({
    where: {
      userId_name: {
        userId: input.userId,
        name: playlistName,
      },
    },
    select: { id: true, name: true },
  })
  if (existing) {
    return { playlistId: existing.id, playlistName: existing.name, created: false }
  }

  try {
    const createdPlaylist = await prisma.playlist.create({
      data: { userId: input.userId, name: playlistName },
      select: { id: true, name: true },
    })
    return { playlistId: createdPlaylist.id, playlistName: createdPlaylist.name, created: true }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      const conflictPlaylist = await prisma.playlist.findUnique({
        where: {
          userId_name: {
            userId: input.userId,
            name: playlistName,
          },
        },
        select: { id: true, name: true },
      })
      if (conflictPlaylist) {
        return { playlistId: conflictPlaylist.id, playlistName: conflictPlaylist.name, created: false }
      }
    }
    throw error
  }
}

export async function appendTaskEvent(
  userId: number,
  taskId: number,
  level: "status" | "progress" | "track" | "error" | "info",
  message: string,
  payload?: unknown
) {
  const normalizedMessage = message.trim()
  const safeMessage =
    level === "error"
      ? redactSensitiveText(normalizedMessage).slice(0, 2000)
      : normalizedMessage.slice(0, 2000)
  const rawPayload =
    payload === undefined
      ? null
      : JSON.stringify(payload, (_key, value) => {
          if (value instanceof Error) {
            return { name: value.name, message: value.message, stack: value.stack }
          }
          return value
        })
  const safePayload = rawPayload
    ? level === "error"
      ? redactSensitiveText(rawPayload).slice(0, 12000)
      : rawPayload.slice(0, 12000)
    : null

  await prisma.downloadTaskEvent.create({
    data: {
      userId,
      taskId,
      level,
      message: safeMessage,
      payload: safePayload,
    },
  })

  await appendTaskEventToFile({
    userId,
    taskId,
    level,
    message: safeMessage,
    payload: safePayload,
  })
}

export async function trimTaskEvents(userId: number, taskId: number, maxEvents = 1500) {
  const count = await prisma.downloadTaskEvent.count({ where: { userId, taskId } })
  if (count <= maxEvents) return

  const toDelete = await prisma.downloadTaskEvent.findMany({
    where: { userId, taskId },
    orderBy: { id: "asc" },
    take: count - maxEvents,
    select: { id: true },
  })

  if (toDelete.length > 0) {
    await prisma.downloadTaskEvent.deleteMany({
      where: { id: { in: toDelete.map((row) => row.id) } },
    })
  }
}

export async function enqueueDownloadTask(input: {
  userId: number
  source: DownloadTaskSource
  sourceUrl: string
  format: "mp3" | "flac" | "wav" | "ogg"
  quality?: "best" | "320" | "256" | "192" | "128"
  bestAudioPreference?: "auto" | "opus" | "aac"
  playlistId?: number | null
}) {
  const task = await prisma.downloadTask.create({
    data: {
      userId: input.userId,
      source: input.source,
      sourceUrl: input.sourceUrl,
      format: input.format,
      quality: input.quality ?? null,
      bestAudioPreference: input.bestAudioPreference ?? null,
      playlistId: input.playlistId ?? null,
      status: "queued",
    },
    include: {
      playlist: {
        select: { id: true, name: true },
      },
    },
  })

  await appendTaskEvent(input.userId, task.id, "status", "Task queued.")
  return task
}

const WORKER_PENDING_PID = -1

function getMaxConcurrentWorkers(): number {
  const parsed = Number.parseInt(process.env.DOWNLOAD_TASK_MAX_WORKERS || "", 10)
  if (!Number.isInteger(parsed)) return 4
  return Math.min(Math.max(parsed, 1), 20)
}

async function getActiveWorkerCount(): Promise<number> {
  return prisma.downloadTask.count({
    where: {
      OR: [
        { status: "running" },
        { status: "queued", workerPid: { not: null } },
      ],
    },
  })
}

async function claimQueuedTaskForSpawn(taskId: number): Promise<boolean> {
  const claimed = await prisma.downloadTask.updateMany({
    where: {
      id: taskId,
      status: "queued",
      workerPid: null,
    },
    data: {
      workerPid: WORKER_PENDING_PID,
    },
  })

  return claimed.count > 0
}

async function spawnWorkerForClaimedTask(taskId: number) {
  const task = await prisma.downloadTask.findUnique({
    where: { id: taskId },
    select: { userId: true },
  })
  if (!task || !task.userId) {
    throw new Error("Task not found while spawning worker")
  }

  try {
    runtimeRequire.resolve("tsx/package.json")
  } catch {
    throw new Error("Task runner not found: tsx package is required at runtime")
  }

  const workerScript = path.join(process.cwd(), "scripts", "run-download-task.ts")
  if (!fs.existsSync(workerScript)) {
    throw new Error("Task worker script not found: scripts/run-download-task.ts")
  }

  const child = spawn(process.execPath, ["--import", "tsx", workerScript, String(taskId)], {
    cwd: process.cwd(),
    env: process.env,
    detached: true,
    stdio: "ignore",
  })

  child.unref()

  const workerPid = typeof child.pid === "number" ? child.pid : null
  await prisma.downloadTask.update({
    where: { id: taskId },
    data: { workerPid },
  })

  await appendTaskEvent(
    task.userId,
    taskId,
    "status",
    workerPid ? `Background worker started (PID ${workerPid}).` : "Background worker started."
  )
}

async function markTaskSpawnFailure(taskId: number, error: unknown) {
  const message = redactSensitiveText(error instanceof Error ? error.message : "Failed to start worker")
  const task = await prisma.downloadTask.findUnique({
    where: { id: taskId },
    select: { userId: true },
  })
  if (!task?.userId) return

  await prisma.downloadTask.update({
    where: { id: taskId },
    data: {
      status: "failed",
      errorMessage: message,
      completedAt: new Date(),
      workerPid: null,
    },
  })
  await appendTaskEvent(task.userId, taskId, "error", message)
}

export async function drainQueuedTaskWorkers(): Promise<number> {
  const maxWorkers = getMaxConcurrentWorkers()
  const activeWorkers = await getActiveWorkerCount()
  const availableSlots = maxWorkers - activeWorkers
  if (availableSlots <= 0) {
    return 0
  }

  const queuedTasks = await prisma.downloadTask.findMany({
    where: { status: "queued", workerPid: null },
    orderBy: { createdAt: "asc" },
    take: availableSlots,
    select: { id: true },
  })

  let started = 0
  for (const task of queuedTasks) {
    const claimed = await claimQueuedTaskForSpawn(task.id)
    if (!claimed) continue
    try {
      await spawnWorkerForClaimedTask(task.id)
      started++
    } catch (error) {
      await markTaskSpawnFailure(task.id, error)
    }
  }

  return started
}

export async function startDownloadTaskWorker(taskId: number): Promise<boolean> {
  const maxWorkers = getMaxConcurrentWorkers()
  const activeWorkers = await getActiveWorkerCount()

  const task = await prisma.downloadTask.findUnique({
    where: { id: taskId },
    select: { userId: true },
  })
  if (!task?.userId) return false

  if (activeWorkers >= maxWorkers) {
    await appendTaskEvent(
      task.userId,
      taskId,
      "status",
      `Task queued: waiting for worker slot (${activeWorkers}/${maxWorkers} active).`
    )
    return false
  }

  const claimed = await claimQueuedTaskForSpawn(taskId)
  if (!claimed) {
    return false
  }

  await spawnWorkerForClaimedTask(taskId)
  return true
}

export function isTerminalTaskStatus(status: string): boolean {
  return status === "completed" || status === "completed_with_errors" || status === "failed"
}

/**
 * Check if a process with the given PID is alive.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const STALE_HEARTBEAT_MS = 5 * 60 * 1000 // 5 minutes without heartbeat = stale

/**
 * Find and mark stuck "running" tasks as failed.
 * A task is stuck if:
 * - Its workerPid is set but the process is dead, OR
 * - Its heartbeat is older than STALE_HEARTBEAT_MS
 */
export async function recoverStaleTasks(): Promise<number> {
  const runningTasks = await prisma.downloadTask.findMany({
    where: { status: "running" },
    select: { id: true, userId: true, workerPid: true, heartbeatAt: true, startedAt: true },
  })

  let recovered = 0
  const now = Date.now()

  for (const task of runningTasks) {
    let isStale = false

    // Check if worker PID is dead
    if (task.workerPid && !isProcessAlive(task.workerPid)) {
      isStale = true
    }

    // Check heartbeat staleness
    if (!isStale && task.heartbeatAt) {
      const heartbeatAge = now - task.heartbeatAt.getTime()
      if (heartbeatAge > STALE_HEARTBEAT_MS) {
        isStale = true
      }
    }

    // No heartbeat and started more than STALE_HEARTBEAT_MS ago
    if (!isStale && !task.heartbeatAt && task.startedAt) {
      const startAge = now - task.startedAt.getTime()
      if (startAge > STALE_HEARTBEAT_MS) {
        isStale = true
      }
    }

    if (isStale) {
      await prisma.downloadTask.update({
        where: { id: task.id },
        data: {
          status: "failed",
          errorMessage: "Worker process died or stopped responding.",
          completedAt: new Date(),
          workerPid: null,
        },
      })
      if (task.userId) {
        await appendTaskEvent(task.userId, task.id, "error", "Task recovered: worker process died or stopped responding.")
      }
      recovered++
    }
  }

  return recovered
}

/**
 * Update the heartbeat timestamp for a running task.
 */
export async function updateTaskHeartbeat(taskId: number): Promise<void> {
  await prisma.downloadTask.updateMany({
    where: { id: taskId, status: "running" },
    data: { heartbeatAt: new Date() },
  })
}
