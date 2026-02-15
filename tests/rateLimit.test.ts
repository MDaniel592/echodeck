import { describe, it, expect } from "vitest"
import { checkRateLimit } from "../lib/rateLimit"

describe("rateLimit", () => {
  it("allows requests within the limit", () => {
    const key = `test-allow-${Date.now()}`
    const result = checkRateLimit(key, 5, 60_000)
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(4)
    expect(result.retryAfterSeconds).toBeNull()
  })

  it("blocks requests exceeding the limit", () => {
    const key = `test-block-${Date.now()}`
    for (let i = 0; i < 3; i++) {
      checkRateLimit(key, 3, 60_000)
    }
    const result = checkRateLimit(key, 3, 60_000)
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
    expect(result.retryAfterSeconds).toBeGreaterThan(0)
  })

  it("uses separate counters for different keys", () => {
    const key1 = `test-sep1-${Date.now()}`
    const key2 = `test-sep2-${Date.now()}`

    for (let i = 0; i < 3; i++) {
      checkRateLimit(key1, 3, 60_000)
    }

    const result1 = checkRateLimit(key1, 3, 60_000)
    const result2 = checkRateLimit(key2, 3, 60_000)

    expect(result1.allowed).toBe(false)
    expect(result2.allowed).toBe(true)
  })
})
