import { NextRequest, NextResponse } from "next/server"
import prisma from "../../../../../lib/prisma"
import { AuthError, requireAdmin, requireAuth } from "../../../../../lib/requireAuth"
import { validateLibraryPath } from "../../../../../lib/libraryPaths"

export async function PATCH(
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
      select: { id: true },
    })
    if (!library) {
      return NextResponse.json({ error: "Library not found" }, { status: 404 })
    }

    const body = await request.json()
    if (!Array.isArray(body?.paths)) {
      return NextResponse.json({ error: "paths array is required" }, { status: 400 })
    }

    const cleanPaths: string[] = body.paths
      .map((value: unknown): string => (typeof value === "string" ? value.trim() : ""))
      .filter((value: string): boolean => value.length > 0)
    const validatedPaths = await Promise.all(
      cleanPaths.map(async (libraryPath: string) => ({
        input: libraryPath,
        result: await validateLibraryPath(libraryPath),
      }))
    )
    const invalid = validatedPaths.find((entry) => !entry.result.ok)
    if (invalid && !invalid.result.ok) {
      return NextResponse.json(
        { error: `Invalid library path '${invalid.input}': ${invalid.result.error}` },
        { status: 400 }
      )
    }

    const unique: string[] = Array.from(
      new Set(validatedPaths.map((entry) => (entry.result.ok ? entry.result.normalizedPath : "")))
    ).filter((entry) => entry.length > 0)

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
