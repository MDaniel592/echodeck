import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const requireAuthMock = vi.hoisted(() => vi.fn())
const requireAdminMock = vi.hoisted(() => vi.fn())
const validateLibraryPathMock = vi.hoisted(() => vi.fn())
const enqueueLibraryScanMock = vi.hoisted(() => vi.fn())
const isLibraryScanActiveMock = vi.hoisted(() => vi.fn())
const runLibraryScanMock = vi.hoisted(() => vi.fn())

const prismaMock = vi.hoisted(() => ({
  library: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
  libraryPath: {
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  },
  $transaction: vi.fn(),
}))

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

vi.mock("../lib/libraryPaths", () => ({
  validateLibraryPath: validateLibraryPathMock,
}))

vi.mock("../lib/libraryScanQueue", () => ({
  enqueueLibraryScan: enqueueLibraryScanMock,
  isLibraryScanActive: isLibraryScanActiveMock,
}))

vi.mock("../lib/libraryScanner", () => ({
  runLibraryScan: runLibraryScanMock,
}))

describe("library routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireAuthMock.mockResolvedValue({ userId: 1, role: "admin", username: "admin" })
    requireAdminMock.mockImplementation(() => {})
    validateLibraryPathMock.mockResolvedValue({ ok: true, normalizedPath: "/downloads/music" })
    prismaMock.library.create.mockResolvedValue({ id: 1, name: "Music", paths: [] })
    prismaMock.library.findFirst.mockResolvedValue({ id: 1, paths: [] })
    prismaMock.library.findUnique.mockResolvedValue({ id: 1, paths: [] })
    prismaMock.$transaction.mockImplementation(async (cb: (tx: typeof prismaMock) => Promise<unknown>) => cb(prismaMock))
    enqueueLibraryScanMock.mockResolvedValue({ accepted: true, scanRunId: 5 })
    isLibraryScanActiveMock.mockResolvedValue(false)
    runLibraryScanMock.mockResolvedValue({ scannedFiles: 0, createdSongs: 0, updatedSongs: 0, skippedSongs: 0, errors: 0 })
  })

  it("POST /api/libraries requires admin", async () => {
    const { AuthError } = await import("../lib/requireAuth")
    requireAdminMock.mockImplementation(() => {
      throw new AuthError("Forbidden", 403)
    })

    const { POST } = await import("../app/api/libraries/route")
    const req = new NextRequest("http://localhost/api/libraries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Music", path: "/downloads/music" }),
    })
    const res = await POST(req)

    expect(res.status).toBe(403)
    expect(prismaMock.library.create).not.toHaveBeenCalled()
  })

  it("POST /api/libraries validates the initial library path", async () => {
    validateLibraryPathMock.mockResolvedValue({ ok: false, error: "Path does not exist" })

    const { POST } = await import("../app/api/libraries/route")
    const req = new NextRequest("http://localhost/api/libraries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Music", path: "/does/not/exist" }),
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe("Path does not exist")
    expect(prismaMock.library.create).not.toHaveBeenCalled()
  })

  it("PATCH /api/libraries/[id]/paths rejects invalid paths", async () => {
    validateLibraryPathMock
      .mockResolvedValueOnce({ ok: true, normalizedPath: "/downloads/music" })
      .mockResolvedValueOnce({ ok: false, error: "Path is outside allowed library roots" })

    const { PATCH } = await import("../app/api/libraries/[id]/paths/route")
    const req = new NextRequest("http://localhost/api/libraries/1/paths", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paths: ["/downloads/music", "/etc"] }),
    })
    const res = await PATCH(req, { params: Promise.resolve({ id: "1" }) })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain("outside allowed library roots")
  })

  it("POST /api/libraries/[id]/scan rejects invalid configured paths", async () => {
    prismaMock.library.findFirst.mockResolvedValue({
      id: 1,
      paths: [{ path: "/etc" }],
    })
    validateLibraryPathMock.mockResolvedValue({ ok: false, error: "Path is outside allowed library roots" })

    const { POST } = await import("../app/api/libraries/[id]/scan/route")
    const req = new NextRequest("http://localhost/api/libraries/1/scan", { method: "POST" })
    const res = await POST(req, { params: Promise.resolve({ id: "1" }) })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain("invalid")
    expect(enqueueLibraryScanMock).not.toHaveBeenCalled()
  })
})
