import { NextRequest, NextResponse } from "next/server"
import fs from "fs/promises"
import prisma from "../../../../lib/prisma"
import { AuthError, requireAuth } from "../../../../lib/requireAuth"
import {
  assignSongsToPlaylistForUser,
  parsePlaylistId,
  PlaylistServiceError,
} from "../../../../lib/services.playlist"
import { getSafeDeletePathsForRemovedSongs } from "../../../../lib/songFiles"

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
    const playlistId = parsePlaylistId(body?.playlistId)
    const result = await assignSongsToPlaylistForUser(auth.userId, ids, playlistId)
    return NextResponse.json({ success: true, updatedIds: result.updatedIds, playlistId: result.playlistId })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof PlaylistServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
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

    try {
      const safeDeletePaths = await getSafeDeletePathsForRemovedSongs(songs)
      await Promise.allSettled(
        safeDeletePaths.map(async (filePath) => {
          await fs.unlink(filePath).catch(() => {})
        })
      )
    } catch (err) {
      console.error("Failed to finalize bulk file deletion:", err)
    }

    return NextResponse.json({ success: true, deletedIds: ids })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Failed bulk song delete:", error)
    return NextResponse.json({ error: "Failed to delete songs" }, { status: 500 })
  }
}
