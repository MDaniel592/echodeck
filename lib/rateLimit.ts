import prisma from "./prisma"

/**
 * Sliding-window rate limiter keyed by arbitrary string (e.g. IP).
 * Default backend is database-backed so limits are shared across instances.
 * Falls back to in-memory if DB is unavailable.
 */

interface WindowEntry {
  timestamps: number[]
}

const store = new Map<string, WindowEntry>()
let warnedDbFallback = false

const CLEANUP_INTERVAL_MS = 60_000
let lastCleanup = Date.now()

function cleanup(windowMs: number) {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return
  lastCleanup = now

  const cutoff = now - windowMs
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff)
    if (entry.timestamps.length === 0) store.delete(key)
  }
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number | null
}

function memoryCheckRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number
): RateLimitResult {
  cleanup(windowMs)

  const now = Date.now()
  const cutoff = now - windowMs

  let entry = store.get(key)
  if (!entry) {
    entry = { timestamps: [] }
    store.set(key, entry)
  }

  entry.timestamps = entry.timestamps.filter((t) => t > cutoff)

  if (entry.timestamps.length >= maxAttempts) {
    const oldest = entry.timestamps[0]
    const retryAfterSeconds = Math.ceil((oldest + windowMs - now) / 1000)
    return { allowed: false, remaining: 0, retryAfterSeconds }
  }

  entry.timestamps.push(now)
  return {
    allowed: true,
    remaining: maxAttempts - entry.timestamps.length,
    retryAfterSeconds: null,
  }
}

function shouldUseMemoryBackend(): boolean {
  const configured = (process.env.RATE_LIMIT_BACKEND || "").trim().toLowerCase()
  if (configured === "memory") return true
  if (configured === "database" || configured === "db") return false
  return process.env.NODE_ENV === "test"
}

async function databaseCheckRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number
): Promise<RateLimitResult> {
  const now = Date.now()
  const nowDate = new Date(now)
  const cutoffDate = new Date(now - windowMs)

  const shouldCleanup = now - lastCleanup >= CLEANUP_INTERVAL_MS
  if (shouldCleanup) {
    lastCleanup = now
    await prisma.rateLimitEvent.deleteMany({
      where: { createdAt: { lt: cutoffDate } },
    })
  }

  return prisma.$transaction(async (tx) => {
    const attempts = await tx.rateLimitEvent.findMany({
      where: {
        key,
        createdAt: { gt: cutoffDate },
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, createdAt: true },
    })

    if (attempts.length >= maxAttempts) {
      const oldest = attempts[0]?.createdAt
      const retryAfterSeconds = oldest
        ? Math.max(1, Math.ceil((oldest.getTime() + windowMs - nowDate.getTime()) / 1000))
        : 1
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds,
      }
    }

    await tx.rateLimitEvent.create({
      data: {
        key,
        createdAt: nowDate,
      },
    })

    return {
      allowed: true,
      remaining: Math.max(0, maxAttempts - (attempts.length + 1)),
      retryAfterSeconds: null,
    }
  })
}

export async function checkRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number
): Promise<RateLimitResult> {
  if (shouldUseMemoryBackend()) {
    return memoryCheckRateLimit(key, maxAttempts, windowMs)
  }

  try {
    return await databaseCheckRateLimit(key, maxAttempts, windowMs)
  } catch (error) {
    if (!warnedDbFallback) {
      warnedDbFallback = true
      const reason = error instanceof Error ? error.message : String(error)
      console.warn(`[rate-limit] Falling back to in-memory backend: ${reason}`)
    }
    return memoryCheckRateLimit(key, maxAttempts, windowMs)
  }
}
