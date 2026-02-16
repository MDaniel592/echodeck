import { NextRequest, NextResponse } from "next/server"
import fs from "fs/promises"
import prisma from "../../../../lib/prisma"
import { AuthError, requireAuth } from "../../../../lib/requireAuth"
import { resolveSafeDownloadPathForDelete } from "../../../../lib/downloadPaths"

function parseSongIds(input: unknown): number[] {
  if (!Array.isArray(input)) return []
  const parsed = input
    .map((value) => Number.parseInt(String(value), 10))
    .filter((id): id is number => Number.isInteger(id) && id > 0)
  return Array.from(new Set(parsed))
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireAuth(request)
    const body = await request.json().catch(() => ({}))
    const ids = parseSongIds(body?.ids)
    if (ids.length === 0) {
      return NextResponse.json({ error: "ids must be a non-empty array of song IDs" }, { status: 400 })
    }

    const incomingPlaylistId = body?.playlistId
    const playlistId =
      incomingPlaylistId === null || incomingPlaylistId === undefined || incomingPlaylistId === ""
        ? null
        : Number.parseInt(String(incomingPlaylistId), 10)
    if (playlistId !== null && (!Number.isInteger(playlistId) || playlistId <= 0)) {
      return NextResponse.json({ error: "Invalid playlist ID" }, { status: 400 })
    }

    const songs = await prisma.song.findMany({
      where: { userId: auth.userId, id: { in: ids } },
      select: { id: true },
    })
    if (songs.length !== ids.length) {
      return NextResponse.json({ error: "One or more songs were not found" }, { status: 404 })
    }

    await prisma.$transaction(async (tx) => {
      if (playlistId !== null) {
        const playlist = await tx.playlist.findFirst({
          where: { id: playlistId, userId: auth.userId },
          select: { id: true },
        })
        if (!playlist) {
          throw new Error("Playlist not found")
        }
      }

      await tx.song.updateMany({
        where: { userId: auth.userId, id: { in: ids } },
        data: { playlistId },
      })

      await tx.playlistSong.deleteMany({
        where: { songId: { in: ids } },
      })

      if (playlistId === null) return

      const maxPosition = await tx.playlistSong.aggregate({
        where: { playlistId },
        _max: { position: true },
      })
      const start = (maxPosition._max.position ?? -1) + 1
      await tx.playlistSong.createMany({
        data: ids.map((songId, index) => ({
          playlistId,
          songId,
          position: start + index,
        })),
      })
    })

    return NextResponse.json({ success: true, updatedIds: ids, playlistId })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof Error && error.message === "Playlist not found") {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    console.error("Failed bulk song update:", error)
    return NextResponse.json({ error: "Failed to update songs" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAuth(request)
    const body = await request.json().catch(() => ({}))
    const ids = parseSongIds(body?.ids)
    if (ids.length === 0) {
      return NextResponse.json({ error: "ids must be a non-empty array of song IDs" }, { status: 400 })
    }

    const songs = await prisma.song.findMany({
      where: { userId: auth.userId, id: { in: ids } },
      select: { id: true, filePath: true, coverPath: true },
    })
    if (songs.length !== ids.length) {
      return NextResponse.json({ error: "One or more songs were not found" }, { status: 404 })
    }

    await prisma.song.deleteMany({
      where: { userId: auth.userId, id: { in: ids } },
    })

    const deletionCandidates = new Set<string>()
    for (const song of songs) {
      const safeSongPath = resolveSafeDownloadPathForDelete(song.filePath)
      if (safeSongPath) deletionCandidates.add(safeSongPath)
      if (song.coverPath) {
        const safeCoverPath = resolveSafeDownloadPathForDelete(song.coverPath)
        if (safeCoverPath) deletionCandidates.add(safeCoverPath)
      }
    }

    await Promise.allSettled(
      Array.from(deletionCandidates).map(async (filePath) => {
        await fs.unlink(filePath).catch(() => {})
      })
    )

    return NextResponse.json({ success: true, deletedIds: ids })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Failed bulk song delete:", error)
    return NextResponse.json({ error: "Failed to delete songs" }, { status: 500 })
  }
}
