import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const prismaMock = vi.hoisted(() => ({
  song: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
}))

const requireAuthMock = vi.hoisted(() => vi.fn())
const sanitizeSongMock = vi.hoisted(() => vi.fn((s: Record<string, unknown>) => s))

vi.mock("../lib/prisma", () => ({
  default: prismaMock,
}))

vi.mock("../lib/requireAuth", async () => {
  const actual = await vi.importActual("../lib/requireAuth")
  return {
    ...(actual as object),
    requireAuth: requireAuthMock,
  }
})

vi.mock("../lib/sanitize", () => ({
  sanitizeSong: sanitizeSongMock,
}))

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/songs")
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  return new NextRequest(url, { method: "GET" })
}

function makeSong(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    title: "Song",
    artist: "Artist",
    album: "Album",
    source: "youtube",
    format: "mp3",
    quality: "320kbps",
    filePath: "/downloads/song.mp3",
    year: 2024,
    genre: "Rock",
    createdAt: new Date(),
    ...overrides,
  }
}

describe("GET /api/songs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireAuthMock.mockResolvedValue({ userId: 7, role: "user", username: "u" })
    prismaMock.song.findMany.mockResolvedValue([])
    prismaMock.song.count.mockResolvedValue(0)
  })

  it("search builds OR conditions for title, artist, album, source, format, quality", async () => {
    const { GET } = await import("../app/api/songs/route")
    await GET(makeRequest({ search: "test" }))

    const where = prismaMock.song.findMany.mock.calls[0][0].where
    expect(where.OR).toEqual([
      { title: { contains: "test" } },
      { artist: { contains: "test" } },
      { album: { contains: "test" } },
      { source: { contains: "test" } },
      { format: { contains: "test" } },
      { quality: { contains: "test" } },
    ])
  })

  it("libraryId param filters by library", async () => {
    const { GET } = await import("../app/api/songs/route")
    await GET(makeRequest({ libraryId: "42" }))

    const where = prismaMock.song.findMany.mock.calls[0][0].where
    expect(where.libraryId).toBe(42)
  })

  it("playlistId=none filters for null playlistId", async () => {
    const { GET } = await import("../app/api/songs/route")
    await GET(makeRequest({ playlistId: "none" }))

    const where = prismaMock.song.findMany.mock.calls[0][0].where
    expect(where.playlistId).toBeNull()
  })

  it("albumId=none filters for null albumId", async () => {
    const { GET } = await import("../app/api/songs/route")
    await GET(makeRequest({ albumId: "none" }))

    const where = prismaMock.song.findMany.mock.calls[0][0].where
    expect(where.albumId).toBeNull()
  })

  it("pagination calculates skip correctly", async () => {
    const { GET } = await import("../app/api/songs/route")
    await GET(makeRequest({ page: "3", limit: "25" }))

    const call = prismaMock.song.findMany.mock.calls[0][0]
    expect(call.skip).toBe(50) // (3-1) * 25
    expect(call.take).toBe(25)
  })

  it("invalid sort field falls back to createdAt", async () => {
    const { GET } = await import("../app/api/songs/route")
    await GET(makeRequest({ sortBy: "invalidField" }))

    const call = prismaMock.song.findMany.mock.calls[0][0]
    expect(call.orderBy).toEqual({ createdAt: "desc" })
  })

  it("valid sort field is used", async () => {
    const { GET } = await import("../app/api/songs/route")
    await GET(makeRequest({ sortBy: "title", sortOrder: "asc" }))

    const call = prismaMock.song.findMany.mock.calls[0][0]
    expect(call.orderBy).toEqual({ title: "asc" })
  })

  it("deduplicates by filePath (higher priority song wins)", async () => {
    const librarySong = makeSong({ id: 1, source: "library", artist: null, filePath: "/downloads/a.mp3" })
    const ytSong = makeSong({ id: 2, source: "youtube", artist: "Artist", filePath: "/downloads/a.mp3" })

    prismaMock.song.findMany.mockResolvedValue([librarySong, ytSong])
    prismaMock.song.count.mockResolvedValue(2)

    const { GET } = await import("../app/api/songs/route")
    const res = await GET(makeRequest())
    const body = await res.json()

    // ytSong has higher priority (non-library source + artist present)
    expect(body.songs).toHaveLength(1)
    expect(body.dedupedInPage).toBe(1)
    expect(sanitizeSongMock).toHaveBeenCalledWith(ytSong, 0, [ytSong])
  })

  it("songPriority: non-library source scores higher", async () => {
    const libSong = makeSong({ id: 1, source: "library", artist: "A", album: "B", title: "Song", filePath: "/a" })
    const dlSong = makeSong({ id: 2, source: "youtube", artist: "A", album: "B", title: "Song", filePath: "/a" })

    prismaMock.song.findMany.mockResolvedValue([libSong, dlSong])
    prismaMock.song.count.mockResolvedValue(2)

    const { GET } = await import("../app/api/songs/route")
    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body.songs).toHaveLength(1)
    // dlSong wins because non-library source gets +4
    expect(sanitizeSongMock).toHaveBeenCalledWith(dlSong, 0, [dlSong])
  })

  it("songPriority: numeric-only title scores lower", async () => {
    const numericTitle = makeSong({ id: 1, source: "youtube", artist: "A", album: "B", title: "12345", filePath: "/a" })
    const normalTitle = makeSong({ id: 2, source: "youtube", artist: "A", album: "B", title: "Real Song", filePath: "/a" })

    prismaMock.song.findMany.mockResolvedValue([numericTitle, normalTitle])
    prismaMock.song.count.mockResolvedValue(2)

    const { GET } = await import("../app/api/songs/route")
    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body.songs).toHaveLength(1)
    expect(sanitizeSongMock).toHaveBeenCalledWith(normalTitle, 0, [normalTitle])
  })

  it("returns correct pagination metadata", async () => {
    prismaMock.song.findMany.mockResolvedValue([])
    prismaMock.song.count.mockResolvedValue(250)

    const { GET } = await import("../app/api/songs/route")
    const res = await GET(makeRequest({ page: "2", limit: "50" }))
    const body = await res.json()

    expect(body.total).toBe(250)
    expect(body.page).toBe(2)
    expect(body.limit).toBe(50)
    expect(body.totalPages).toBe(5)
  })

  it("auth error returns correct status", async () => {
    const { AuthError } = await import("../lib/requireAuth")
    requireAuthMock.mockRejectedValue(new AuthError("Forbidden", 403))

    const { GET } = await import("../app/api/songs/route")
    const res = await GET(makeRequest())
    expect(res.status).toBe(403)
  })
})
