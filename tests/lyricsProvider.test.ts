import { beforeEach, describe, expect, it, vi } from "vitest"

const safeFetchMock = vi.hoisted(() => vi.fn())

vi.mock("../lib/safeFetch", async () => {
  const actual = await vi.importActual("../lib/safeFetch")
  return {
    ...(actual as object),
    safeFetch: safeFetchMock,
  }
})

describe("lookupLyrics", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns null when title is empty", async () => {
    const { lookupLyrics } = await import("../lib/lyricsProvider")
    const result = await lookupLyrics({ title: "   ", artist: "Artist" })
    expect(result).toBeNull()
    expect(safeFetchMock).not.toHaveBeenCalled()
  })

  it("picks the best match from lrclib payload", async () => {
    safeFetchMock.mockResolvedValue({
      ok: true,
      json: async () => [
        { trackName: "Song", artistName: "Different", plainLyrics: "bad" },
        { trackName: "Song", artistName: "Artist", duration: 180, plainLyrics: "good" },
      ],
    })

    const { lookupLyrics } = await import("../lib/lyricsProvider")
    const result = await lookupLyrics({ title: "Song", artist: "Artist", duration: 181 })

    expect(result).toBe("good")
    expect(safeFetchMock).toHaveBeenCalledTimes(1)
  })

  it("uses syncedLyrics when plainLyrics is missing", async () => {
    safeFetchMock.mockResolvedValue({
      ok: true,
      json: async () => [{ trackName: "Song", artistName: "Artist", syncedLyrics: "synced" }],
    })

    const { lookupLyrics } = await import("../lib/lyricsProvider")
    const result = await lookupLyrics({ title: "Song", artist: "Artist" })

    expect(result).toBe("synced")
  })

  it("falls back to lyrics.ovh when lrclib has no matches", async () => {
    safeFetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ lyrics: "fallback lyrics" }),
      })

    const { lookupLyrics } = await import("../lib/lyricsProvider")
    const result = await lookupLyrics({ title: "Song", artist: "Artist" })

    expect(result).toBe("fallback lyrics")
    expect(safeFetchMock).toHaveBeenCalledTimes(2)
  })

  it("matches lrclib lyrics for non-latin title/artist without forcing fallback", async () => {
    safeFetchMock.mockResolvedValue({
      ok: true,
      json: async () => [{ trackName: "夜に駆ける", artistName: "YOASOBI", plainLyrics: "jp lyrics" }],
    })

    const { lookupLyrics } = await import("../lib/lyricsProvider")
    const result = await lookupLyrics({ title: "夜に駆ける", artist: "YOASOBI" })

    expect(result).toBe("jp lyrics")
    expect(safeFetchMock).toHaveBeenCalledTimes(1)
  })

  it("propagates timeout budget to safeFetch calls", async () => {
    safeFetchMock.mockResolvedValue({
      ok: true,
      json: async () => [{ trackName: "Song", artistName: "Artist", plainLyrics: "lyrics" }],
    })

    const { lookupLyrics } = await import("../lib/lyricsProvider")
    await lookupLyrics({ title: "Song", artist: "Artist", timeoutMs: 10000 })

    // Primary call should get 40% of 10000 = 4000ms
    const primaryOpts = safeFetchMock.mock.calls[0][2]
    expect(primaryOpts.timeoutMs).toBe(4000)
  })

  it("uses default budget when timeoutMs is not provided", async () => {
    safeFetchMock.mockResolvedValue({
      ok: true,
      json: async () => [{ trackName: "Song", artistName: "Artist", plainLyrics: "lyrics" }],
    })

    const { lookupLyrics } = await import("../lib/lyricsProvider")
    await lookupLyrics({ title: "Song", artist: "Artist" })

    // Default budget is 6000, primary gets 40% = 2400ms
    const primaryOpts = safeFetchMock.mock.calls[0][2]
    expect(primaryOpts.timeoutMs).toBe(2400)
  })

  it("sends User-Agent header with safeFetch calls", async () => {
    safeFetchMock.mockResolvedValue({
      ok: true,
      json: async () => [{ trackName: "Song", artistName: "Artist", plainLyrics: "lyrics" }],
    })

    const { lookupLyrics } = await import("../lib/lyricsProvider")
    await lookupLyrics({ title: "Song", artist: "Artist" })

    const init = safeFetchMock.mock.calls[0][1]
    expect(init).toBeDefined()
    expect(init.headers["User-Agent"]).toMatch(/^echodeck\//)
    expect(init.headers["User-Agent"]).toContain("github.com/MDaniel592/echodeck")
  })

  it("passes secondary/fallback timeout as 30% of budget", async () => {
    // Primary returns no match, so round 2 fires
    safeFetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ lyrics: "fallback" }),
      })

    const { lookupLyrics } = await import("../lib/lyricsProvider")
    await lookupLyrics({ title: "Song", artist: "Artist", timeoutMs: 10000 })

    // Round 2 calls should get 30% of 10000 = 3000ms
    const fallbackOpts = safeFetchMock.mock.calls[1][2]
    expect(fallbackOpts.timeoutMs).toBe(3000)
  })
})
