import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const prismaMock = {
  user: {
    count: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}

const requireAuthMock = vi.fn()
const requireAdminMock = vi.fn()

vi.mock("../lib/prisma", () => ({
  default: prismaMock,
}))

vi.mock("../lib/requireAuth", async () => {
  const actual = await vi.importActual("../lib/requireAuth")
  return {
    ...(actual as object),
    requireAuth: requireAuthMock,
    requireAdmin: requireAdminMock,
  }
})

vi.mock("../lib/auth", () => ({
  hashPassword: vi.fn(),
}))

describe("users/:id revokeSessions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("admin can revoke sessions for target user", async () => {
    requireAuthMock.mockResolvedValue({ userId: 1, role: "admin", username: "admin" })
    requireAdminMock.mockImplementation(() => {})

    prismaMock.user.findUnique.mockResolvedValue({
      id: 2,
      role: "user",
      disabledAt: null,
    })
    prismaMock.user.update.mockResolvedValue({
      id: 2,
      username: "target",
      role: "user",
      subsonicToken: "token",
      disabledAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    })

    const { PATCH } = await import("../app/api/users/[id]/route")
    const req = new NextRequest("http://localhost/api/users/2", {
      method: "PATCH",
      body: JSON.stringify({ revokeSessions: true }),
      headers: { "content-type": "application/json" },
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: "2" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 2 },
        data: expect.objectContaining({
          authTokenVersion: { increment: 1 },
        }),
      })
    )
    expect(body.id).toBe(2)
    expect(body.hasSubsonicToken).toBe(true)
  })
})
