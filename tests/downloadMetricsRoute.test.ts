import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const requireAuthMock = vi.hoisted(() => vi.fn())
const requireAdminMock = vi.hoisted(() => vi.fn())
const prismaMock = vi.hoisted(() => ({
  downloadTask: {
    findMany: vi.fn(),
  },
}))

vi.mock("../lib/requireAuth", async () => {
  const actual = await vi.importActual("../lib/requireAuth")
  return {
    ...(actual as object),
    requireAuth: requireAuthMock,
    requireAdmin: requireAdminMock,
  }
})

vi.mock("../lib/prisma", () => ({
  default: prismaMock,
}))

describe("admin download metrics route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireAuthMock.mockResolvedValue({ userId: 1, role: "admin", username: "admin" })
    requireAdminMock.mockImplementation(() => {})
    prismaMock.downloadTask.findMany.mockResolvedValue([
      {
        source: "youtube",
        status: "completed",
        startedAt: new Date("2026-02-18T00:00:00.000Z"),
        completedAt: new Date("2026-02-18T00:01:00.000Z"),
        workerPid: 111,
        heartbeatAt: new Date("2026-02-18T00:00:30.000Z"),
      },
      {
        source: "youtube",
        status: "failed",
        startedAt: new Date("2026-02-18T01:00:00.000Z"),
        completedAt: new Date("2026-02-18T01:00:30.000Z"),
        workerPid: null,
        heartbeatAt: null,
      },
      {
        source: "spotify",
        status: "running",
        startedAt: new Date("2026-02-18T02:00:00.000Z"),
        completedAt: null,
        workerPid: 222,
        heartbeatAt: new Date(),
      },
    ])
  })

  it("returns provider and worker metrics", async () => {
    const { GET } = await import("../app/api/admin/download/metrics/route")
    const req = new NextRequest("http://localhost/api/admin/download/metrics?windowHours=12")
    const res = await GET(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(prismaMock.downloadTask.findMany).toHaveBeenCalled()
    expect(body.windowHours).toBe(12)
    expect(body.totals.tasks).toBe(3)
    expect(body.providers[0].source).toBe("youtube")
  })
})
