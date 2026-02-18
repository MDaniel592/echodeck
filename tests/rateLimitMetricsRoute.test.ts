import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const requireAuthMock = vi.hoisted(() => vi.fn())
const requireAdminMock = vi.hoisted(() => vi.fn())
const getRateLimitMetricsMock = vi.hoisted(() => vi.fn())
const resetRateLimitMetricsMock = vi.hoisted(() => vi.fn())

vi.mock("../lib/requireAuth", async () => {
  const actual = await vi.importActual("../lib/requireAuth")
  return {
    ...(actual as object),
    requireAuth: requireAuthMock,
    requireAdmin: requireAdminMock,
  }
})

vi.mock("../lib/rateLimit", async () => {
  const actual = await vi.importActual("../lib/rateLimit")
  return {
    ...(actual as object),
    getRateLimitMetrics: getRateLimitMetricsMock,
    resetRateLimitMetrics: resetRateLimitMetricsMock,
  }
})

describe("admin rate-limit metrics route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireAuthMock.mockResolvedValue({ userId: 1, role: "admin", username: "admin" })
    requireAdminMock.mockImplementation(() => {})
    getRateLimitMetricsMock.mockReturnValue({
      startedAt: "2026-01-01T00:00:00.000Z",
      backend: "memory",
      bucketMs: 1000,
      fallbackToMemoryCount: 0,
      keysTracked: 1,
      totals: { total: 1, allowed: 1, blocked: 0 },
      byPrefix: [{ prefix: "login:client", total: 1, allowed: 1, blocked: 0, fallbackToMemory: 0, lastSeenAt: "2026-01-01T00:00:00.000Z" }],
    })
  })

  it("returns metrics for admins", async () => {
    const { GET } = await import("../app/api/admin/rate-limit/metrics/route")
    const req = new NextRequest("http://localhost/api/admin/rate-limit/metrics?limit=10")
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(getRateLimitMetricsMock).toHaveBeenCalledWith(10)
    expect(body.totals.total).toBe(1)
  })

  it("resets metrics when reset=true", async () => {
    const { POST } = await import("../app/api/admin/rate-limit/metrics/route")
    const req = new NextRequest("http://localhost/api/admin/rate-limit/metrics", {
      method: "POST",
      body: JSON.stringify({ reset: true }),
      headers: { "content-type": "application/json" },
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(resetRateLimitMetricsMock).toHaveBeenCalled()
    expect(body).toEqual({ success: true, reset: true })
  })

  it("rejects invalid reset payload", async () => {
    const { POST } = await import("../app/api/admin/rate-limit/metrics/route")
    const req = new NextRequest("http://localhost/api/admin/rate-limit/metrics", {
      method: "POST",
      body: JSON.stringify({ reset: false }),
      headers: { "content-type": "application/json" },
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(resetRateLimitMetricsMock).not.toHaveBeenCalled()
    expect(body.error).toBe("Invalid request body")
  })
})
