import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
}))

const hashPasswordMock = vi.hoisted(() => vi.fn())
const createTokenMock = vi.hoisted(() => vi.fn())
const encryptSubsonicPasswordMock = vi.hoisted(() => vi.fn())

vi.mock("../lib/prisma", () => ({
  default: prismaMock,
}))

vi.mock("../lib/auth", () => ({
  hashPassword: hashPasswordMock,
  createToken: createTokenMock,
}))

vi.mock("../lib/subsonicPassword", () => ({
  encryptSubsonicPassword: encryptSubsonicPasswordMock,
}))

describe("auth/setup route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("NODE_ENV", "test")
    vi.stubEnv("SETUP_SECRET", "")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("returns 400 for malformed json", async () => {
    const { POST } = await import("../app/api/auth/setup/route")
    const req = new NextRequest("http://localhost/api/auth/setup", {
      method: "POST",
      body: "{",
      headers: { "content-type": "application/json" },
    })

    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe("Malformed JSON body")
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it("returns 403 when setup secret is invalid in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("SETUP_SECRET", "correct-secret")

    const { POST } = await import("../app/api/auth/setup/route")
    const req = new NextRequest("http://localhost/api/auth/setup", {
      method: "POST",
      body: JSON.stringify({
        username: "admin",
        password: "supersecure",
        setupSecret: "wrong-secret",
      }),
      headers: { "content-type": "application/json" },
    })

    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toBe("Invalid setup secret")
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })
})
