import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const prismaMock = vi.hoisted(() => ({
  song: {
    findFirst: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
  playlist: {
    findFirst: vi.fn(),
  },
}))

const requireAuthMock = vi.hoisted(() => vi.fn())
const sanitizeSongMock = vi.hoisted(() => vi.fn((s: Record<string, unknown>) => s))
const assignSongToPlaylistForUserMock = vi.hoisted(() => vi.fn())
const getSafeDeletePathsForRemovedSongsMock = vi.hoisted(() => vi.fn())
const unlinkMock = vi.hoisted(() => vi.fn())

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

vi.mock("../lib/playlistEntries", () => ({
  assignSongToPlaylistForUser: assignSongToPlaylistForUserMock,
}))

vi.mock("../lib/songFiles", () => ({
  getSafeDeletePathsForRemovedSongs: getSafeDeletePathsForRemovedSongsMock,
}))

vi.mock("fs/promises", () => ({
  default: { unlink: unlinkMock },
}))

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/songs/1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

const baseSong = {
  id: 1,
  title: "Original",
  artist: "Original Artist",
  album: "Original Album",
  filePath: "/downloads/song.mp3",
  coverPath: null,
  userId: 7,
}

describe("PATCH /api/songs/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireAuthMock.mockResolvedValue({ userId: 7, role: "user", username: "u" })
    prismaMock.song.findFirst.mockResolvedValue(baseSong)
    prismaMock.song.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...baseSong,
      ...data,
    }))
    prismaMock.song.deleteMany.mockResolvedValue({ count: 1 })
    sanitizeSongMock.mockImplementation((s: Record<string, unknown>) => s)
    assignSongToPlaylistForUserMock.mockResolvedValue(undefined)
    getSafeDeletePathsForRemovedSongsMock.mockResolvedValue([])
    unlinkMock.mockResolvedValue(undefined)
  })

  it("returns 400 for invalid song ID", async () => {
    const { PATCH } = await import("../app/api/songs/[id]/route")
    const req = new NextRequest("http://localhost/api/songs/abc", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New" }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: "abc" }) })
    expect(res.status).toBe(400)
  })

  it("returns 404 when song not found", async () => {
    prismaMock.song.findFirst.mockResolvedValue(null)

    const { PATCH } = await import("../app/api/songs/[id]/route")
    const res = await PATCH(makeRequest({ title: "New" }), { params: Promise.resolve({ id: "1" }) })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe("Song not found")
  })

  it("returns 404 when playlist not found", async () => {
    prismaMock.playlist.findFirst.mockResolvedValue(null)

    const { PATCH } = await import("../app/api/songs/[id]/route")
    const res = await PATCH(makeRequest({ playlistId: 99 }), { params: Promise.resolve({ id: "1" }) })
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe("Playlist not found")
  })

  it("normalizeOptionalString: undefined is skipped", async () => {
    const { PATCH } = await import("../app/api/songs/[id]/route")
    await PATCH(makeRequest({ year: 2020 }), { params: Promise.resolve({ id: "1" }) })

    const updateData = prismaMock.song.update.mock.calls[0][0].data
    expect(updateData).not.toHaveProperty("title")
    expect(updateData).not.toHaveProperty("artist")
  })

  it("normalizeOptionalString: null sets to null", async () => {
    const { PATCH } = await import("../app/api/songs/[id]/route")
    await PATCH(makeRequest({ artist: null }), { params: Promise.resolve({ id: "1" }) })

    const updateData = prismaMock.song.update.mock.calls[0][0].data
    expect(updateData.artist).toBeNull()
  })

  it("normalizeOptionalString: empty string sets to null", async () => {
    const { PATCH } = await import("../app/api/songs/[id]/route")
    await PATCH(makeRequest({ artist: "" }), { params: Promise.resolve({ id: "1" }) })

    const updateData = prismaMock.song.update.mock.calls[0][0].data
    expect(updateData.artist).toBeNull()
  })

  it("normalizeOptionalString: trims and respects maxLen", async () => {
    const { PATCH } = await import("../app/api/songs/[id]/route")
    const longTitle = "A".repeat(500)
    await PATCH(makeRequest({ title: `  ${longTitle}  ` }), { params: Promise.resolve({ id: "1" }) })

    const updateData = prismaMock.song.update.mock.calls[0][0].data
    expect(updateData.title).toBe("A".repeat(300))
  })

  it("normalizeOptionalInt: undefined is skipped", async () => {
    const { PATCH } = await import("../app/api/songs/[id]/route")
    await PATCH(makeRequest({ title: "New" }), { params: Promise.resolve({ id: "1" }) })

    const updateData = prismaMock.song.update.mock.calls[0][0].data
    expect(updateData).not.toHaveProperty("year")
    expect(updateData).not.toHaveProperty("trackNumber")
  })

  it("normalizeOptionalInt: null sets to null", async () => {
    const { PATCH } = await import("../app/api/songs/[id]/route")
    await PATCH(makeRequest({ year: null }), { params: Promise.resolve({ id: "1" }) })

    const updateData = prismaMock.song.update.mock.calls[0][0].data
    expect(updateData.year).toBeNull()
  })

  it("normalizeOptionalInt: out-of-range is skipped", async () => {
    const { PATCH } = await import("../app/api/songs/[id]/route")
    await PATCH(makeRequest({ year: 99999 }), { params: Promise.resolve({ id: "1" }) })

    const updateData = prismaMock.song.update.mock.calls[0][0].data
    expect(updateData).not.toHaveProperty("year")
  })

  it("normalizeOptionalInt: valid value is parsed", async () => {
    const { PATCH } = await import("../app/api/songs/[id]/route")
    await PATCH(makeRequest({ year: 2024 }), { params: Promise.resolve({ id: "1" }) })

    const updateData = prismaMock.song.update.mock.calls[0][0].data
    expect(updateData.year).toBe(2024)
  })

  it("only updates provided fields (partial update)", async () => {
    const { PATCH } = await import("../app/api/songs/[id]/route")
    await PATCH(makeRequest({ artist: "New Artist" }), { params: Promise.resolve({ id: "1" }) })

    const updateData = prismaMock.song.update.mock.calls[0][0].data
    expect(updateData.artist).toBe("New Artist")
    expect(updateData).not.toHaveProperty("title")
    expect(updateData).not.toHaveProperty("album")
    expect(updateData).not.toHaveProperty("year")
  })

  it("assigns playlist via assignSongToPlaylistForUser", async () => {
    prismaMock.playlist.findFirst.mockResolvedValue({ id: 5 })

    const { PATCH } = await import("../app/api/songs/[id]/route")
    await PATCH(makeRequest({ playlistId: 5 }), { params: Promise.resolve({ id: "1" }) })

    expect(assignSongToPlaylistForUserMock).toHaveBeenCalledWith(7, 1, 5)
  })

  it("does not call assignSongToPlaylistForUser when playlistId not in body", async () => {
    const { PATCH } = await import("../app/api/songs/[id]/route")
    await PATCH(makeRequest({ title: "New" }), { params: Promise.resolve({ id: "1" }) })

    expect(assignSongToPlaylistForUserMock).not.toHaveBeenCalled()
  })

  it("auth error returns correct status", async () => {
    const { AuthError } = await import("../lib/requireAuth")
    requireAuthMock.mockRejectedValue(new AuthError("Unauthorized", 401))

    const { PATCH } = await import("../app/api/songs/[id]/route")
    const res = await PATCH(makeRequest({ title: "New" }), { params: Promise.resolve({ id: "1" }) })
    expect(res.status).toBe(401)
  })
})

