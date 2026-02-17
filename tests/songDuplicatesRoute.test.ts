import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const prismaMock = vi.hoisted(() => ({
  song: {
    findMany: vi.fn(),
  },
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

describe("GET /api/songs/duplicates", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireAuthMock.mockResolvedValue({ userId: 12, role: "user", username: "u12" })
  })

  it("groups likely duplicate songs", async () => {
    const now = new Date("2026-02-17T00:00:00.000Z")
    prismaMock.song.findMany.mockResolvedValue([
      {
        id: 1,
        title: "Nightcall",
        artist: "Kavinsky",
        duration: 245,
        filePath: "/a/nightcall.flac",
        source: "library",
        bitrate: 900,
        fileSize: 50_000_000,
        createdAt: now,
      },
      {
        id: 2,
        title: "Nightcall",
        artist: "Kavinsky",
        duration: 244,
        filePath: "/b/nightcall.mp3",
        source: "youtube",
        bitrate: 320,
        fileSize: 8_000_000,
        createdAt: now,
      },
      {
        id: 3,
        title: "Different Song",
        artist: "Other",
        duration: 210,
        filePath: "/c/other.mp3",
        source: "youtube",
        bitrate: 320,
        fileSize: 7_000_000,
        createdAt: now,
      },
    ])

    const { GET } = await import("../app/api/songs/duplicates/route")
    const res = await GET(new NextRequest("http://localhost/api/songs/duplicates?minGroupSize=2"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.groupCount).toBe(1)
    expect(body.groups[0].songs).toHaveLength(2)
    expect(body.groups[0].songs[0].id).toBe(1)
  })
})
