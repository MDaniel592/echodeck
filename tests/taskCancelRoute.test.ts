import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const prismaMock = vi.hoisted(() => ({
  downloadTask: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
}))

const requireAuthMock = vi.hoisted(() => vi.fn())
const appendTaskEventMock = vi.hoisted(() => vi.fn())
const drainQueuedTaskWorkersMock = vi.hoisted(() => vi.fn())

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

vi.mock("../lib/downloadTasks", () => ({
  appendTaskEvent: appendTaskEventMock,
  drainQueuedTaskWorkers: drainQueuedTaskWorkersMock,
}))

describe("tasks/:id/cancel route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireAuthMock.mockResolvedValue({ userId: 7, role: "user", username: "u" })
    appendTaskEventMock.mockResolvedValue(undefined)
    drainQueuedTaskWorkersMock.mockResolvedValue(0)
    prismaMock.downloadTask.updateMany.mockResolvedValue({ count: 1 })
  })

  it("returns 400 for invalid task id", async () => {
    const { POST } = await import("../app/api/tasks/[id]/cancel/route")
    const req = new NextRequest("http://localhost/api/tasks/bad/cancel", { method: "POST" })
    const res = await POST(req, { params: Promise.resolve({ id: "bad" }) })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe("Invalid task ID")
  })

  it("returns 409 for non-cancellable status", async () => {
    prismaMock.downloadTask.findFirst.mockResolvedValue({
      id: 12,
      status: "completed",
      workerPid: null,
      heartbeatAt: null,
    })

    const { POST } = await import("../app/api/tasks/[id]/cancel/route")
    const req = new NextRequest("http://localhost/api/tasks/12/cancel", { method: "POST" })
    const res = await POST(req, { params: Promise.resolve({ id: "12" }) })
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.error).toContain("Only queued or running tasks can be cancelled")
    expect(prismaMock.downloadTask.updateMany).not.toHaveBeenCalled()
  })

  it("cancels running task and appends event", async () => {
    prismaMock.downloadTask.findFirst.mockResolvedValue({
      id: 12,
      status: "running",
      workerPid: null,
      heartbeatAt: new Date(),
    })

    const { POST } = await import("../app/api/tasks/[id]/cancel/route")
    const req = new NextRequest("http://localhost/api/tasks/12/cancel", { method: "POST" })
    const res = await POST(req, { params: Promise.resolve({ id: "12" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ success: true })
    expect(prismaMock.downloadTask.updateMany).toHaveBeenCalledWith({
      where: {
        id: 12,
        userId: 7,
        status: { in: ["queued", "running"] },
      },
      data: expect.objectContaining({
        status: "failed",
        errorMessage: "Cancelled by user.",
        workerPid: null,
      }),
    })
    expect(appendTaskEventMock).toHaveBeenCalledWith(7, 12, "status", "Task cancelled by user.")
    expect(drainQueuedTaskWorkersMock).toHaveBeenCalled()
  })

  it("tries to terminate worker even when heartbeat is stale", async () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true)
    prismaMock.downloadTask.findFirst.mockResolvedValue({
      id: 12,
      status: "running",
      workerPid: 4321,
      heartbeatAt: new Date(Date.now() - 60 * 60 * 1000),
    })

    try {
      const { POST } = await import("../app/api/tasks/[id]/cancel/route")
      const req = new NextRequest("http://localhost/api/tasks/12/cancel", { method: "POST" })
      const res = await POST(req, { params: Promise.resolve({ id: "12" }) })

      expect(res.status).toBe(200)
      expect(killSpy).toHaveBeenCalledWith(4321, "SIGTERM")
    } finally {
      killSpy.mockRestore()
    }
  })
})
