import prisma from "./prisma"

/**
 * Sliding-window rate limiter keyed by arbitrary string (e.g. IP).
 * Default backend is database-backed so limits are shared across instances.
 * Falls back to in-memory if DB is unavailable.
 */

interface WindowEntry {
  timestamps: number[]
}

type RateLimitBackend = "memory" | "database"

type PrefixMetrics = {
  total: number
  allowed: number
  blocked: number
  fallbackToMemory: number
  lastSeenAt: string
}

export interface RateLimitMetricsSnapshot {
  startedAt: string
  backend: RateLimitBackend
  bucketMs: number
  fallbackToMemoryCount: number
  keysTracked: number
  totals: {
    total: number
    allowed: number
    blocked: number
  }
  byPrefix: Array<{
    prefix: string
    total: number
    allowed: number
    blocked: number
    fallbackToMemory: number
    lastSeenAt: string
  }>
}

const store = new Map<string, WindowEntry>()
let warnedDbFallback = false
let fallbackToMemoryCount = 0
const metricsStartedAt = new Date().toISOString()
const metricsByPrefix = new Map<string, PrefixMetrics>()
let metricsTotals = { total: 0, allowed: 0, blocked: 0 }

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
  windowMs: number,
  consume: boolean
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

  if (consume) {
    entry.timestamps.push(now)
  }

  const attempts = entry.timestamps.length
  return {
    allowed: true,
    remaining: Math.max(0, maxAttempts - attempts),
    retryAfterSeconds: null,
  }
}

function shouldUseMemoryBackend(): boolean {
  const configured = (process.env.RATE_LIMIT_BACKEND || "").trim().toLowerCase()
  if (configured === "memory") return true
  if (configured === "database" || configured === "db") return false
  return process.env.NODE_ENV === "test"
}

function getBackendLabel(): RateLimitBackend {
  return shouldUseMemoryBackend() ? "memory" : "database"
}

function getRateLimitBucketMs(): number {
  const parsed = Number.parseInt(process.env.RATE_LIMIT_BUCKET_MS || "", 10)
  if (!Number.isInteger(parsed)) return 1000
  return Math.min(Math.max(parsed, 250), 10_000)
}

function keyPrefixForMetrics(key: string): string {
  const trimmed = (key || "").trim()
  if (!trimmed) return "(empty)"
  const parts = trimmed.split(":").filter(Boolean)
  if (parts.length === 0) return "(empty)"
  return parts.slice(0, 2).join(":")
}

function recordMetrics(key: string, result: RateLimitResult, usedFallback: boolean) {
  const prefix = keyPrefixForMetrics(key)
  const existing = metricsByPrefix.get(prefix) || {
    total: 0,
    allowed: 0,
    blocked: 0,
    fallbackToMemory: 0,
    lastSeenAt: new Date().toISOString(),
  }

  existing.total += 1
  if (result.allowed) existing.allowed += 1
  else existing.blocked += 1
  if (usedFallback) existing.fallbackToMemory += 1
  existing.lastSeenAt = new Date().toISOString()
  metricsByPrefix.set(prefix, existing)

  metricsTotals.total += 1
  if (result.allowed) metricsTotals.allowed += 1
  else metricsTotals.blocked += 1
}

export function getRateLimitMetrics(limit = 50): RateLimitMetricsSnapshot {
  const safeLimit = Math.min(Math.max(limit, 1), 500)
  const byPrefix = Array.from(metricsByPrefix.entries())
    .map(([prefix, value]) => ({ prefix, ...value }))
    .sort((a, b) => b.total - a.total || b.blocked - a.blocked || a.prefix.localeCompare(b.prefix))
    .slice(0, safeLimit)

  return {
    startedAt: metricsStartedAt,
    backend: getBackendLabel(),
    bucketMs: getRateLimitBucketMs(),
    fallbackToMemoryCount,
    keysTracked: metricsByPrefix.size,
    totals: { ...metricsTotals },
    byPrefix,
  }
}

export function resetRateLimitMetrics(): void {
  metricsByPrefix.clear()
  metricsTotals = { total: 0, allowed: 0, blocked: 0 }
  fallbackToMemoryCount = 0
}

async function databaseCheckRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number,
  consume: boolean
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

    if (consume) {
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
    }

    return {
      allowed: true,
      remaining: Math.max(0, maxAttempts - (attempts + (consume ? 1 : 0))),
      retryAfterSeconds: null,
    }
  })
}

async function evaluateRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number,
  consume: boolean
): Promise<RateLimitResult> {
  if (shouldUseMemoryBackend()) {
    const result = memoryCheckRateLimit(key, maxAttempts, windowMs, consume)
    recordMetrics(key, result, false)
    return result
  }

  try {
    const result = await databaseCheckRateLimit(key, maxAttempts, windowMs, consume)
    recordMetrics(key, result, false)
    return result
  } catch (error) {
    if (!warnedDbFallback) {
      warnedDbFallback = true
      const reason = error instanceof Error ? error.message : String(error)
      console.warn(`[rate-limit] Falling back to in-memory backend: ${reason}`)
    }
    fallbackToMemoryCount += 1
    const result = memoryCheckRateLimit(key, maxAttempts, windowMs, consume)
    recordMetrics(key, result, true)
    return result
  }
}

export async function checkRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number
): Promise<RateLimitResult> {
  return evaluateRateLimit(key, maxAttempts, windowMs, true)
}

export async function peekRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number
): Promise<RateLimitResult> {
  return evaluateRateLimit(key, maxAttempts, windowMs, false)
}