describe("DELETE /api/songs/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireAuthMock.mockResolvedValue({ userId: 7, role: "user", username: "u" })
    prismaMock.song.findFirst.mockResolvedValue(baseSong)
    prismaMock.song.deleteMany.mockResolvedValue({ count: 1 })
    getSafeDeletePathsForRemovedSongsMock.mockResolvedValue(["/downloads/song.mp3"])
    unlinkMock.mockResolvedValue(undefined)
  })

  it("deletes the song and only unlinks validated unreferenced paths", async () => {
    const { DELETE } = await import("../app/api/songs/[id]/route")
    const req = new NextRequest("http://localhost/api/songs/1", { method: "DELETE" })
    const res = await DELETE(req, { params: Promise.resolve({ id: "1" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ success: true })
    expect(prismaMock.song.deleteMany).toHaveBeenCalledWith({ where: { id: 1, userId: 7 } })
    expect(getSafeDeletePathsForRemovedSongsMock).toHaveBeenCalledWith([
      { filePath: "/downloads/song.mp3", coverPath: null },
    ])
    expect(unlinkMock).toHaveBeenCalledWith("/downloads/song.mp3")
  })

  it("returns 404 when song does not exist", async () => {
    prismaMock.song.findFirst.mockResolvedValue(null)
    const { DELETE } = await import("../app/api/songs/[id]/route")
    const req = new NextRequest("http://localhost/api/songs/1", { method: "DELETE" })
    const res = await DELETE(req, { params: Promise.resolve({ id: "1" }) })

    expect(res.status).toBe(404)
    expect(prismaMock.song.deleteMany).not.toHaveBeenCalled()
  })
})
