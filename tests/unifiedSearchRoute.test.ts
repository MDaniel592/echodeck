import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const requireAuthMock = vi.hoisted(() => vi.fn())
const searchAudioSourceMock = vi.hoisted(() => vi.fn())
const searchSpotifyTracksMock = vi.hoisted(() => vi.fn())

vi.mock("../lib/requireAuth", async () => {
  const actual = await vi.importActual("../lib/requireAuth")
  return {
    ...(actual as object),
    requireAuth: requireAuthMock,
  }
})

vi.mock("../lib/ytdlp", async () => {
  const actual = await vi.importActual("../lib/ytdlp")
  return {
    ...(actual as object),
    searchAudioSource: searchAudioSourceMock,
  }
})

vi.mock("../lib/spotdl", async () => {
  const actual = await vi.importActual("../lib/spotdl")
  return {
    ...(actual as object),
    searchSpotifyTracks: searchSpotifyTracksMock,
  }
})

describe("unified source search route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireAuthMock.mockResolvedValue({ userId: 1, role: "user", username: "demo" })
    searchAudioSourceMock.mockResolvedValue([
      {
        provider: "youtube",
        title: "Track A",
        artist: "Artist A",
        url: "https://www.youtube.com/watch?v=abc",
        duration: 120,
        thumbnail: null,
      },
    ])
    searchSpotifyTracksMock.mockResolvedValue([
      {
        provider: "spotify",
        title: "Track B",
        artist: "Artist B",
        url: "https://open.spotify.com/track/xyz",
        duration: 180,
        thumbnail: null,
      },
    ])
  })

  it("returns merged provider results", async () => {
    const { GET } = await import("../app/api/search/unified/route")
    const req = new NextRequest("http://localhost/api/search/unified?q=amnesia&limit=4")
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(searchAudioSourceMock).toHaveBeenCalled()
    expect(searchSpotifyTracksMock).toHaveBeenCalledWith("amnesia", 4)
    expect(Array.isArray(body.results)).toBe(true)
    expect(body.results.length).toBeGreaterThan(0)
    expect(body.errors).toEqual([])
  })

  it("validates query length", async () => {
    const { GET } = await import("../app/api/search/unified/route")
    const req = new NextRequest("http://localhost/api/search/unified?q=x")
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain("at least 2")
    expect(searchAudioSourceMock).not.toHaveBeenCalled()
  })
})
