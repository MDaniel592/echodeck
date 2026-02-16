import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const prismaMock = vi.hoisted(() => ({
  song: {
    findMany: vi.fn(),
  },
  playbackSession: {
    upsert: vi.fn(),
  },
  playbackQueueItem: {
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  },
  $transaction: vi.fn(),
}))

const requireAuthMock = vi.hoisted(() => vi.fn())

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

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/playback/queue", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("PUT /api/playback/queue", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireAuthMock.mockResolvedValue({ userId: 7, role: "user", username: "u" })
  })

  it("returns 400 for missing deviceId", async () => {
    const { PUT } = await import("../app/api/playback/queue/route")
    const res = await PUT(makeRequest({ songIds: [1] }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain("deviceId is required")
  })

  it("returns 400 for non-array songIds", async () => {
    const { PUT } = await import("../app/api/playback/queue/route")
    const res = await PUT(makeRequest({ deviceId: "web", songIds: "not-array" }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain("songIds must be an array")
  })

  it("returns 400 for duplicate songIds", async () => {
    const { PUT } = await import("../app/api/playback/queue/route")
    const res = await PUT(makeRequest({ deviceId: "web", songIds: [1, 2, 1] }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain("duplicates")
  })

  it("returns 404 when songs not found", async () => {
    prismaMock.song.findMany.mockResolvedValue([{ id: 1 }])

    const { PUT } = await import("../app/api/playback/queue/route")
    const res = await PUT(makeRequest({ deviceId: "web", songIds: [1, 2] }))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toContain("not found")
  })

  it("unchanged queue returns { unchanged: true } without rewriting", async () => {
    prismaMock.song.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }])

    const txUpsert = vi.fn().mockResolvedValue({
      id: 99,
      queueItems: [{ songId: 1 }, { songId: 2 }],
    })
    const txDeleteMany = vi.fn()
    const txCreateMany = vi.fn()

    prismaMock.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      return cb({
        playbackSession: { upsert: txUpsert },
        playbackQueueItem: { deleteMany: txDeleteMany, createMany: txCreateMany },
      })
    })

    const { PUT } = await import("../app/api/playback/queue/route")
    const res = await PUT(makeRequest({ deviceId: "web", songIds: [1, 2] }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.unchanged).toBe(true)
    expect(body.sessionId).toBe(99)
    expect(txDeleteMany).not.toHaveBeenCalled()
    expect(txCreateMany).not.toHaveBeenCalled()
  })

  it("changed queue deletes old items and creates new items", async () => {
    prismaMock.song.findMany.mockResolvedValue([{ id: 1 }, { id: 3 }])

    const txUpsert = vi.fn().mockResolvedValue({
      id: 99,
      queueItems: [{ songId: 1 }, { songId: 2 }],
    })
    const txDeleteMany = vi.fn()
    const txCreateMany = vi.fn()

    prismaMock.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      return cb({
        playbackSession: { upsert: txUpsert },
        playbackQueueItem: { deleteMany: txDeleteMany, createMany: txCreateMany },
      })
    })

    const { PUT } = await import("../app/api/playback/queue/route")
    const res = await PUT(makeRequest({ deviceId: "web", songIds: [1, 3] }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.unchanged).toBeUndefined()
    expect(body.sessionId).toBe(99)
    expect(txDeleteMany).toHaveBeenCalledWith({ where: { sessionId: 99 } })
    expect(txCreateMany).toHaveBeenCalledWith({
      data: [
        { sessionId: 99, songId: 1, sortOrder: 0 },
        { sessionId: 99, songId: 3, sortOrder: 1 },
      ],
    })
  })

  it("empty songIds clears queue", async () => {
    prismaMock.song.findMany.mockResolvedValue([])

    const txUpsert = vi.fn().mockResolvedValue({
      id: 99,
      queueItems: [{ songId: 1 }],
    })
    const txDeleteMany = vi.fn()
    const txCreateMany = vi.fn()

    prismaMock.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      return cb({
        playbackSession: { upsert: txUpsert },
        playbackQueueItem: { deleteMany: txDeleteMany, createMany: txCreateMany },
      })
    })

    const { PUT } = await import("../app/api/playback/queue/route")
    const res = await PUT(makeRequest({ deviceId: "web", songIds: [] }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(txDeleteMany).toHaveBeenCalledWith({ where: { sessionId: 99 } })
    expect(txCreateMany).not.toHaveBeenCalled()
    expect(body.length).toBe(0)
  })

  it("auth error returns correct status", async () => {
    const { AuthError } = await import("../lib/requireAuth")
    requireAuthMock.mockRejectedValue(new AuthError("Forbidden", 403))

    const { PUT } = await import("../app/api/playback/queue/route")
    const res = await PUT(makeRequest({ deviceId: "web", songIds: [1] }))
    expect(res.status).toBe(403)
  })
})
