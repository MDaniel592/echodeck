import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const prismaMock = vi.hoisted(() => ({
  share: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock("../lib/prisma", () => ({
  default: prismaMock,
}))

describe("subsonic share route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.share.update.mockResolvedValue({})
  })

  it("returns 400 for empty token", async () => {
    const { GET } = await import("../app/api/subsonic/share/[token]/route")
    const req = new NextRequest("http://localhost/api/subsonic/share/%20%20")
    const res = await GET(req, { params: Promise.resolve({ token: "   " }) })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe("Invalid share token")
  })

  it("returns 410 for expired share", async () => {
    prismaMock.share.findUnique.mockResolvedValue({
      id: 10,
      token: "abc",
      description: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: new Date("2020-01-01T00:00:00.000Z"),
      visitCount: 3,
      user: { username: "alice" },
      entries: [],
    })

    const { GET } = await import("../app/api/subsonic/share/[token]/route")
    const req = new NextRequest("http://localhost/api/subsonic/share/abc")
    const res = await GET(req, { params: Promise.resolve({ token: "abc" }) })
    const body = await res.json()

    expect(res.status).toBe(410)
    expect(body.error).toBe("Share expired")
  })

  it("returns sanitized song entries and tolerates visit update failure", async () => {
    prismaMock.share.findUnique.mockResolvedValue({
      id: 10,
      token: "abc",
      description: "mix",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: null,
      visitCount: 3,
      user: { username: "alice" },
      entries: [
        {
          type: "song",
          song: {
            id: 99,
            title: "Track",
            filePath: "/private/file.mp3",
            coverPath: "/private/cover.jpg",
          },
          album: null,
          playlist: null,
        },
      ],
    })
    prismaMock.share.update.mockRejectedValue(new Error("db timeout"))

    const { GET } = await import("../app/api/subsonic/share/[token]/route")
    const req = new NextRequest("http://localhost/api/subsonic/share/abc")
    const res = await GET(req, { params: Promise.resolve({ token: "abc" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.visitCount).toBe(4)
    expect(body.entries[0].song.id).toBe(99)
    expect(body.entries[0].song.title).toBe("Track")
    expect(body.entries[0].song.filePath).toBeUndefined()
    expect(body.entries[0].song.coverPath).toBeUndefined()
  })
})
