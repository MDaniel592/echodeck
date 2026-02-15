import prisma from "./prisma"
import { runLibraryScan } from "./libraryScanner"

const activeByLibrary = new Set<string>()

function keyFor(userId: number, libraryId: number): string {
  return `${userId}:${libraryId}`
}

export async function enqueueLibraryScan(userId: number, libraryId: number): Promise<{
  accepted: boolean
  reason?: string
  scanRunId?: number
}> {
  const key = keyFor(userId, libraryId)
  if (activeByLibrary.has(key)) {
    return { accepted: false, reason: "A scan is already running for this library." }
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

  activeByLibrary.add(key)
  void runLibraryScan(userId, libraryId, { scanRunId: run.id })
    .catch(async (error) => {
      await prisma.libraryScanRun.update({
        where: { id: run.id },
        data: {
          status: "failed",
          finishedAt: new Date(),
          error: error instanceof Error ? error.message : "Scan failed",
        },
      }).catch(() => {})
    })
    .finally(() => {
      activeByLibrary.delete(key)
    })

  return { accepted: true, scanRunId: run.id }
}

export function isLibraryScanActive(userId: number, libraryId: number): boolean {
  return activeByLibrary.has(keyFor(userId, libraryId))
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

  const queued = await prisma.libraryScanRun.findMany({
    where: { status: "queued" },
    select: {
      id: true,
      libraryId: true,
      library: { select: { userId: true } },
    },
    orderBy: { startedAt: "asc" },
    take: 50,
  })

  let started = 0
  for (const run of queued) {
    const userId = run.library.userId
    const key = keyFor(userId, run.libraryId)
    if (activeByLibrary.has(key)) continue
    activeByLibrary.add(key)
    started++
    void runLibraryScan(userId, run.libraryId, { scanRunId: run.id })
      .catch(async (error) => {
        await prisma.libraryScanRun.update({
          where: { id: run.id },
          data: {
            status: "failed",
            finishedAt: new Date(),
            error: error instanceof Error ? error.message : "Scan failed",
          },
        }).catch(() => {})
      })
      .finally(() => {
        activeByLibrary.delete(key)
      })
  }

  return { failedRunning: failed.count, queuedStarted: started }
}
