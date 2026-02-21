import { beforeEach, describe, expect, it, vi, afterEach } from "vitest"

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
    vi.resetModules()
    process.env.GENIUS_LYRICS_ENABLED = "1"
    delete process.env.GENIUS_ACCESS_TOKEN
    delete process.env.GENIUS_CLIENT_ACCESS_TOKEN
  })

  afterEach(() => {
    vi.useRealTimers()
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

  it("falls back to Genius when lrclib has no matches", async () => {
    process.env.GENIUS_ACCESS_TOKEN = "genius-token"

    const preloadedState = JSON.stringify({
      songPage: { lyricsData: { body: { html: "<p>Genius fallback</p>" } } },
    })

    safeFetchMock.mockImplementation(async (url: string) => {
      if (url.includes("lrclib.net")) {
        return { ok: true, json: async () => [] }
      }
      if (url.includes("api.genius.com/search")) {
        return {
          ok: true,
          json: async () => ({
            response: {
              hits: [{
                type: "song",
                result: {
                  id: 1,
                  title: "Song",
                  primary_artist: { name: "Artist" },
                  url: "https://genius.com/artist-song-lyrics",
                },
              }],
            },
          }),
        }
      }
      if (url.includes("genius.com/artist-song-lyrics")) {
        return {
          ok: true,
          text: async () =>
            `<html><script>window.__PRELOADED_STATE__ = JSON.parse('${preloadedState}');</script></html>`,
        }
      }
      return { ok: true, json: async () => [] }
    })

    const { lookupLyrics } = await import("../lib/lyricsProvider")
    const result = await lookupLyrics({ title: "Song", artist: "Artist" })

    expect(result).toBe("Genius fallback")
    expect(safeFetchMock.mock.calls.some((call) => String(call[0]).includes("api.genius.com"))).toBe(true)
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
    expect(init.headers["User-Agent"]).not.toContain("github.com")
  })

  it("gives LrcLib the full remaining budget in round2 (not capped at 30%)", async () => {
    // Primary LrcLib returns nothing; round2 fires. The LrcLib round2 call should
    // get budget - primaryTimeout (60% for budget=10000) not just 30%.
    safeFetchMock.mockImplementation(async (url: string) => {
      if (url.includes("lrclib.net")) {
        return { ok: true, json: async () => [] }
      }
      return { ok: true, json: async () => [] }
    })

    const { lookupLyrics } = await import("../lib/lyricsProvider")
    await lookupLyrics({ title: "Song", artist: "Artist", timeoutMs: 10000 })

    // The second lrclib call (round2) should get 10000 - 4000 = 6000ms, not 3000ms.
    const lrclibCalls = safeFetchMock.mock.calls.filter((call) =>
      String(call[0] || "").includes("lrclib.net")
    )
    // Primary gets 4000ms (40%), round2+ LrcLib variants get 6000ms (remaining).
    expect(lrclibCalls[0]?.[2]?.timeoutMs).toBe(4000)
    const hasLrcRound2Timeout = lrclibCalls.slice(1).some((call) => call[2]?.timeoutMs === 6000)
    expect(hasLrcRound2Timeout).toBe(true)
  })

  it("tries segmented title fallback with artist when the full title fails", async () => {
    safeFetchMock.mockImplementation(async (url: string) => {
      if (url.includes("track_name=Song+Part+1+-+Retrowave&artist_name=Artist")) {
        return { ok: true, json: async () => [] }
      }
      if (url.includes("track_name=Song+Part+1&artist_name=Artist")) {
        return {
          ok: true,
          json: async () => [{ trackName: "Song Part 1", artistName: "Artist", plainLyrics: "segmented lyrics" }],
        }
      }
      if (url.includes("track_name=Song+Part+1&artist_name=Retrowave")) {
        return { ok: true, json: async () => [] }
      }
      return { ok: true, json: async () => [] }
    })

    const { lookupLyrics } = await import("../lib/lyricsProvider")
    const result = await lookupLyrics({ title: "Song Part 1 - Retrowave", artist: "Artist" })

    expect(result).toBe("segmented lyrics")
  })

  it("does not reject a title-only match solely due to duration delta", async () => {
    safeFetchMock.mockImplementation(async (url: string) => {
      if (url.includes("track_name=Song+%28Remix%29&artist_name=Artist")) {
        return { ok: true, json: async () => [] }
      }
      if (url.includes("track_name=Song&artist_name=Artist")) {
        return { ok: true, json: async () => [] }
      }
      if (url.includes("track_name=Song") && !url.includes("artist_name=")) {
        return {
          ok: true,
          json: async () => [{ trackName: "Song", artistName: "Someone Else", duration: 165, plainLyrics: "final match" }],
        }
      }
      return { ok: true, json: async () => [] }
    })

    const { lookupLyrics } = await import("../lib/lyricsProvider")
    const result = await lookupLyrics({ title: "Song (Remix)", artist: "Artist", duration: 120 })

    expect(result).toBe("final match")
  })

  it("trims dangling separators from extracted artist-dash titles", async () => {
    safeFetchMock.mockImplementation(async (url: string) => {
      if (url.includes("track_name=Lost+Frequencies+-+Are+You+With+Me+-&artist_name=Lost+Frequencies")) {
        return { ok: true, json: async () => [] }
      }
      if (url.includes("track_name=Are+You+With+Me&artist_name=Lost+Frequencies")) {
        return {
          ok: true,
          json: async () => [{ trackName: "Are You With Me", artistName: "Lost Frequencies", plainLyrics: "lyrics ok" }],
        }
      }
      return { ok: true, json: async () => [] }
    })

    const { lookupLyrics } = await import("../lib/lyricsProvider")
    const result = await lookupLyrics({ title: "Lost Frequencies - Are You With Me -", artist: "Lost Frequencies" })

    expect(result).toBe("lyrics ok")
  })

  it("tries right side of artist-dash title even when artist metadata is missing", async () => {
    safeFetchMock.mockImplementation(async (url: string) => {
      if (url.includes("track_name=Lost+Frequencies+-+Are+You+With+Me")) {
        return { ok: true, json: async () => [] }
      }
      if (url.includes("track_name=Are+You+With+Me")) {
        return {
          ok: true,
          json: async () => [{ trackName: "Are You With Me", artistName: "Lost Frequencies", plainLyrics: "lyrics from right side" }],
        }
      }
      return { ok: true, json: async () => [] }
    })

    const { lookupLyrics } = await import("../lib/lyricsProvider")
    const result = await lookupLyrics({ title: "Lost Frequencies - Are You With Me", artist: "" })

    expect(result).toBe("lyrics from right side")
  })

  it("infers artist/title from dash when metadata artist looks like a channel", async () => {
    safeFetchMock.mockImplementation(async (url: string) => {
      if (url.includes("track_name=Lost+Frequencies+-+Are+You+With+Me&artist_name=Armada+Music+TV")) {
        return { ok: true, json: async () => [] }
      }
      if (url.includes("track_name=Are+You+With+Me&artist_name=Armada+Music+TV")) {
        return { ok: true, json: async () => [] }
      }
      if (url.includes("track_name=Are+You+With+Me&artist_name=Lost+Frequencies")) {
        return {
          ok: true,
          json: async () => [{ trackName: "Are You With Me", artistName: "Lost Frequencies", plainLyrics: "channel mismatch recovered" }],
        }
      }
      return { ok: true, json: async () => [] }
    })

    const { lookupLyrics } = await import("../lib/lyricsProvider")
    const result = await lookupLyrics({
      title: "Lost Frequencies - Are You With Me",
      artist: "Armada Music TV",
    })

    expect(result).toBe("channel mismatch recovered")
  })

  it("strips trailing channel suffixes from artist metadata", async () => {
    safeFetchMock.mockImplementation(async (url: string) => {
      if (url.includes("track_name=After+Dark&artist_name=Mr.Kitty+Official")) {
        return { ok: true, json: async () => [] }
      }
      if (url.includes("track_name=After+Dark&artist_name=Mr.Kitty")) {
        return {
          ok: true,
          json: async () => [{ trackName: "After Dark", artistName: "Mr.Kitty", plainLyrics: "official suffix cleaned" }],
        }
      }
      return { ok: true, json: async () => [] }
    })

    const { lookupLyrics } = await import("../lib/lyricsProvider")
    const result = await lookupLyrics({
      title: "After Dark",
      artist: "Mr.Kitty Official",
      duration: 257,
    })

    expect(result).toBe("official suffix cleaned")
    const usedSanitizedArtist = safeFetchMock.mock.calls.some((call) => {
      const url = String(call[0] || "")
      return url.includes("track_name=After+Dark") &&
        url.includes("artist_name=Mr.Kitty") &&
        !url.includes("artist_name=Mr.Kitty+Official")
    })
    expect(usedSanitizedArtist).toBe(true)
  })

  it("tries individual collaborator artists when artist metadata is a combined string", async () => {
    safeFetchMock.mockImplementation(async (url: string) => {
      if (url.includes("track_name=THIS+FEELING&artist_name=DJ+Anemia+%26+Crier+%2B+sixnite")) {
        return { ok: true, json: async () => [] }
      }
      if (url.includes("track_name=THIS+FEELING&artist_name=DJ+Anemia")) {
        return {
          ok: true,
          json: async () => [{ trackName: "THIS FEELING", artistName: "DJ Anemia", plainLyrics: "collab resolved" }],
        }
      }
      return { ok: true, json: async () => [] }
    })

    const { lookupLyrics } = await import("../lib/lyricsProvider")
    const result = await lookupLyrics({
      title: "THIS FEELING",
      artist: "DJ Anemia & Crier + sixnite",
    })

    expect(result).toBe("collab resolved")
  })

  it("falls back to Genius search + song page parsing when lrclib misses", async () => {
    process.env.GENIUS_ACCESS_TOKEN = "genius-token"

    const preloadedState = JSON.stringify({
      songPage: {
        lyricsData: {
          body: {
            html: "<p>[Verse 1]<br>We are here<br>To sing</p><p>[Chorus]<br>Forever now</p>",
          },
        },
      },
    })

    safeFetchMock.mockImplementation(async (url: string) => {
      if (url.includes("lrclib.net")) {
        return { ok: true, json: async () => [] }
      }
      if (url.includes("api.genius.com/search")) {
        return {
          ok: true,
          json: async () => ({
            response: {
              hits: [
                {
                  type: "song",
                  result: {
                    id: 42,
                    title: "Song",
                    full_title: "Song by Artist",
                    primary_artist: { name: "Artist" },
                    url: "https://genius.com/artist-song-lyrics",
                  },
                },
              ],
            },
          }),
        }
      }
      if (url.includes("genius.com/artist-song-lyrics")) {
        return {
          ok: true,
          text: async () =>
            `<html><script>window.__PRELOADED_STATE__ = JSON.parse('${preloadedState}');</script></html>`,
        }
      }
      return { ok: true, json: async () => [] }
    })

    const { lookupLyrics } = await import("../lib/lyricsProvider")
    const result = await lookupLyrics({ title: "Song", artist: "Artist" })

    expect(result).toBe("[Verse 1]\nWe are here\nTo sing\n[Chorus]\nForever now")
    expect(safeFetchMock.mock.calls.some((call) => String(call[0]).includes("api.genius.com/search"))).toBe(true)
    expect(safeFetchMock.mock.calls.some((call) => String(call[0]).includes("genius.com/artist-song-lyrics"))).toBe(true)
  })
})

