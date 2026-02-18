import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}))

const verifyPasswordMock = vi.hoisted(() => vi.fn())
const createTokenMock = vi.hoisted(() => vi.fn())
const encryptSubsonicPasswordMock = vi.hoisted(() => vi.fn())
const checkRateLimitMock = vi.hoisted(() => vi.fn())

vi.mock("../lib/prisma", () => ({
  default: prismaMock,
}))

vi.mock("../lib/auth", () => ({
  verifyPassword: verifyPasswordMock,
  createToken: createTokenMock,
}))

vi.mock("../lib/subsonicPassword", () => ({
  encryptSubsonicPassword: encryptSubsonicPasswordMock,
}))

vi.mock("../lib/rateLimit", () => ({
  checkRateLimit: checkRateLimitMock,
}))

describe("auth/login route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    checkRateLimitMock.mockReturnValue({ allowed: true, retryAfterSeconds: 1 })
    createTokenMock.mockReturnValue("jwt-token")
    encryptSubsonicPasswordMock.mockReturnValue("enc-pass")
    verifyPasswordMock.mockResolvedValue(true)
  })

  it("returns 400 when username/password missing", async () => {
    const { POST } = await import("../app/api/auth/login/route")
    const req = new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "", password: "" }),
      headers: { "content-type": "application/json" },
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe("Username and password are required")
  })

  it("returns 429 when rate limited", async () => {
    checkRateLimitMock.mockReturnValueOnce({ allowed: false, retryAfterSeconds: 42 })

    const { POST } = await import("../app/api/auth/login/route")
    const req = new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "admin", password: "pw" }),
      headers: { "content-type": "application/json" },
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(429)
    expect(body.error).toContain("Too many login attempts")
    expect(res.headers.get("retry-after")).toBe("42")
  })

  it("returns 403 for disabled account", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 1,
      passwordHash: "hash",
      subsonicPasswordEnc: null,
      authTokenVersion: 1,
      disabledAt: new Date("2026-01-01T00:00:00.000Z"),
    })

    const { POST } = await import("../app/api/auth/login/route")
    const req = new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "admin", password: "pw" }),
      headers: { "content-type": "application/json" },
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toBe("Account is disabled")
  })

  it("uses an account-only rate limit key", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null)

    const { POST } = await import("../app/api/auth/login/route")
    const req = new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "Admin", password: "pw" }),
      headers: { "content-type": "application/json" },
    })
    const res = await POST(req)

    expect(res.status).toBe(401)
    expect(checkRateLimitMock.mock.calls[1]?.[0]).toBe("login:account:admin")
  })

  it("sets auth cookie on successful login", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 1,
      passwordHash: "hash",
      subsonicPasswordEnc: null,
      authTokenVersion: 3,
      disabledAt: null,
    })
    prismaMock.user.update.mockResolvedValue({})

    const { POST } = await import("../app/api/auth/login/route")
    const req = new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: "admin", password: "pw" }),
      headers: { "content-type": "application/json" },
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ success: true })
    expect(verifyPasswordMock).toHaveBeenCalledWith("pw", "hash")
    expect(createTokenMock).toHaveBeenCalledWith(1, 3)
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { subsonicPasswordEnc: "enc-pass" },
    })
    const cookie = res.headers.get("set-cookie") || ""
    expect(cookie).toContain("auth_token=jwt-token")
    expect(cookie.toLowerCase()).toContain("httponly")
  })
})
