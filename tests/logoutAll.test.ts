import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const prismaMock = {
  user: {
    update: vi.fn(),
  },
}

const requireAuthMock = vi.fn()

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

describe("auth/logout-all route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("increments token version and clears cookie", async () => {
    requireAuthMock.mockResolvedValue({ userId: 7, role: "user", username: "u" })
    prismaMock.user.update.mockResolvedValue({})

    const { POST } = await import("../app/api/auth/logout-all/route")
    const req = new NextRequest("http://localhost/api/auth/logout-all", { method: "POST" })
    const res = await POST(req)
    const body = await res.json()

    expect(body).toEqual({ success: true })
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { authTokenVersion: { increment: 1 } },
    })

    const setCookie = res.headers.get("set-cookie") || ""
    expect(setCookie).toContain("auth_token=")
    expect(setCookie.toLowerCase()).toContain("max-age=0")
  })

  it("returns auth error status", async () => {
    const { AuthError } = await import("../lib/requireAuth")
    requireAuthMock.mockRejectedValue(new AuthError("Unauthorized", 401))

    const { POST } = await import("../app/api/auth/logout-all/route")
    const req = new NextRequest("http://localhost/api/auth/logout-all", { method: "POST" })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body).toEqual({ error: "Unauthorized" })
  })
})
