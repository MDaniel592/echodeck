import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { checkRateLimit, getRateLimitMetrics, resetRateLimitMetrics } from "../lib/rateLimit"

describe("rateLimit metrics", () => {
  beforeEach(() => {
    resetRateLimitMetrics()
    vi.stubEnv("NODE_ENV", "test")
    vi.stubEnv("RATE_LIMIT_BACKEND", "memory")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("tracks totals and blocked requests by key prefix", async () => {
    const key = `login:client:metrics-${Date.now()}`
    await checkRateLimit(key, 2, 60_000)
    await checkRateLimit(key, 2, 60_000)
    await checkRateLimit(key, 2, 60_000)

    const snapshot = getRateLimitMetrics()
    const row = snapshot.byPrefix.find((item) => item.prefix === "login:client")

    expect(snapshot.backend).toBe("memory")
    expect(snapshot.totals.total).toBe(3)
    expect(snapshot.totals.allowed).toBe(2)
    expect(snapshot.totals.blocked).toBe(1)
    expect(row?.total).toBe(3)
    expect(row?.blocked).toBe(1)
  })

  it("resets metrics snapshot", () => {
    const before = getRateLimitMetrics()
    expect(before.startedAt).toBeTruthy()

    resetRateLimitMetrics()
    const after = getRateLimitMetrics()
    expect(after.totals.total).toBe(0)
    expect(after.byPrefix).toEqual([])
    expect(after.fallbackToMemoryCount).toBe(0)
  })
})
