import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const prismaMock = vi.hoisted(() => ({
  songTag: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  song: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  $transaction: vi.fn(),
}))

const requireAuthMock = vi.hoisted(() => vi.fn())
const sanitizeSongMock = vi.hoisted(() => vi.fn((song: Record<string, unknown>) => song))

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

describe("song tags routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireAuthMock.mockResolvedValue({ userId: 9, role: "user", username: "user9" })
  })

  it("GET /api/song-tags lists user tags", async () => {
    prismaMock.songTag.findMany.mockResolvedValue([
      { id: 1, name: "fav", color: null, _count: { songs: 3 } },
    ])

    const { GET } = await import("../app/api/song-tags/route")
    const res = await GET(new NextRequest("http://localhost/api/song-tags"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toHaveLength(1)
    expect(prismaMock.songTag.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 9 },
      })
    )
  })

  it("PUT /api/song-tags/:id/songs deduplicates ids before assignment", async () => {
    prismaMock.songTag.findFirst.mockResolvedValue({ id: 5, userId: 9, name: "Focus", color: null })
    prismaMock.song.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }])
    const txDeleteMany = vi.fn()
    const txCreateMany = vi.fn()
    prismaMock.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        songTagAssignment: {
          deleteMany: txDeleteMany,
          createMany: txCreateMany,
        },
      })
    )
    prismaMock.songTag.findUnique.mockResolvedValue({
      id: 5,
      name: "Focus",
      _count: { songs: 2 },
    })

    const { PUT } = await import("../app/api/song-tags/[id]/songs/route")
    const req = new NextRequest("http://localhost/api/song-tags/5/songs", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ songIds: [1, "2", 2, 1] }),
    })
    const res = await PUT(req, { params: Promise.resolve({ id: "5" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.assignedSongIds).toEqual([1, 2])
    expect(txDeleteMany).toHaveBeenCalledWith({ where: { tagId: 5 } })
    expect(txCreateMany).toHaveBeenCalledWith({
      data: [
        { tagId: 5, songId: 1 },
        { tagId: 5, songId: 2 },
      ],
    })
  })
})
