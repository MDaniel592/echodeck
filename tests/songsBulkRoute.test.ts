import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const prismaMock = vi.hoisted(() => ({
  song: {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  playlist: {
    findFirst: vi.fn(),
  },
  playlistSong: {
    deleteMany: vi.fn(),
    aggregate: vi.fn(),
    createMany: vi.fn(),
  },
  $transaction: vi.fn(),
}))

const requireAuthMock = vi.hoisted(() => vi.fn())
const resolveSafeDownloadPathForDeleteMock = vi.hoisted(() => vi.fn())
const fsUnlinkMock = vi.hoisted(() => vi.fn())

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

vi.mock("../lib/downloadPaths", () => ({
  resolveSafeDownloadPathForDelete: resolveSafeDownloadPathForDeleteMock,
}))

vi.mock("fs/promises", () => ({
  default: { unlink: fsUnlinkMock },
}))

function makeRequest(method: string, body: unknown) {
  return new NextRequest("http://localhost/api/songs/bulk", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("PATCH /api/songs/bulk", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireAuthMock.mockResolvedValue({ userId: 7, role: "user", username: "u" })
  })

  it("returns 400 for empty ids array", async () => {
    const { PATCH } = await import("../app/api/songs/bulk/route")
    const res = await PATCH(makeRequest("PATCH", { ids: [] }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain("ids must be a non-empty array")
  })

  it("returns 400 for invalid ids (non-array)", async () => {
    const { PATCH } = await import("../app/api/songs/bulk/route")
    const res = await PATCH(makeRequest("PATCH", { ids: "not-array" }))
    expect(res.status).toBe(400)
  })

  it("returns 400 for invalid playlistId (negative)", async () => {
    const { PATCH } = await import("../app/api/songs/bulk/route")
    const res = await PATCH(makeRequest("PATCH", { ids: [1], playlistId: -5 }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain("Invalid playlist ID")
  })

  it("returns 400 for non-integer playlistId", async () => {
    const { PATCH } = await import("../app/api/songs/bulk/route")
    const res = await PATCH(makeRequest("PATCH", { ids: [1], playlistId: "abc" }))
    expect(res.status).toBe(400)
  })

  it("returns 404 when some songs not found", async () => {
    prismaMock.song.findMany.mockResolvedValue([{ id: 1 }])

    const { PATCH } = await import("../app/api/songs/bulk/route")
    const res = await PATCH(makeRequest("PATCH", { ids: [1, 2], playlistId: null }))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toContain("not found")
  })

  it("returns 404 when playlist not found (inside transaction)", async () => {
    prismaMock.song.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }])
    prismaMock.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      return cb({
        playlist: { findFirst: vi.fn().mockResolvedValue(null) },
        song: { updateMany: vi.fn() },
        playlistSong: { deleteMany: vi.fn(), aggregate: vi.fn(), createMany: vi.fn() },
      })
    })

    const { PATCH } = await import("../app/api/songs/bulk/route")
    const res = await PATCH(makeRequest("PATCH", { ids: [1, 2], playlistId: 10 }))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe("Playlist not found")
  })

  it("successfully assigns songs to playlist with correct positions", async () => {
    prismaMock.song.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }])

    const txUpdateMany = vi.fn()
    const txDeleteMany = vi.fn()
    const txAggregate = vi.fn().mockResolvedValue({ _max: { position: 3 } })
    const txCreateMany = vi.fn()
    const txPlaylistFindFirst = vi.fn().mockResolvedValue({ id: 10 })

    prismaMock.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      return cb({
        playlist: { findFirst: txPlaylistFindFirst },
        song: { updateMany: txUpdateMany },
        playlistSong: { deleteMany: txDeleteMany, aggregate: txAggregate, createMany: txCreateMany },
      })
    })

    const { PATCH } = await import("../app/api/songs/bulk/route")
    const res = await PATCH(makeRequest("PATCH", { ids: [1, 2], playlistId: 10 }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ success: true, updatedIds: [1, 2], playlistId: 10 })
    expect(txUpdateMany).toHaveBeenCalledWith({
      where: { userId: 7, id: { in: [1, 2] } },
      data: { playlistId: 10 },
    })
    expect(txDeleteMany).toHaveBeenCalledWith({ where: { songId: { in: [1, 2] } } })
    expect(txCreateMany).toHaveBeenCalledWith({
      data: [
        { playlistId: 10, songId: 1, position: 4 },
        { playlistId: 10, songId: 2, position: 5 },
      ],
    })
  })

  it("successfully unassigns songs (playlistId=null removes entries)", async () => {
    prismaMock.song.findMany.mockResolvedValue([{ id: 1 }])

    const txUpdateMany = vi.fn()
    const txDeleteMany = vi.fn()

    prismaMock.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      return cb({
        song: { updateMany: txUpdateMany },
        playlistSong: { deleteMany: txDeleteMany },
      })
    })

    const { PATCH } = await import("../app/api/songs/bulk/route")
    const res = await PATCH(makeRequest("PATCH", { ids: [1], playlistId: null }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.playlistId).toBeNull()
    expect(txUpdateMany).toHaveBeenCalledWith({
      where: { userId: 7, id: { in: [1] } },
      data: { playlistId: null },
    })
    expect(txDeleteMany).toHaveBeenCalledWith({ where: { songId: { in: [1] } } })
  })

  it("deduplicates song IDs via parseSongIds", async () => {
    prismaMock.song.findMany.mockResolvedValue([{ id: 5 }])

    const txUpdateMany = vi.fn()
    const txDeleteMany = vi.fn()

    prismaMock.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      return cb({
        song: { updateMany: txUpdateMany },
        playlistSong: { deleteMany: txDeleteMany },
      })
    })

    const { PATCH } = await import("../app/api/songs/bulk/route")
    const res = await PATCH(makeRequest("PATCH", { ids: [5, 5, 5], playlistId: null }))

    expect(res.status).toBe(200)
    // findMany was called with deduplicated [5], not [5, 5, 5]
    expect(prismaMock.song.findMany).toHaveBeenCalledWith({
      where: { userId: 7, id: { in: [5] } },
      select: { id: true },
    })
  })

  it("auth error returns correct status", async () => {
    const { AuthError } = await import("../lib/requireAuth")
    requireAuthMock.mockRejectedValue(new AuthError("Forbidden", 403))

    const { PATCH } = await import("../app/api/songs/bulk/route")
    const res = await PATCH(makeRequest("PATCH", { ids: [1] }))
    expect(res.status).toBe(403)
  })
})

