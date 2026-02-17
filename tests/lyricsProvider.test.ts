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
})
