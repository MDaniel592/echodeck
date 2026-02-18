import { describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { proxy } from "../proxy"

vi.mock("../lib/auth", () => ({
  verifyToken: vi.fn(() => null),
}))

describe("proxy csrf guard", () => {
  it("blocks cross-origin api mutations", async () => {
    const request = new NextRequest("http://localhost/api/songs", {
      method: "POST",
      headers: {
        origin: "http://evil.example",
      },
    })

    const response = proxy(request)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error).toBe("Forbidden")
  })

  it("allows same-origin api mutations to continue auth flow", () => {
    const request = new NextRequest("http://localhost/api/songs", {
      method: "POST",
      headers: {
        origin: "http://localhost",
      },
    })

    const response = proxy(request)

    expect(response.status).toBe(401)
  })

  it("does not apply csrf guard to subsonic api", () => {
    const request = new NextRequest("http://localhost/api/subsonic/rest", {
      method: "POST",
      headers: {
        origin: "http://evil.example",
      },
    })

    const response = proxy(request)

    expect(response.status).toBe(200)
    expect(response.headers.get("x-middleware-next")).toBe("1")
  })
})
