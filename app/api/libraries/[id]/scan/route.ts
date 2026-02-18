import { NextRequest, NextResponse } from "next/server"
import prisma from "../../../../../lib/prisma"
import { enqueueLibraryScan, isLibraryScanActive } from "../../../../../lib/libraryScanQueue"
import { runLibraryScan } from "../../../../../lib/libraryScanner"
import { AuthError, requireAdmin, requireAuth } from "../../../../../lib/requireAuth"
import { validateLibraryPath } from "../../../../../lib/libraryPaths"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request)
    requireAdmin(auth)
    const { id } = await params
    const libraryId = Number.parseInt(id, 10)
    if (!Number.isInteger(libraryId) || libraryId <= 0) {
      return NextResponse.json({ error: "Invalid library id" }, { status: 400 })
    }

    const library = await prisma.library.findFirst({
      where: { id: libraryId, userId: auth.userId },
      select: { id: true, paths: { where: { enabled: true }, select: { path: true } } },
    })
    if (!library) {
      return NextResponse.json({ error: "Library not found" }, { status: 404 })
    }
    for (const libraryPath of library.paths) {
      const validated = await validateLibraryPath(libraryPath.path)
      if (!validated.ok) {
        return NextResponse.json(
          { error: `Library path '${libraryPath.path}' is invalid: ${validated.error}` },
          { status: 400 }
        )
      }
    }

    const mode = request.nextUrl.searchParams.get("mode") || "async"
    if (mode === "sync") {
      const stats = await runLibraryScan(auth.userId, libraryId)
      return NextResponse.json({ success: true, mode: "sync", stats })
    }

    if (await isLibraryScanActive(auth.userId, libraryId)) {
      return NextResponse.json(
        { error: "A scan is already running for this library." },
        { status: 409 }
      )
    }

    const queued = await enqueueLibraryScan(auth.userId, libraryId)
    if (!queued.accepted) {
      return NextResponse.json({ error: queued.reason || "Could not queue scan" }, { status: 409 })
    }

    return NextResponse.json(
      {
        success: true,
        mode: "async",
        scanRunId: queued.scanRunId,
        status: "queued",
      },
      { status: 202 }
    )
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const message = error instanceof Error ? error.message : "Failed to scan library"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
