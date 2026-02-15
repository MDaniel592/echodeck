import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const requireAuthMock = vi.hoisted(() => vi.fn())
const requireAdminMock = vi.hoisted(() => vi.fn())
const runMaintenanceActionMock = vi.hoisted(() => vi.fn())

vi.mock("../lib/requireAuth", async () => {
  const actual = await vi.importActual("../lib/requireAuth")
  return {
    ...(actual as object),
    requireAuth: requireAuthMock,
    requireAdmin: requireAdminMock,
  }
})

vi.mock("../lib/adminMaintenance", async () => {
  const actual = await vi.importActual("../lib/adminMaintenance")
  return {
    ...(actual as object),
    runMaintenanceAction: runMaintenanceActionMock,
  }
})

describe("admin maintenance fix route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireAuthMock.mockResolvedValue({ userId: 1, role: "admin", username: "admin" })
    requireAdminMock.mockImplementation(() => {})
  })

  it("returns JSON result when stream=false", async () => {
    runMaintenanceActionMock.mockResolvedValue({
      action: "normalize_titles",
      dryRun: true,
      details: { candidateSongs: 3, updatedSongs: 3 },
    })

    const { POST } = await import("../app/api/admin/maintenance/fix/route")
    const req = new NextRequest("http://localhost/api/admin/maintenance/fix", {
      method: "POST",
      body: JSON.stringify({
        action: "normalize_titles",
        dryRun: true,
      }),
      headers: { "content-type": "application/json" },
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(runMaintenanceActionMock).toHaveBeenCalledWith(1, "normalize_titles", true)
    expect(body).toEqual({
      action: "normalize_titles",
      dryRun: true,
      details: { candidateSongs: 3, updatedSongs: 3 },
    })
  })

  it("streams progress and final result when stream=true", async () => {
    runMaintenanceActionMock.mockImplementation(async (_userId, action, dryRun, onProgress) => {
      onProgress?.({
        action,
        dryRun,
        phase: "scan",
        processed: 1,
        total: 2,
        message: "Scanning",
      })
      onProgress?.({
        action,
        dryRun,
        phase: "apply",
        processed: 2,
        total: 2,
        message: "Applying",
      })
      return {
        action,
        dryRun,
        details: { checkedSongs: 2, updatedSongs: 2 },
      }
    })

    const { POST } = await import("../app/api/admin/maintenance/fix/route")
    const req = new NextRequest("http://localhost/api/admin/maintenance/fix", {
      method: "POST",
      body: JSON.stringify({
        action: "refresh_origin_metadata",
        dryRun: true,
        stream: true,
      }),
      headers: { "content-type": "application/json" },
    })
    const res = await POST(req)
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("application/x-ndjson")
    const lines = text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; event?: { processed?: number }; result?: { action: string } })

    expect(lines[0]?.type).toBe("started")
    expect(lines.some((line) => line.type === "progress" && line.event?.processed === 1)).toBe(true)
    expect(lines.some((line) => line.type === "progress" && line.event?.processed === 2)).toBe(true)
    expect(lines[lines.length - 1]?.type).toBe("result")
    expect(lines[lines.length - 1]?.result?.action).toBe("refresh_origin_metadata")
  })

  it("returns 400 for invalid action", async () => {
    const { POST } = await import("../app/api/admin/maintenance/fix/route")
    const req = new NextRequest("http://localhost/api/admin/maintenance/fix", {
      method: "POST",
      body: JSON.stringify({
        action: "not_real_action",
        dryRun: true,
      }),
      headers: { "content-type": "application/json" },
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe("Invalid action")
    expect(runMaintenanceActionMock).not.toHaveBeenCalled()
  })

  it("streams error event when maintenance action throws", async () => {
    runMaintenanceActionMock.mockRejectedValue(new Error("boom"))

    const { POST } = await import("../app/api/admin/maintenance/fix/route")
    const req = new NextRequest("http://localhost/api/admin/maintenance/fix", {
      method: "POST",
      body: JSON.stringify({
        action: "refresh_origin_metadata",
        dryRun: true,
        stream: true,
      }),
      headers: { "content-type": "application/json" },
    })
    const res = await POST(req)
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("application/x-ndjson")

    const lines = text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; error?: string })

    expect(lines[0]?.type).toBe("started")
    expect(lines[lines.length - 1]?.type).toBe("error")
    expect(lines[lines.length - 1]?.error).toBe("boom")
  })
})
