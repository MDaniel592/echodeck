/**
 * In-memory sliding-window rate limiter keyed by arbitrary string (e.g. IP).
 * Not shared across processes, so it resets on restart — acceptable for a
 * single-instance self-hosted app.
 */

interface WindowEntry {
  timestamps: number[]
}

const store = new Map<string, WindowEntry>()

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

export function checkRateLimit(
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
