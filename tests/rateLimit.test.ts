import { describe, it, expect } from "vitest"
import { checkRateLimit, peekRateLimit } from "../lib/rateLimit"

describe("rateLimit", () => {
  it("allows requests within the limit", async () => {
    const key = `test-allow-${Date.now()}`
    const result = await checkRateLimit(key, 5, 60_000)
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(4)
    expect(result.retryAfterSeconds).toBeNull()
  })

  it("blocks requests exceeding the limit", async () => {
    const key = `test-block-${Date.now()}`
    for (let i = 0; i < 3; i++) {
      await checkRateLimit(key, 3, 60_000)
    }
    const result = await checkRateLimit(key, 3, 60_000)
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
    expect(result.retryAfterSeconds).toBeGreaterThan(0)
  })

  it("uses separate counters for different keys", async () => {
    const key1 = `test-sep1-${Date.now()}`
    const key2 = `test-sep2-${Date.now()}`

    for (let i = 0; i < 3; i++) {
      await checkRateLimit(key1, 3, 60_000)
    }

    const result1 = await checkRateLimit(key1, 3, 60_000)
    const result2 = await checkRateLimit(key2, 3, 60_000)

    expect(result1.allowed).toBe(false)
    expect(result2.allowed).toBe(true)
  })

  it("can peek without consuming an attempt", async () => {
    const key = `test-peek-${Date.now()}`
    const peek = await peekRateLimit(key, 2, 60_000)
    expect(peek.allowed).toBe(true)
    expect(peek.remaining).toBe(2)

    const first = await checkRateLimit(key, 2, 60_000)
    expect(first.allowed).toBe(true)
    expect(first.remaining).toBe(1)
  })
})
