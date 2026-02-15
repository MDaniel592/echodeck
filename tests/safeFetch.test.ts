import { describe, it, expect } from "vitest"

describe("safeFetch", () => {
  it("rejects non-allowlisted hosts", async () => {
    const { safeFetch } = await import("../lib/safeFetch")
    await expect(
      safeFetch("https://evil.example.com/payload")
    ).rejects.toThrow("not allowlisted")
  })

  it("rejects non-https protocols", async () => {
    const { safeFetch } = await import("../lib/safeFetch")
    await expect(
      safeFetch("ftp://open.spotify.com/file")
    ).rejects.toThrow("unsupported protocol")
  })

  it("accepts allowlisted hosts", async () => {
    const { safeFetch } = await import("../lib/safeFetch")
    // This will likely fail due to network, but should not throw "not allowlisted"
    try {
      await safeFetch("https://open.spotify.com/oembed?url=test", undefined, {
        timeoutMs: 3000,
      })
    } catch (error) {
      // Network errors are OK, just verify it wasn't blocked by allowlist
      expect((error as Error).message).not.toContain("not allowlisted")
    }
  })
})
