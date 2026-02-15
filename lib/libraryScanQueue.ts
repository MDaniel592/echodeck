import fs from "fs"
import prisma from "./prisma"
import { runLibraryScan } from "./libraryScanner"

let draining = false
let schedulerStarted = false
let watchersStarted = false
let schedulerInterval: ReturnType<typeof setInterval> | null = null
let watcherRefreshInterval: ReturnType<typeof setInterval> | null = null
const watchHandles = new Map<number, fs.FSWatcher>()
const libraryDebounceTimers = new Map<number, ReturnType<typeof setTimeout>>()

function getMaxWorkers(): number {
  const parsed = Number.parseInt(process.env.LIBRARY_SCAN_MAX_WORKERS || "", 10)
  if (!Number.isInteger(parsed)) return 1
  return Math.min(Math.max(parsed, 1), 8)
}

function getScheduleMinutes(): number {
  const parsed = Number.parseInt(process.env.LIBRARY_SCAN_INTERVAL_MINUTES || "", 10)
  if (!Number.isInteger(parsed) || parsed <= 0) return 0
  return Math.min(parsed, 24 * 60)
}

function getWatchEnabled(): boolean {
  return process.env.LIBRARY_SCAN_WATCH === "1"
}

function getWatchRefreshMs(): number {
  const parsed = Number.parseInt(process.env.LIBRARY_SCAN_WATCH_REFRESH_MS || "", 10)
  if (!Number.isInteger(parsed) || parsed < 10_000) return 300_000
  return parsed
}

async function getActiveWorkerCount(): Promise<number> {
  return prisma.libraryScanRun.count({
    where: { status: "running" },
  })
}

async function claimQueuedRun(runId: number): Promise<boolean> {
  const updated = await prisma.libraryScanRun.updateMany({
    where: { id: runId, status: "queued" },
    data: { status: "running", startedAt: new Date(), error: null, finishedAt: null },
  })
  return updated.count > 0
}

async function processClaimedRun(runId: number, userId: number, libraryId: number): Promise<void> {
  try {
    await runLibraryScan(userId, libraryId, { scanRunId: runId })
  } catch (error) {
    await prisma.libraryScanRun.update({
      where: { id: runId },
      data: {
        status: "failed",
        finishedAt: new Date(),
        error: error instanceof Error ? error.message : "Scan failed",
      },
    }).catch(() => {})
  }
}

export async function drainLibraryScanQueue(): Promise<number> {
  if (draining) return 0
  draining = true

  let started = 0
  try {
    const maxWorkers = getMaxWorkers()
    while (true) {
      const active = await getActiveWorkerCount()
      const available = maxWorkers - active
      if (available <= 0) break

      const queuedRuns = await prisma.libraryScanRun.findMany({
        where: { status: "queued" },
        orderBy: { id: "asc" },
        take: available,
        select: {
          id: true,
          libraryId: true,
          library: { select: { userId: true } },
        },
      })
      if (queuedRuns.length === 0) break

      for (const run of queuedRuns) {
        const claimed = await claimQueuedRun(run.id)
        if (!claimed) continue
        started++
        void processClaimedRun(run.id, run.library.userId, run.libraryId)
      }
    }
  } finally {
    draining = false
  }

  return started
}

export async function enqueueLibraryScan(userId: number, libraryId: number): Promise<{
  accepted: boolean
  reason?: string
  scanRunId?: number
}> {
  const library = await prisma.library.findFirst({
    where: { id: libraryId, userId },
    select: { id: true },
  })
  if (!library) {
    return { accepted: false, reason: "Library not found." }
  }

  const existing = await prisma.libraryScanRun.findFirst({
    where: {
      libraryId,
      status: { in: ["queued", "running"] },
    },
    orderBy: { startedAt: "desc" },
    select: { id: true },
  })
  if (existing) {
    return { accepted: false, reason: "A scan is already queued or running for this library." }
  }

  const run = await prisma.libraryScanRun.create({
    data: {
      libraryId,
      status: "queued",
      startedAt: new Date(),
    },
    select: { id: true },
  })

  void drainLibraryScanQueue()
  return { accepted: true, scanRunId: run.id }
}

