import { beforeEach, describe, expect, it, vi } from "vitest"

const prismaMock = vi.hoisted(() => ({
  song: {
    count: vi.fn(),
  },
}))

const resolveSafeDownloadPathForDeleteMock = vi.hoisted(() => vi.fn())

vi.mock("../lib/prisma", () => ({
  default: prismaMock,
}))

vi.mock("../lib/downloadPaths", () => ({
  resolveSafeDownloadPathForDelete: resolveSafeDownloadPathForDeleteMock,
}))

describe("songFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveSafeDownloadPathForDeleteMock.mockImplementation((value: string) => value)
  })

  it("returns only unreferenced file and cover paths", async () => {
    prismaMock.song.count.mockImplementation(async ({ where }: { where: { filePath?: string; coverPath?: string } }) => {
      if (where.filePath === "/downloads/a.mp3") return 0
      if (where.filePath === "/downloads/b.mp3") return 2
      if (where.coverPath === "/downloads/a.jpg") return 0
      if (where.coverPath === "/downloads/b.jpg") return 1
      return 0
    })

    const { getSafeDeletePathsForRemovedSongs } = await import("../lib/songFiles")
    const result = await getSafeDeletePathsForRemovedSongs([
      { filePath: "/downloads/a.mp3", coverPath: "/downloads/a.jpg" },
      { filePath: "/downloads/b.mp3", coverPath: "/downloads/b.jpg" },
    ])

    expect(result).toEqual(["/downloads/a.mp3", "/downloads/a.jpg"])
  })

  it("deduplicates candidates and omits unsafe resolved paths", async () => {
    prismaMock.song.count.mockResolvedValue(0)
    resolveSafeDownloadPathForDeleteMock.mockImplementation((value: string) => {
      if (value === "/downloads/a.jpg") return null
      return value
    })

    const { getSafeDeletePathsForRemovedSongs } = await import("../lib/songFiles")
    const result = await getSafeDeletePathsForRemovedSongs([
      { filePath: "/downloads/a.mp3", coverPath: "/downloads/a.jpg" },
      { filePath: "/downloads/a.mp3", coverPath: "/downloads/a.jpg" },
    ])

    expect(result).toEqual(["/downloads/a.mp3"])
  })
})