describe("lookupLrcLibSynced", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    process.env.GENIUS_LYRICS_ENABLED = "0"
  })

  it("returns synced LRC lyrics when LrcLib has them", async () => {
    const lrcContent = "[00:01.00]First line\n[00:05.50]Second line"
    safeFetchMock.mockResolvedValue({
      ok: true,
      json: async () => [
        { trackName: "After Dark", artistName: "Mr.Kitty", syncedLyrics: lrcContent, duration: 257 },
      ],
    })

    const { lookupLrcLibSynced } = await import("../lib/lyricsProvider")
    const result = await lookupLrcLibSynced({ title: "After Dark", artist: "Mr.Kitty Official", duration: 257 })

    expect(result).toBe(lrcContent)
  })

  it("returns null when LrcLib only has plain lyrics", async () => {
    safeFetchMock.mockResolvedValue({
      ok: true,
      json: async () => [
        { trackName: "After Dark", artistName: "Mr.Kitty", plainLyrics: "plain only", duration: 257 },
      ],
    })

    const { lookupLrcLibSynced } = await import("../lib/lyricsProvider")
    const result = await lookupLrcLibSynced({ title: "After Dark", artist: "Mr.Kitty", duration: 257 })

    expect(result).toBeNull()
  })

  it("returns null when LrcLib has no results", async () => {
    safeFetchMock.mockResolvedValue({ ok: true, json: async () => [] })

    const { lookupLrcLibSynced } = await import("../lib/lyricsProvider")
    const result = await lookupLrcLibSynced({ title: "Unknown Song", artist: "Unknown Artist" })

    expect(result).toBeNull()
  })

  it("tries cleaned artist variant when raw artist includes channel suffix", async () => {
    const lrcContent = "[00:01.00]Synced line"
    safeFetchMock.mockImplementation(async (url: string) => {
      if (url.includes("artist_name=Mr.Kitty+Official")) {
        return { ok: true, json: async () => [] }
      }
      if (url.includes("artist_name=Mr.Kitty")) {
        return {
          ok: true,
          json: async () => [
            { trackName: "After Dark", artistName: "Mr.Kitty", syncedLyrics: lrcContent, duration: 257 },
          ],
        }
      }
      return { ok: true, json: async () => [] }
    })

    const { lookupLrcLibSynced } = await import("../lib/lyricsProvider")
    const result = await lookupLrcLibSynced({ title: "After Dark", artist: "Mr.Kitty Official", duration: 257 })

    expect(result).toBe(lrcContent)
  })

  it("uses the provided timeoutMs for LrcLib requests", async () => {
    const lrcContent = "[00:01.00]Line"
    safeFetchMock.mockResolvedValue({
      ok: true,
      json: async () => [{ trackName: "Song", artistName: "Artist", syncedLyrics: lrcContent }],
    })

    const { lookupLrcLibSynced } = await import("../lib/lyricsProvider")
    await lookupLrcLibSynced({ title: "Song", artist: "Artist", timeoutMs: 8000 })

    const lrclibCall = safeFetchMock.mock.calls.find((call) =>
      String(call[0] || "").includes("lrclib.net")
    )
    expect(lrclibCall?.[2]?.timeoutMs).toBe(8000)
  })
})