export async function isLibraryScanActive(userId: number, libraryId: number): Promise<boolean> {
  const count = await prisma.libraryScanRun.count({
    where: {
      libraryId,
      library: { userId },
      status: { in: ["queued", "running"] },
    },
  })
  return count > 0
}

export async function recoverLibraryScanQueue(): Promise<{ failedRunning: number; queuedStarted: number }> {
  const failed = await prisma.libraryScanRun.updateMany({
    where: { status: "running" },
    data: {
      status: "failed",
      finishedAt: new Date(),
      error: "Scan interrupted by server restart.",
    },
  })

  const started = await drainLibraryScanQueue()
  return { failedRunning: failed.count, queuedStarted: started }
}

export async function queueAllLibrariesForScan(): Promise<number> {
  const libraries = await prisma.library.findMany({
    select: { id: true, userId: true },
  })
  let queued = 0
  for (const library of libraries) {
    const result = await enqueueLibraryScan(library.userId, library.id)
    if (result.accepted) queued++
  }
  return queued
}

function clearWatchers() {
  for (const watcher of watchHandles.values()) {
    try {
      watcher.close()
    } catch {
      // ignore watcher close failures
    }
  }
  watchHandles.clear()
}

async function refreshPathWatchers(): Promise<void> {
  if (!getWatchEnabled()) {
    clearWatchers()
    return
  }

  const paths = await prisma.libraryPath.findMany({
    where: { enabled: true },
    select: {
      id: true,
      path: true,
      library: { select: { id: true, userId: true } },
    },
  })

  const nextIds = new Set(paths.map((p) => p.id))
  for (const [pathId, watcher] of watchHandles.entries()) {
    if (!nextIds.has(pathId)) {
      try {
        watcher.close()
      } catch {
        // ignore watcher close failures
      }
      watchHandles.delete(pathId)
    }
  }

  for (const libraryPath of paths) {
    if (watchHandles.has(libraryPath.id)) continue
    try {
      const watcher = fs.watch(libraryPath.path, { recursive: true }, () => {
        const key = libraryPath.library.id
        const previous = libraryDebounceTimers.get(key)
        if (previous) clearTimeout(previous)
        const timer = setTimeout(() => {
          void enqueueLibraryScan(libraryPath.library.userId, libraryPath.library.id)
          libraryDebounceTimers.delete(key)
        }, 2500)
        libraryDebounceTimers.set(key, timer)
      })
      watchHandles.set(libraryPath.id, watcher)
    } catch {
      // Path may be inaccessible or unsupported by fs.watch; skip.
    }
  }
}

export function startLibraryScanScheduler(): void {
  if (schedulerStarted) return
  schedulerStarted = true

  const scheduleMinutes = getScheduleMinutes()
  if (scheduleMinutes > 0) {
    schedulerInterval = setInterval(() => {
      void queueAllLibrariesForScan()
    }, scheduleMinutes * 60_000)
  }

  if (getWatchEnabled()) {
    watchersStarted = true
    void refreshPathWatchers()
    watcherRefreshInterval = setInterval(() => {
      void refreshPathWatchers()
    }, getWatchRefreshMs())
  }
}

export function stopLibraryScanScheduler(): void {
  if (schedulerInterval) clearInterval(schedulerInterval)
  if (watcherRefreshInterval) clearInterval(watcherRefreshInterval)
  schedulerInterval = null
  watcherRefreshInterval = null
  schedulerStarted = false
  watchersStarted = false
  clearWatchers()
}

export function getLibraryScanSchedulerState(): { schedulerStarted: boolean; watchersStarted: boolean } {
  return { schedulerStarted, watchersStarted }
}
