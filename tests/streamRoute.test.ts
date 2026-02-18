import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const prismaMock = vi.hoisted(() => ({
  song: {
    findFirst: vi.fn(),
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

describe("GET /api/stream/[id]", () => {
  let tempRoot = ""
  let cwdSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.clearAllMocks()
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "echodeck-streamroute-"))
    await fs.mkdir(path.join(tempRoot, "downloads"), { recursive: true })
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot)
    requireAuthMock.mockResolvedValue({ userId: 7, role: "user", username: "u" })
  })

  afterEach(async () => {
    cwdSpy.mockRestore()
    await fs.rm(tempRoot, { recursive: true, force: true })
  })

  it("streams when song path is legacy /downloads absolute", async () => {
    const filePath = path.join(tempRoot, "downloads", "song.mp3")
    await fs.writeFile(filePath, "abc")

    prismaMock.song.findFirst.mockResolvedValue({
      id: 669,
      userId: 7,
      filePath: "/downloads/song.mp3",
      format: "mp3",
    })

    const { GET } = await import("../app/api/stream/[id]/route")
    const req = new NextRequest("http://localhost/api/stream/669")
    const res = await GET(req, { params: Promise.resolve({ id: "669" }) })

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("audio/mpeg")
    expect(Buffer.from(await res.arrayBuffer()).toString("utf8")).toBe("abc")
  })

  it("returns 403 for file paths outside allowed downloads roots", async () => {
    prismaMock.song.findFirst.mockResolvedValue({
      id: 670,
      userId: 7,
      filePath: path.join(tempRoot, "outside", "song.mp3"),
      format: "mp3",
    })

    const { GET } = await import("../app/api/stream/[id]/route")
    const req = new NextRequest("http://localhost/api/stream/670")
    const res = await GET(req, { params: Promise.resolve({ id: "670" }) })
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toBe("Access denied")
  })
})