describe("DELETE /api/songs/bulk", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireAuthMock.mockResolvedValue({ userId: 7, role: "user", username: "u" })
  })

  it("returns 400 for empty ids array", async () => {
    const { DELETE } = await import("../app/api/songs/bulk/route")
    const res = await DELETE(makeRequest("DELETE", { ids: [] }))
    expect(res.status).toBe(400)
  })

  it("returns 400 for invalid ids", async () => {
    const { DELETE } = await import("../app/api/songs/bulk/route")
    const res = await DELETE(makeRequest("DELETE", { ids: "nope" }))
    expect(res.status).toBe(400)
  })

  it("returns 404 when some songs not found", async () => {
    prismaMock.song.findMany.mockResolvedValue([{ id: 1, filePath: "/a", coverPath: null }])

    const { DELETE } = await import("../app/api/songs/bulk/route")
    const res = await DELETE(makeRequest("DELETE", { ids: [1, 2] }))
    expect(res.status).toBe(404)
  })

  it("successfully deletes songs and attempts file unlink", async () => {
    prismaMock.song.findMany.mockResolvedValue([
      { id: 1, filePath: "/downloads/a.mp3", coverPath: "/downloads/a.jpg" },
      { id: 2, filePath: "/downloads/b.mp3", coverPath: null },
    ])
    prismaMock.song.deleteMany.mockResolvedValue({ count: 2 })
    resolveSafeDownloadPathForDeleteMock.mockImplementation((p: string) => p)
    fsUnlinkMock.mockResolvedValue(undefined)

    const { DELETE } = await import("../app/api/songs/bulk/route")
    const res = await DELETE(makeRequest("DELETE", { ids: [1, 2] }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ success: true, deletedIds: [1, 2] })
    expect(prismaMock.song.deleteMany).toHaveBeenCalledWith({
      where: { userId: 7, id: { in: [1, 2] } },
    })
    expect(fsUnlinkMock).toHaveBeenCalledTimes(3)
  })

  it("file deletion failures are graceful", async () => {
    prismaMock.song.findMany.mockResolvedValue([
      { id: 1, filePath: "/downloads/a.mp3", coverPath: null },
    ])
    prismaMock.song.deleteMany.mockResolvedValue({ count: 1 })
    resolveSafeDownloadPathForDeleteMock.mockReturnValue("/downloads/a.mp3")
    fsUnlinkMock.mockRejectedValue(new Error("ENOENT"))

    const { DELETE } = await import("../app/api/songs/bulk/route")
    const res = await DELETE(makeRequest("DELETE", { ids: [1] }))

    expect(res.status).toBe(200)
  })

  it("auth error returns correct status", async () => {
    const { AuthError } = await import("../lib/requireAuth")
    requireAuthMock.mockRejectedValue(new AuthError("Unauthorized", 401))

    const { DELETE } = await import("../app/api/songs/bulk/route")
    const res = await DELETE(makeRequest("DELETE", { ids: [1] }))
    expect(res.status).toBe(401)
  })
})
