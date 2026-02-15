import { NextRequest, NextResponse } from "next/server"
import prisma from "../../../../../lib/prisma"
import { AuthError, requireAuth } from "../../../../../lib/requireAuth"

export async function PATCH(
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

    const body = await request.json()
    if (!Array.isArray(body?.paths)) {
      return NextResponse.json({ error: "paths array is required" }, { status: 400 })
    }

    const cleanPaths = body.paths
      .map((value: unknown) => (typeof value === "string" ? value.trim() : ""))
      .filter((value: string) => value.length > 0)
    const unique: string[] = Array.from(new Set(cleanPaths))

    await prisma.$transaction(async (tx) => {
      await tx.libraryPath.deleteMany({ where: { libraryId } })
      if (unique.length > 0) {
        await tx.libraryPath.createMany({
          data: unique.map((p) => ({
            libraryId,
            path: p,
            enabled: true,
          })),
        })
      }
    })

    const updated = await prisma.library.findUnique({
      where: { id: libraryId },
      include: { paths: true },
    })
    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Failed to update library paths:", error)
    return NextResponse.json({ error: "Failed to update library paths" }, { status: 500 })
  }
}
