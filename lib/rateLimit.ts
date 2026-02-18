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
let lastMemoryCleanup = Date.now()
let lastDatabaseCleanup = Date.now()

function cleanup(windowMs: number) {
  const now = Date.now()
  if (now - lastMemoryCleanup < CLEANUP_INTERVAL_MS) return
  lastMemoryCleanup = now

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

function getRateLimitBucketMs(): number {
  const parsed = Number.parseInt(process.env.RATE_LIMIT_BUCKET_MS || "", 10)
  if (!Number.isInteger(parsed)) return 1000
  return Math.min(Math.max(parsed, 250), 10_000)
}

async function databaseCheckRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number
): Promise<RateLimitResult> {
  const now = Date.now()
  const bucketMs = getRateLimitBucketMs()
  const nowDate = new Date(now)
  const cutoffMs = now - windowMs
  const queryStartMs = cutoffMs - bucketMs

  const shouldCleanup = now - lastDatabaseCleanup >= CLEANUP_INTERVAL_MS
  if (shouldCleanup) {
    lastDatabaseCleanup = now
    await prisma.rateLimitBucket.deleteMany({
      where: { bucketStart: { lt: new Date(queryStartMs) } },
    })
  }

  return prisma.$transaction(async (tx) => {
    const buckets = await tx.rateLimitBucket.findMany({
      where: {
        key,
        bucketStart: { gte: new Date(queryStartMs) },
      },
      orderBy: { bucketStart: "asc" },
      select: { bucketStart: true, count: true },
    })

    const attempts = buckets.reduce((sum, bucket) => sum + bucket.count, 0)

    if (attempts >= maxAttempts) {
      const oldestBucketStart = buckets[0]?.bucketStart
      const retryAfterSeconds = oldestBucketStart
        ? Math.max(1, Math.ceil((oldestBucketStart.getTime() + windowMs + bucketMs - nowDate.getTime()) / 1000))
        : 1
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds,
      }
    }

    const bucketStartMs = Math.floor(now / bucketMs) * bucketMs
    await tx.rateLimitBucket.upsert({
      where: {
        key_bucketStart: {
          key,
          bucketStart: new Date(bucketStartMs),
        },
      },
      create: {
        key,
        bucketStart: new Date(bucketStartMs),
        count: 1,
      },
      update: {
        count: { increment: 1 },
      },
    })

    return {
      allowed: true,
      remaining: Math.max(0, maxAttempts - (attempts + 1)),
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
