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
    vi.resetModules()
    process.env.MUSIXMATCH_LYRICS_ENABLED = "1"
    process.env.MUSIXMATCH_MOBILE_LYRICS_ENABLED = "1"
    process.env.GENIUS_LYRICS_ENABLED = "1"
    delete process.env.MUSIXMATCH_MOBILE_USERTOKEN
    delete process.env.MUSIXMATCH_TOKENS_JSON
    delete process.env.GENIUS_ACCESS_TOKEN
    delete process.env.GENIUS_CLIENT_ACCESS_TOKEN
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
    safeFetchMock.mockImplementation(async (url: string) => {
      if (url.includes("api.lyrics.ovh")) {
        return {
          ok: true,
          json: async () => ({ lyrics: "fallback lyrics" }),
        }
      }
      return {
        ok: true,
        json: async () => [],
      }
    })

    const { lookupLyrics } = await import("../lib/lyricsProvider")
    const result = await lookupLyrics({ title: "Song", artist: "Artist" })

    expect(result).toBe("fallback lyrics")
    expect(safeFetchMock.mock.calls.some((call) => String(call[0]).includes("api.lyrics.ovh"))).toBe(true)
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

  it("passes secondary/fallback timeout as 30% of budget", async () => {
    // Primary returns no match, so round 2 fires.
    // Musixmatch endpoints are mocked as empty so lyrics.ovh still handles fallback.
    safeFetchMock.mockImplementation(async (url: string) => {
      if (url.includes("api.lyrics.ovh")) {
        return {
          ok: true,
          json: async () => ({ lyrics: "fallback" }),
        }
      }
      if (url.includes("musixmatch.com/search")) {
        return {
          ok: true,
          text: async () => `<script src="/_next/static/chunks/pages/_app-test.js"></script>`,
        }
      }
      if (url.includes("_app-test.js")) {
        const encoded = Buffer.from("test-secret").toString("base64").split("").reverse().join("")
        return {
          ok: true,
          text: async () => `from("${encoded}".split(""));`,
        }
      }
      if (url.includes("/ws/1.1/track.search") || url.includes("/ws/1.1/track.lyrics.get")) {
        return {
          ok: true,
          json: async () => ({ message: { body: { track_list: [] } } }),
        }
      }
      return {
        ok: true,
        json: async () => [],
      }
    })

    const { lookupLyrics } = await import("../lib/lyricsProvider")
    await lookupLyrics({ title: "Song", artist: "Artist", timeoutMs: 10000 })

    // Round 2 calls should get 30% of 10000 = 3000ms
    const hasSecondaryTimeout = safeFetchMock.mock.calls.some((call) => call[2]?.timeoutMs === 3000)
    expect(hasSecondaryTimeout).toBe(true)
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
      if (url.includes("api.lyrics.ovh")) {
        return { ok: false, json: async () => ({}) }
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
      if (url.includes("api.lyrics.ovh")) {
        return { ok: false, json: async () => ({}) }
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

  it("falls back to Musixmatch signed API when lrclib and lyrics.ovh miss", async () => {
    const secret = "mxm-secret"
    const encoded = Buffer.from(secret).toString("base64").split("").reverse().join("")

    safeFetchMock.mockImplementation(async (url: string) => {
      if (url.includes("lrclib.net")) {
        return { ok: true, json: async () => [] }
      }
      if (url.includes("api.lyrics.ovh")) {
        return { ok: false, json: async () => ({}) }
      }
      if (url.endsWith("musixmatch.com/search")) {
        return {
          ok: true,
          text: async () => `<script src="/_next/static/chunks/pages/_app-test.js"></script>`,
        }
      }
      if (url.includes("_app-test.js")) {
        return {
          ok: true,
          text: async () => `foo=from("${encoded}".split(""));`,
        }
      }
      if (url.includes("/ws/1.1/track.search")) {
        return {
          ok: true,
          json: async () => ({
            message: {
              body: {
                track_list: [
                  {
                    track: {
                      track_id: 123,
                      track_name: "Song",
                      artist_name: "Artist",
                      track_length: 181,
                      has_lyrics: 1,
                    },
                  },
                ],
              },
            },
          }),
        }
      }
      if (url.includes("/ws/1.1/track.lyrics.get")) {
        return {
          ok: true,
          json: async () => ({
            message: {
              body: {
                lyrics: {
                  lyrics_body: "Line one\n******* This Lyrics is NOT for Commercial use *******",
                },
              },
            },
          }),
        }
      }
      return { ok: true, json: async () => [] }
    })

    const { lookupLyrics } = await import("../lib/lyricsProvider")
    const result = await lookupLyrics({ title: "Song", artist: "Artist", duration: 181 })

    expect(result).toBe("Line one")
    expect(safeFetchMock.mock.calls.some((call) => String(call[0]).includes("/ws/1.1/track.search"))).toBe(true)
    expect(safeFetchMock.mock.calls.some((call) => String(call[0]).includes("/ws/1.1/track.lyrics.get"))).toBe(true)
  })

  it("falls back to Musixmatch mobile opensearch using token.get when desktop fallback misses", async () => {
    process.env.MUSIXMATCH_LYRICS_ENABLED = "0"
    process.env.MUSIXMATCH_MOBILE_LYRICS_ENABLED = "1"

    safeFetchMock.mockImplementation(async (url: string) => {
      if (url.includes("lrclib.net")) {
        return { ok: true, json: async () => [] }
      }
      if (url.includes("api.lyrics.ovh")) {
        return { ok: false, json: async () => ({}) }
      }
      if (url.includes("/ws/1.1/token.get")) {
        return {
          ok: true,
          json: async () => ({ message: { body: { user_token: "mobile-token" } } }),
        }
      }
      if (url.includes("/ws/1.1/community/opensearch/tracks")) {
        return {
          ok: true,
          json: async () => ({
            message: {
              body: {
                track_list: [
                  {
                    track: {
                      track_id: 999,
                      track_name: "Hard Better Faster Stronger",
                      artist_name: "Daft Punk",
                      track_length: 224,
                      has_lyrics: 1,
                    },
                  },
                ],
              },
            },
          }),
        }
      }
      if (url.includes("/ws/1.1/track.lyrics.get")) {
        return {
          ok: true,
          json: async () => ({
            message: {
              body: {
                lyrics: {
                  lyrics_body: "Work it, make it\n******* This Lyrics is NOT for Commercial use *******",
                },
              },
            },
          }),
        }
      }
      return { ok: true, json: async () => [] }
    })

    const { lookupLyrics } = await import("../lib/lyricsProvider")
    const result = await lookupLyrics({ title: "Hard Better Faster Stronger", artist: "Daft Punk", duration: 224 })

    expect(result).toBe("Work it, make it")
    expect(safeFetchMock.mock.calls.some((call) => String(call[0]).includes("/ws/1.1/token.get"))).toBe(true)
    expect(safeFetchMock.mock.calls.some((call) => String(call[0]).includes("/ws/1.1/community/opensearch/tracks"))).toBe(true)
  })

  it("uses token bundle JSON in MUSIXMATCH_MOBILE_USERTOKEN before token.get", async () => {
    process.env.MUSIXMATCH_LYRICS_ENABLED = "0"
    process.env.MUSIXMATCH_MOBILE_LYRICS_ENABLED = "1"
    process.env.MUSIXMATCH_MOBILE_USERTOKEN = JSON.stringify({
      tokens: {
        "web-desktop-app-v1.0": "bundle-token",
      },
    })

    safeFetchMock.mockImplementation(async (url: string) => {
      if (url.includes("lrclib.net")) {
        return { ok: true, json: async () => [] }
      }
      if (url.includes("api.lyrics.ovh")) {
        return { ok: false, json: async () => ({}) }
      }
      if (url.includes("/ws/1.1/community/opensearch/tracks")) {
        return {
          ok: true,
          json: async () => ({
            message: {
              body: {
                track_list: [
                  {
                    track: {
                      track_id: 777,
                      track_name: "One More Time",
                      artist_name: "Daft Punk",
                      track_length: 320,
                      has_lyrics: 1,
                    },
                  },
                ],
              },
            },
          }),
        }
      }
      if (url.includes("/ws/1.1/track.lyrics.get")) {
        return {
          ok: true,
          json: async () => ({
            message: {
              body: {
                lyrics: {
                  lyrics_body: "One more time",
                },
              },
            },
          }),
        }
      }
      return { ok: true, json: async () => [] }
    })

    const { lookupLyrics } = await import("../lib/lyricsProvider")
    const result = await lookupLyrics({ title: "One More Time", artist: "Daft Punk", duration: 320 })

    expect(result).toBe("One more time")
    expect(safeFetchMock.mock.calls.some((call) => String(call[0]).includes("/ws/1.1/token.get"))).toBe(false)
    const opensearchCall = safeFetchMock.mock.calls.find((call) =>
      String(call[0]).includes("/ws/1.1/community/opensearch/tracks")
    )
    expect(String(opensearchCall?.[0])).toContain("usertoken=bundle-token")
  })

  it("falls back to Genius search + song page parsing when others miss", async () => {
    process.env.MUSIXMATCH_LYRICS_ENABLED = "0"
    process.env.MUSIXMATCH_MOBILE_LYRICS_ENABLED = "0"
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
      if (url.includes("api.lyrics.ovh")) {
        return { ok: false, json: async () => ({}) }
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
