import { NextRequest, NextResponse } from "next/server"
import prisma from "../../../../lib/prisma"
import { sanitizeSong } from "../../../../lib/sanitize"
import fs from "fs/promises"
import { resolveSafeDownloadPathForDelete } from "../../../../lib/downloadPaths"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const songId = Number.parseInt(id, 10)
    if (!Number.isInteger(songId) || songId <= 0) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400 })
    }

    const body = await request.json()
    const incomingPlaylistId = body?.playlistId
    const playlistId =
      incomingPlaylistId === null || incomingPlaylistId === undefined
        ? null
        : Number.parseInt(String(incomingPlaylistId), 10)

    if (playlistId !== null && !Number.isInteger(playlistId)) {
      return NextResponse.json({ error: "Invalid playlist ID" }, { status: 400 })
    }

    const song = await prisma.song.findUnique({ where: { id: songId } })
    if (!song) {
      return NextResponse.json({ error: "Song not found" }, { status: 404 })
    }

    if (playlistId !== null) {
      const playlist = await prisma.playlist.findUnique({ where: { id: playlistId } })
      if (!playlist) {
        return NextResponse.json({ error: "Playlist not found" }, { status: 404 })
      }
    }

    const updatedSong = await prisma.song.update({
      where: { id: songId },
      data: { playlistId },
    })

    return NextResponse.json(sanitizeSong(updatedSong))
  } catch (error) {
    console.error("Error updating song:", error)
    return NextResponse.json(
      { error: "Failed to update song" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const songId = Number.parseInt(id, 10)
    if (!Number.isInteger(songId) || songId <= 0) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400 })
    }

    const song = await prisma.song.findUnique({ where: { id: songId } })
    if (!song) {
      return NextResponse.json({ error: "Song not found" }, { status: 404 })
    }

    // Delete files from disk (async)
    try {
      const safeSongPath = resolveSafeDownloadPathForDelete(song.filePath)
      if (safeSongPath) {
        await fs.unlink(safeSongPath).catch(() => {})
      }

      if (song.coverPath) {
        const safeCoverPath = resolveSafeDownloadPathForDelete(song.coverPath)
        if (safeCoverPath) {
          await fs.unlink(safeCoverPath).catch(() => {})
        }
      }
    } catch (err) {
      console.error("Failed to delete file:", err)
    }

    // Delete from database
    await prisma.song.delete({ where: { id: songId } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting song:", error)
    return NextResponse.json(
      { error: "Failed to delete song" },
      { status: 500 }
    )
  }
}
