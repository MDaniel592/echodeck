import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const updateMock = vi.hoisted(() => vi.fn())

const prismaMock = vi.hoisted(() => ({
  playbackSession: {
    findUnique: vi.fn(),
  },
  playbackQueueItem: {
    findMany: vi.fn(),
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

describe("playback queue reorder route", () => {
  beforeEach(() => {
    vi.clearAllMocks()

    requireAuthMock.mockResolvedValue({ userId: 7, role: "user", username: "u" })
    prismaMock.playbackSession.findUnique.mockResolvedValue({ id: 99 })
    prismaMock.playbackQueueItem.findMany.mockResolvedValue([
      { id: 11, songId: 101 },
      { id: 12, songId: 102 },
      { id: 13, songId: 103 },
    ])
    updateMock.mockResolvedValue({})
    prismaMock.$transaction.mockImplementation(async (callback: unknown) => {
      if (typeof callback !== "function") {
        throw new Error("Expected interactive transaction callback")
      }
      return callback({
        playbackQueueItem: {
          update: updateMock,
        },
      })
    })
  })

  it("uses staged sort orders before final sort orders to avoid unique collisions", async () => {
    const { POST } = await import("../app/api/playback/queue/reorder/route")
    const req = new NextRequest("http://localhost/api/playback/queue/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: "web-a",
        fromIndex: 0,
        toIndex: 2,
      }),
    })

    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ success: true, length: 3 })
    expect(updateMock).toHaveBeenCalledTimes(6)

    const calls = updateMock.mock.calls.map((call) => call[0])
    // First pass: staged order in non-overlapping temp range.
    expect(calls[0]).toEqual({ where: { id: 12 }, data: { sortOrder: 4 } })
    expect(calls[1]).toEqual({ where: { id: 13 }, data: { sortOrder: 5 } })
    expect(calls[2]).toEqual({ where: { id: 11 }, data: { sortOrder: 6 } })
    // Second pass: final contiguous order.
    expect(calls[3]).toEqual({ where: { id: 12 }, data: { sortOrder: 0 } })
    expect(calls[4]).toEqual({ where: { id: 13 }, data: { sortOrder: 1 } })
    expect(calls[5]).toEqual({ where: { id: 11 }, data: { sortOrder: 2 } })
  })
})
