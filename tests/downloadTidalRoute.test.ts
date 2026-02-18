import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const requireAuthMock = vi.hoisted(() => vi.fn())
const enqueueDownloadTaskMock = vi.hoisted(() => vi.fn())
const startDownloadTaskWorkerMock = vi.hoisted(() => vi.fn())
const appendTaskEventMock = vi.hoisted(() => vi.fn())
const resolveTaskPlaylistSelectionMock = vi.hoisted(() => vi.fn())

vi.mock("../lib/requireAuth", async () => {
  const actual = await vi.importActual("../lib/requireAuth")
  return {
    ...(actual as object),
    requireAuth: requireAuthMock,
  }
})

vi.mock("../lib/prisma", () => ({
  default: {
    downloadTask: {
      update: vi.fn(),
    },
  },
}))

vi.mock("../lib/downloadTasks", async () => {
  const actual = await vi.importActual("../lib/downloadTasks")
  return {
    ...(actual as object),
    appendTaskEvent: appendTaskEventMock,
    enqueueDownloadTask: enqueueDownloadTaskMock,
    startDownloadTaskWorker: startDownloadTaskWorkerMock,
    resolveTaskPlaylistSelection: resolveTaskPlaylistSelectionMock,
  }
})

describe("download tidal route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireAuthMock.mockResolvedValue({ userId: 7, role: "user", username: "u" })
    resolveTaskPlaylistSelectionMock.mockResolvedValue({ playlistId: null, playlistName: null, created: false })
    enqueueDownloadTaskMock.mockResolvedValue({ id: 12, status: "queued" })
    startDownloadTaskWorkerMock.mockResolvedValue(true)
  })

  it("queues tidal task", async () => {
    const { POST } = await import("../app/api/download/tidal/route")
    const req = new NextRequest("http://localhost/api/download/tidal", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://listen.tidal.com/track/123", quality: "best", format: "mp3" }),
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(202)
    expect(enqueueDownloadTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({ source: "tidal" })
    )
    expect(body.task.id).toBe(12)
  })
})
