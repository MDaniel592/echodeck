import { NextRequest, NextResponse } from "next/server"
import prisma from "../../../../lib/prisma"
import { AuthError, requireAuth } from "../../../../lib/requireAuth"

export async function PUT(request: NextRequest) {
  try {
    const auth = await requireAuth(request)
    const body = await request.json()
    const deviceId = typeof body?.deviceId === "string" ? body.deviceId.trim() : ""
    if (!deviceId) {
      return NextResponse.json({ error: "deviceId is required" }, { status: 400 })
    }

    if (!Array.isArray(body?.songIds)) {
      return NextResponse.json({ error: "songIds must be an array" }, { status: 400 })
    }

    const songIds: number[] = body.songIds
      .map((value: unknown) => Number.parseInt(String(value), 10))
      .filter((id: number): id is number => Number.isInteger(id) && id > 0)

    const uniqueSongIds = Array.from(new Set(songIds))
    if (uniqueSongIds.length !== songIds.length) {
      return NextResponse.json({ error: "songIds must not contain duplicates" }, { status: 400 })
    }

    const songs = await prisma.song.findMany({
      where: {
        id: { in: uniqueSongIds },
        userId: auth.userId,
      },
      select: { id: true },
    })
    if (songs.length !== uniqueSongIds.length) {
      return NextResponse.json({ error: "One or more songs were not found" }, { status: 404 })
    }

    const session = await prisma.$transaction(async (tx) => {
      const upserted = await tx.playbackSession.upsert({
        where: {
          userId_deviceId: {
            userId: auth.userId,
            deviceId,
          },
        },
        create: {
          userId: auth.userId,
          deviceId,
        },
        update: {},
        select: {
          id: true,
          queueItems: {
            orderBy: { sortOrder: "asc" },
            select: { songId: true },
          },
        },
      })

      const existingSongIds = upserted.queueItems.map((item) => item.songId)
      const unchanged =
        existingSongIds.length === songIds.length &&
        existingSongIds.every((songId, index) => songId === songIds[index])
      if (unchanged) {
        return { id: upserted.id, unchanged: true as const }
      }

      await tx.playbackQueueItem.deleteMany({
        where: { sessionId: upserted.id },
      })

      if (songIds.length > 0) {
        await tx.playbackQueueItem.createMany({
          data: songIds.map((songId: number, index: number) => ({
            sessionId: upserted.id,
            songId,
            sortOrder: index,
          })),
        })
      }

      return { id: upserted.id, unchanged: false as const }
    })

    if (session.unchanged) {
      return NextResponse.json({
        success: true,
        sessionId: session.id,
        length: songIds.length,
        unchanged: true,
      })
    }

    return NextResponse.json({ success: true, sessionId: session.id, length: songIds.length })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Failed to update playback queue:", error)
    return NextResponse.json({ error: "Failed to update playback queue" }, { status: 500 })
  }
}
