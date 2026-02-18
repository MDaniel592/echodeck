import { describe, expect, it, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import { getClientIdentifier } from "../lib/clientIdentity"

describe("getClientIdentifier", () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  it("uses trusted proxy ip material when TRUST_PROXY=1", () => {
    vi.stubEnv("TRUST_PROXY", "1")
    const req = new NextRequest("http://localhost/api/auth/login", {
      headers: {
        "x-forwarded-for": "203.0.113.5, 10.0.0.4",
      },
    })

    const id = getClientIdentifier(req, "login")
    expect(id.startsWith("login:")).toBe(true)
    expect(id).not.toContain("203.0.113.5")
  })

  it("falls back to request fingerprint when proxy is disabled", () => {
    vi.stubEnv("TRUST_PROXY", "0")
    const req = new NextRequest("http://localhost/api/auth/login", {
      headers: {
        "user-agent": "test-agent",
        "accept-language": "es-MX",
      },
    })

    const id = getClientIdentifier(req, "login")
    expect(id.startsWith("login:")).toBe(true)
    expect(id).not.toContain("test-agent")
  })

  it("returns stable output for same request", () => {
    vi.stubEnv("TRUST_PROXY", "1")
    const req = new NextRequest("http://localhost/api/subsonic/rest", {
      headers: {
        "x-real-ip": "198.51.100.40",
      },
    })

    const first = getClientIdentifier(req, "subsonic")
    const second = getClientIdentifier(req, "subsonic")
    expect(first).toBe(second)
  })
})
