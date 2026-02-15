import { NextRequest, NextResponse } from "next/server"
import prisma from "../../../../../lib/prisma"
import { isLibraryScanActive } from "../../../../../lib/libraryScanQueue"
import { AuthError, requireAuth } from "../../../../../lib/requireAuth"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request)
    const { id } = await params
    const libraryId = Number.parseInt(id, 10)
    if (!Number.isInteger(libraryId) || libraryId <= 0) {
      return NextResponse.json({ error: "Invalid library id" }, { status: 400 })
    }

    const library = await prisma.library.findFirst({
      where: { id: libraryId, userId: auth.userId },
      select: { id: true },
    })
    if (!library) {
      return NextResponse.json({ error: "Library not found" }, { status: 404 })
    }

    const scans = await prisma.libraryScanRun.findMany({
      where: { libraryId },
      orderBy: { startedAt: "desc" },
      take: 50,
    })
    return NextResponse.json({
      active: await isLibraryScanActive(auth.userId, libraryId),
      scans,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Failed to fetch library scans:", error)
    return NextResponse.json({ error: "Failed to fetch library scans" }, { status: 500 })
  }
}
