import { NextRequest, NextResponse } from "next/server"
import prisma from "../../../../lib/prisma"
import { AuthError, requireAuth } from "../../../../lib/requireAuth"

async function resolveTag(userId: number, idRaw: string) {
  const id = Number.parseInt(idRaw, 10)
  if (!Number.isInteger(id) || id <= 0) return null
  return prisma.songTag.findFirst({ where: { id, userId } })
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(request)
    const { id } = await context.params
    const tag = await resolveTag(auth.userId, id)
    if (!tag) {
      return NextResponse.json({ error: "Tag not found" }, { status: 404 })
    }

    const body = await request.json().catch(() => ({}))
    const name = typeof body?.name === "string" ? body.name.trim() : ""
    const color = typeof body?.color === "string" ? body.color.trim() : null

    const updateData: Record<string, string | null> = {}

    if (body && Object.prototype.hasOwnProperty.call(body, "name")) {
      if (!name) {
        return NextResponse.json({ error: "Tag name is required" }, { status: 400 })
      }
      if (name.length > 50) {
        return NextResponse.json({ error: "Tag name is too long" }, { status: 400 })
      }
      updateData.name = name
    }

    if (body && Object.prototype.hasOwnProperty.call(body, "color")) {
      updateData.color = color || null
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "No changes requested" }, { status: 400 })
    }

    const updated = await prisma.songTag.update({
      where: { id: tag.id },
      data: updateData,
      include: {
        _count: {
          select: { songs: true },
        },
      },
    })

    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: "Tag already exists" }, { status: 409 })
    }
    console.error("Error updating tag:", error)
    return NextResponse.json({ error: "Failed to update tag" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(request)
    const { id } = await context.params
    const tag = await resolveTag(auth.userId, id)
    if (!tag) {
      return NextResponse.json({ error: "Tag not found" }, { status: 404 })
    }

    await prisma.songTag.delete({ where: { id: tag.id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Error deleting tag:", error)
    return NextResponse.json({ error: "Failed to delete tag" }, { status: 500 })
  }
}
