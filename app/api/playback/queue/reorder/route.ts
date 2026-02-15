import { NextRequest, NextResponse } from "next/server"
import prisma from "../../../../../lib/prisma"
import { AuthError, requireAuth } from "../../../../../lib/requireAuth"

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request)
    const body = await request.json()
    const deviceId = typeof body?.deviceId === "string" ? body.deviceId.trim() : ""
    if (!deviceId) {
      return NextResponse.json({ error: "deviceId is required" }, { status: 400 })
    }

    const fromIndex = Number.parseInt(String(body?.fromIndex), 10)
    const toIndex = Number.parseInt(String(body?.toIndex), 10)
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || fromIndex < 0 || toIndex < 0) {
      return NextResponse.json({ error: "Invalid fromIndex/toIndex" }, { status: 400 })
    }

    const session = await prisma.playbackSession.findUnique({
      where: {
        userId_deviceId: {
          userId: auth.userId,
          deviceId,
        },
      },
      select: { id: true },
    })
    if (!session) {
      return NextResponse.json({ error: "Playback session not found" }, { status: 404 })
    }

    const items = await prisma.playbackQueueItem.findMany({
      where: { sessionId: session.id },
      orderBy: { sortOrder: "asc" },
      select: { id: true, songId: true },
    })

    if (fromIndex >= items.length || toIndex >= items.length) {
      return NextResponse.json({ error: "Queue index out of range" }, { status: 400 })
    }
    if (fromIndex === toIndex) {
      return NextResponse.json({ success: true, length: items.length })
    }

    const reordered = [...items]
    const [moved] = reordered.splice(fromIndex, 1)
    reordered.splice(toIndex, 0, moved)

    await prisma.$transaction(async (tx) => {
      // Avoid transient unique collisions on @@unique([sessionId, sortOrder]) by
      // staging all rows to a non-overlapping temporary range first.
      const tempOffset = reordered.length + 1

      for (const [index, item] of reordered.entries()) {
        await tx.playbackQueueItem.update({
          where: { id: item.id },
          data: { sortOrder: index + tempOffset },
        })
      }

      for (const [index, item] of reordered.entries()) {
        await tx.playbackQueueItem.update({
          where: { id: item.id },
          data: { sortOrder: index },
        })
      }
    })

    return NextResponse.json({ success: true, length: reordered.length })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Failed to reorder playback queue:", error)
    return NextResponse.json({ error: "Failed to reorder playback queue" }, { status: 500 })
  }
}
