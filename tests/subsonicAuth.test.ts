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
}

const verifyPasswordMock = vi.fn()
const checkRateLimitMock = vi.fn()

vi.mock("../lib/prisma", () => ({
  default: prismaMock,
}))

vi.mock("../lib/auth", () => ({
  verifyPassword: verifyPasswordMock,
}))

vi.mock("../lib/rateLimit", () => ({
  checkRateLimit: checkRateLimitMock,
}))

describe("subsonic auth matrix", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("JWT_SECRET", "test-secret")
    checkRateLimitMock.mockReturnValue({ allowed: true, retryAfterSeconds: 0 })
    prismaMock.library.findMany.mockResolvedValue([])
    prismaMock.user.update.mockResolvedValue({})
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
})
