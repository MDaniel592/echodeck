import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const prismaMock = vi.hoisted(() => ({
  song: {
    findMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}))

const resolveSafeDownloadPathForReadMock = vi.hoisted(() => vi.fn())

vi.mock("../lib/prisma", () => ({
  default: prismaMock,
}))

vi.mock("../lib/downloadPaths", () => ({
  resolveSafeDownloadPathForRead: resolveSafeDownloadPathForReadMock,
}))

describe("songDedup.findReusableSongBySourceUrl", () => {
  let tempRoot = ""

  beforeEach(async () => {
    vi.clearAllMocks()
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "echodeck-songdedup-"))
  })

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true })
  })

  it("reuses existing legacy path and heals filePath to resolved path", async () => {
    const resolvedPath = path.join(tempRoot, "downloads", "song.opus")
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true })
    await fs.writeFile(resolvedPath, "ok")

    prismaMock.song.findMany.mockResolvedValue([
      {
        id: 11,
        userId: 7,
        source: "youtube",
        sourceUrl: "https://www.youtube.com/watch?v=abc123def45",
        filePath: "/downloads/song.opus",
        createdAt: new Date(),
      },
    ])
    resolveSafeDownloadPathForReadMock.mockReturnValue(resolvedPath)
    prismaMock.song.update.mockResolvedValue(undefined)

    const { findReusableSongBySourceUrl } = await import("../lib/songDedup")
    const result = await findReusableSongBySourceUrl(
      7,
      "youtube",
      "https://www.youtube.com/watch?v=abc123def45"
    )

    expect(result).not.toBeNull()
    expect(result?.filePath).toBe(resolvedPath)
    expect(prismaMock.song.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: { filePath: resolvedPath },
    })
    expect(prismaMock.song.delete).not.toHaveBeenCalled()
  })

  it("does not delete entries when path is outside allowed roots", async () => {
    prismaMock.song.findMany.mockResolvedValue([
      {
        id: 22,
        userId: 7,
        source: "youtube",
        sourceUrl: "https://www.youtube.com/watch?v=abc123def45",
        filePath: "/mnt/music/song.opus",
        createdAt: new Date(),
      },
    ])
    resolveSafeDownloadPathForReadMock.mockReturnValue(null)

    const { findReusableSongBySourceUrl } = await import("../lib/songDedup")
    const result = await findReusableSongBySourceUrl(
      7,
      "youtube",
      "https://www.youtube.com/watch?v=abc123def45"
    )

    expect(result).toBeNull()
    expect(prismaMock.song.delete).not.toHaveBeenCalled()
  })

  it("cleans up stale entries when safe path is missing", async () => {
    const missingPath = path.join(tempRoot, "downloads", "missing.opus")
    prismaMock.song.findMany.mockResolvedValue([
      {
        id: 33,
        userId: 7,
        source: "youtube",
        sourceUrl: "https://www.youtube.com/watch?v=abc123def45",
        filePath: "/downloads/missing.opus",
        createdAt: new Date(),
      },
    ])
    resolveSafeDownloadPathForReadMock.mockReturnValue(missingPath)
    prismaMock.song.delete.mockResolvedValue(undefined)

    const { findReusableSongBySourceUrl } = await import("../lib/songDedup")
    const result = await findReusableSongBySourceUrl(
      7,
      "youtube",
      "https://www.youtube.com/watch?v=abc123def45"
    )

    expect(result).toBeNull()
    expect(prismaMock.song.delete).toHaveBeenCalledWith({ where: { id: 33 } })
  })
})
