import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import {
  createSubsonicTokenFromPassword,
  encryptSubsonicPassword,
} from "../lib/subsonicPassword"

const prismaMock = {
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  library: {
    findMany: vi.fn(),
  },
  song: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
}

const verifyPasswordMock = vi.fn()
const checkRateLimitMock = vi.fn()
const lookupLyricsMock = vi.fn()

vi.mock("../lib/prisma", () => ({
  default: prismaMock,
}))

vi.mock("../lib/auth", () => ({
  verifyPassword: verifyPasswordMock,
}))

vi.mock("../lib/rateLimit", () => ({
  checkRateLimit: checkRateLimitMock,
}))

vi.mock("../lib/lyricsProvider", () => ({
  lookupLyrics: lookupLyricsMock,
}))

describe("subsonic auth matrix", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("JWT_SECRET", "test-secret")
    checkRateLimitMock.mockReturnValue({ allowed: true, retryAfterSeconds: 0 })
    prismaMock.library.findMany.mockResolvedValue([])
    prismaMock.user.update.mockResolvedValue({})
    prismaMock.song.findFirst.mockResolvedValue(null)
    prismaMock.song.update.mockResolvedValue({})
    lookupLyricsMock.mockResolvedValue(null)
  })

  it("accepts u+p plain", async () => {
    verifyPasswordMock.mockResolvedValue(true)
    prismaMock.user.findUnique.mockResolvedValue({
      id: 1,
      username: "alice",
      passwordHash: "hash",
      subsonicToken: "legacy",
      subsonicPasswordEnc: null,
      disabledAt: null,
    })

    const { GET } = await import("../app/api/subsonic/rest/route")
    const req = new NextRequest(
      "http://localhost/api/subsonic/rest?command=getMusicFolders&u=alice&p=plain-pass&v=1.16.1&c=t&f=json"
    )
    const res = await GET(req)
    const body = await res.json()

    expect(verifyPasswordMock).toHaveBeenCalledWith("plain-pass", "hash")
    expect(body["subsonic-response"].status).toBe("ok")
  })

  it("accepts u+p enc:hex", async () => {
    verifyPasswordMock.mockResolvedValue(true)
    prismaMock.user.findUnique.mockResolvedValue({
      id: 1,
      username: "alice",
      passwordHash: "hash",
      subsonicToken: "legacy",
      subsonicPasswordEnc: null,
      disabledAt: null,
    })

    const hex = Buffer.from("enc-pass", "utf8").toString("hex")
    const { GET } = await import("../app/api/subsonic/rest/route")
    const req = new NextRequest(
      `http://localhost/api/subsonic/rest?command=getMusicFolders&u=alice&p=enc:${hex}&v=1.16.1&c=t&f=json`
    )
    const res = await GET(req)
    const body = await res.json()

    expect(verifyPasswordMock).toHaveBeenCalledWith("enc-pass", "hash")
    expect(body["subsonic-response"].status).toBe("ok")
  })

  it("accepts u+t+s using stored password secret", async () => {
    verifyPasswordMock.mockResolvedValue(false)
    const salt = "s123"
    const password = "real-pass"
    const token = createSubsonicTokenFromPassword(password, salt)
    const subsonicPasswordEnc = encryptSubsonicPassword(password)

    prismaMock.user.findUnique.mockResolvedValue({
      id: 1,
      username: "alice",
      passwordHash: "hash",
      subsonicToken: "legacy-token",
      subsonicPasswordEnc,
      disabledAt: null,
    })

    const { GET } = await import("../app/api/subsonic/rest/route")
    const req = new NextRequest(
      `http://localhost/api/subsonic/rest?command=getMusicFolders&u=alice&t=${token}&s=${salt}&v=1.16.1&c=t&f=json`
    )
    const res = await GET(req)
    const body = await res.json()

    expect(body["subsonic-response"].status).toBe("ok")
  })

  it("falls back to legacy token secret when password secret missing", async () => {
    verifyPasswordMock.mockResolvedValue(false)
    const salt = "s456"
    const token = createSubsonicTokenFromPassword("legacy-token", salt)

    prismaMock.user.findUnique.mockResolvedValue({
      id: 1,
      username: "alice",
      passwordHash: "hash",
      subsonicToken: "legacy-token",
      subsonicPasswordEnc: null,
      disabledAt: null,
    })

    const { GET } = await import("../app/api/subsonic/rest/route")
    const req = new NextRequest(
      `http://localhost/api/subsonic/rest?command=getMusicFolders&u=alice&t=${token}&s=${salt}&v=1.16.1&c=t&f=json`
    )
    const res = await GET(req)
    const body = await res.json()

    expect(body["subsonic-response"].status).toBe("ok")
  })

  it("returns lyrics from getLyrics when song exists", async () => {
    verifyPasswordMock.mockResolvedValue(true)
    prismaMock.user.findUnique.mockResolvedValue({
      id: 1,
      username: "alice",
      passwordHash: "hash",
      subsonicToken: "legacy-token",
      subsonicPasswordEnc: null,
      disabledAt: null,
    })
    prismaMock.song.findFirst.mockResolvedValue({
      title: "Song",
      artist: "Artist",
      lyrics: "line one\nline two",
    })

    const { GET } = await import("../app/api/subsonic/rest/route")
    const req = new NextRequest(
      "http://localhost/api/subsonic/rest?command=getLyrics&u=alice&p=plain-pass&artist=Artist&title=Song&v=1.16.1&c=t&f=json"
    )
    const res = await GET(req)
    const body = await res.json()
    const payload = body["subsonic-response"]

    expect(payload.status).toBe("ok")
    expect(payload.lyrics.artist).toBe("Artist")
    expect(payload.lyrics.title).toBe("Song")
    expect(payload.lyrics.value).toBe("line one\nline two")
  })

  it("returns empty lyrics payload when getLyrics is called without title", async () => {
    verifyPasswordMock.mockResolvedValue(true)
    prismaMock.user.findUnique.mockResolvedValue({
      id: 1,
      username: "alice",
      passwordHash: "hash",
      subsonicToken: "legacy-token",
      subsonicPasswordEnc: null,
      disabledAt: null,
    })

    const { GET } = await import("../app/api/subsonic/rest/route")
    const req = new NextRequest(
      "http://localhost/api/subsonic/rest?command=getLyrics&u=alice&p=plain-pass&artist=Artist&v=1.16.1&c=t&f=json"
    )
    const res = await GET(req)
    const body = await res.json()
    const payload = body["subsonic-response"]

    expect(payload.status).toBe("ok")
    expect(payload.lyrics.artist).toBe("Artist")
    expect(payload.lyrics.title).toBe("")
    expect(payload.lyrics.value).toBe("")
  })

  it("returns lyricsList from getLyricsBySongId when song has lyrics", async () => {
    verifyPasswordMock.mockResolvedValue(true)
    prismaMock.user.findUnique.mockResolvedValue({
      id: 1,
      username: "alice",
      passwordHash: "hash",
      subsonicToken: "legacy-token",
      subsonicPasswordEnc: null,
      disabledAt: null,
    })
    prismaMock.song.findFirst.mockResolvedValue({
      id: 123,
      title: "Song",
      artist: "Artist",
      album: null,
      duration: null,
      lyrics: "stored lyrics",
    })

    const { GET } = await import("../app/api/subsonic/rest/route")
    const req = new NextRequest(
      "http://localhost/api/subsonic/rest?command=getLyricsBySongId&u=alice&p=plain-pass&id=123&v=1.16.1&c=t&f=json"
    )
    const res = await GET(req)
    const body = await res.json()
    const payload = body["subsonic-response"]

    expect(payload.status).toBe("ok")
    expect(payload.lyricsList.structuredLyrics).toEqual([])
    expect(payload.lyricsList.lyrics[0]).toEqual({
      artist: "Artist",
      title: "Song",
      value: "stored lyrics",
    })
  })

  it("fetches and persists lyrics in getLyricsBySongId when missing", async () => {
    verifyPasswordMock.mockResolvedValue(true)
    prismaMock.user.findUnique.mockResolvedValue({
      id: 1,
      username: "alice",
      passwordHash: "hash",
      subsonicToken: "legacy-token",
      subsonicPasswordEnc: null,
      disabledAt: null,
    })
    prismaMock.song.findFirst.mockResolvedValue({
      id: 123,
      title: "Song",
      artist: "Artist",
      album: "Album",
      duration: 200,
      lyrics: null,
    })
    lookupLyricsMock.mockResolvedValue("fetched lyrics")

    const { GET } = await import("../app/api/subsonic/rest/route")
    const req = new NextRequest(
      "http://localhost/api/subsonic/rest?command=getLyricsBySongId&u=alice&p=plain-pass&id=123&v=1.16.1&c=t&f=json"
    )
    const res = await GET(req)
    const body = await res.json()
    const payload = body["subsonic-response"]

    expect(payload.status).toBe("ok")
    expect(payload.lyricsList.lyrics[0]).toEqual({
      artist: "Artist",
      title: "Song",
      value: "fetched lyrics",
    })
    expect(lookupLyricsMock).toHaveBeenCalled()
    expect(prismaMock.song.update).toHaveBeenCalledWith({
      where: { id: 123 },
      data: { lyrics: "fetched lyrics" },
    })
  })

  it("fetches lyrics in getLyrics when stored lyrics are missing", async () => {
    verifyPasswordMock.mockResolvedValue(true)
    prismaMock.user.findUnique.mockResolvedValue({
      id: 1,
      username: "alice",
      passwordHash: "hash",
      subsonicToken: "legacy-token",
      subsonicPasswordEnc: null,
      disabledAt: null,
    })
    prismaMock.song.findFirst.mockResolvedValue({
      id: 77,
      title: "Song",
      artist: "Artist",
      album: "Album",
      duration: 180,
      lyrics: null,
    })
    lookupLyricsMock.mockResolvedValue("live fetched lyrics")

    const { GET } = await import("../app/api/subsonic/rest/route")
    const req = new NextRequest(
      "http://localhost/api/subsonic/rest?command=getLyrics&u=alice&p=plain-pass&artist=Artist&title=Song&v=1.16.1&c=t&f=json"
    )
    const res = await GET(req)
    const body = await res.json()
    const payload = body["subsonic-response"]

    expect(payload.status).toBe("ok")
    expect(payload.lyrics.value).toBe("live fetched lyrics")
    expect(prismaMock.song.update).toHaveBeenCalledWith({
      where: { id: 77 },
      data: { lyrics: "live fetched lyrics" },
    })
  })

  it("returns failed response for getLyricsBySongId without id", async () => {
    verifyPasswordMock.mockResolvedValue(true)
    prismaMock.user.findUnique.mockResolvedValue({
      id: 1,
      username: "alice",
      passwordHash: "hash",
      subsonicToken: "legacy-token",
      subsonicPasswordEnc: null,
      disabledAt: null,
    })

    const { GET } = await import("../app/api/subsonic/rest/route")
    const req = new NextRequest(
      "http://localhost/api/subsonic/rest?command=getLyricsBySongId&u=alice&p=plain-pass&v=1.16.1&c=t&f=json"
    )
    const res = await GET(req)
    const body = await res.json()
    const payload = body["subsonic-response"]

    expect(payload.status).toBe("failed")
    expect(payload.error.code).toBe(10)
    expect(payload.error.message).toBe("Missing song id")
  })
})
