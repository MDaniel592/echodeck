import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const prismaMock = vi.hoisted(() => ({
  smartPlaylist: {
    findMany: vi.fn(),
    create: vi.fn(),
    findFirst: vi.fn(),
  },
  song: {
    count: vi.fn(),
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

describe("smart playlists routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireAuthMock.mockResolvedValue({ userId: 7, role: "user", username: "u" })
  })

  it("GET /api/smart-playlists handles malformed stored rules without crashing", async () => {
    prismaMock.smartPlaylist.findMany.mockResolvedValue([
      {
        id: 1,
        userId: 7,
        name: "Valid",
        ruleJson: JSON.stringify({ artistContains: "Daft Punk" }),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 2,
        userId: 7,
        name: "Broken",
        ruleJson: "{invalid-json",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])
    prismaMock.song.count.mockResolvedValueOnce(12).mockResolvedValueOnce(55)

    const { GET } = await import("../app/api/smart-playlists/route")
    const res = await GET(new NextRequest("http://localhost/api/smart-playlists"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toHaveLength(2)
    expect(body[0].estimatedSongCount).toBe(12)
    expect(body[1].estimatedSongCount).toBe(55)
    expect(body[1].ruleErrors).toContain("Stored rule JSON is invalid")
  })

  it("GET /api/smart-playlists supports includeCounts=0 to avoid count queries", async () => {
    prismaMock.smartPlaylist.findMany.mockResolvedValue([
      {
        id: 1,
        userId: 7,
        name: "NoCount",
        ruleJson: JSON.stringify({}),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])

    const { GET } = await import("../app/api/smart-playlists/route")
    const res = await GET(new NextRequest("http://localhost/api/smart-playlists?includeCounts=0"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(prismaMock.song.count).not.toHaveBeenCalled()
    expect(body[0].estimatedSongCount).toBeNull()
  })

  it("POST /api/smart-playlists rejects invalid range rules", async () => {
    const { POST } = await import("../app/api/smart-playlists/route")
    const req = new NextRequest("http://localhost/api/smart-playlists", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Invalid Rule",
        rule: { yearGte: 2025, yearLte: 2020 },
      }),
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe("Invalid smart playlist rule")
  })

  it("GET /api/smart-playlists/:id/songs returns 422 for malformed stored rule JSON", async () => {
    prismaMock.smartPlaylist.findFirst.mockResolvedValue({
      id: 10,
      userId: 7,
      name: "Broken Rule",
      ruleJson: "{bad-json",
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const { GET } = await import("../app/api/smart-playlists/[id]/songs/route")
    const req = new NextRequest("http://localhost/api/smart-playlists/10/songs")
    const res = await GET(req, { params: Promise.resolve({ id: "10" }) })
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.error).toBe("Smart playlist rule is invalid")
  })
})
