import { NextRequest, NextResponse } from "next/server"
import prisma from "../../../../lib/prisma"
import { AuthError, requireAuth } from "../../../../lib/requireAuth"
import { sanitizeSong } from "../../../../lib/sanitize"
import fs from "fs/promises"
import { resolveSafeDownloadPathForDelete } from "../../../../lib/downloadPaths"
import { assignSongToPlaylistForUser } from "../../../../lib/playlistEntries"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request)
    const { id } = await params
    const songId = Number.parseInt(id, 10)
    if (!Number.isInteger(songId) || songId <= 0) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400 })
    }

    const body = await request.json()
    const incomingPlaylistId = body?.playlistId
    const hasPlaylistId = incomingPlaylistId !== undefined
    const playlistId =
      incomingPlaylistId === null || incomingPlaylistId === undefined
        ? null
        : Number.parseInt(String(incomingPlaylistId), 10)

    if (hasPlaylistId && playlistId !== null && !Number.isInteger(playlistId)) {
      return NextResponse.json({ error: "Invalid playlist ID" }, { status: 400 })
    }

    const song = await prisma.song.findFirst({ where: { id: songId, userId: auth.userId } })
    if (!song) {
      return NextResponse.json({ error: "Song not found" }, { status: 404 })
    }

    if (hasPlaylistId && playlistId !== null) {
      const playlist = await prisma.playlist.findFirst({ where: { id: playlistId, userId: auth.userId } })
      if (!playlist) {
        return NextResponse.json({ error: "Playlist not found" }, { status: 404 })
      }
    }

    const normalizeOptionalString = (value: unknown, maxLen = 300): string | null | undefined => {
      if (value === undefined) return undefined
      if (value === null) return null
      if (typeof value !== "string") return undefined
      const trimmed = value.trim()
      if (!trimmed) return null
      return trimmed.slice(0, maxLen)
    }

    const normalizeOptionalInt = (value: unknown, min = 0, max = 9999): number | null | undefined => {
      if (value === undefined) return undefined
      if (value === null || value === "") return null
      const parsed = Number.parseInt(String(value), 10)
      if (!Number.isInteger(parsed)) return undefined
      if (parsed < min || parsed > max) return undefined
      return parsed
    }

    const updateData: {
      title?: string
      artist?: string | null
      album?: string | null
      albumArtist?: string | null
      year?: number | null
      genre?: string | null
      trackNumber?: number | null
      discNumber?: number | null
      lyrics?: string | null
    } = {}

    const title = normalizeOptionalString(body?.title, 300)
    if (typeof title === "string") {
      updateData.title = title
    }

    const artist = normalizeOptionalString(body?.artist, 300)
    if (artist !== undefined) {
      updateData.artist = artist
    }

    const album = normalizeOptionalString(body?.album, 300)
    if (album !== undefined) {
      updateData.album = album
    }

    const albumArtist = normalizeOptionalString(body?.albumArtist, 300)
    if (albumArtist !== undefined) {
      updateData.albumArtist = albumArtist
    }

    const genre = normalizeOptionalString(body?.genre, 120)
    if (genre !== undefined) {
      updateData.genre = genre
    }

    const lyrics = normalizeOptionalString(body?.lyrics, 20_000)
    if (lyrics !== undefined) {
      updateData.lyrics = lyrics
    }

    const year = normalizeOptionalInt(body?.year, 0, 9999)
    if (year !== undefined) {
      updateData.year = year
    }

    const trackNumber = normalizeOptionalInt(body?.trackNumber, 0, 999)
    if (trackNumber !== undefined) {
      updateData.trackNumber = trackNumber
    }

    const discNumber = normalizeOptionalInt(body?.discNumber, 0, 99)
    if (discNumber !== undefined) {
      updateData.discNumber = discNumber
    }

    const updatedCount = await prisma.song.updateMany({
      where: { id: songId, userId: auth.userId },
      data: updateData,
    })
    if (updatedCount.count === 0) {
      return NextResponse.json({ error: "Song not found" }, { status: 404 })
    }

    if (hasPlaylistId) {
      await assignSongToPlaylistForUser(auth.userId, songId, playlistId)
    }

    const updatedSong = await prisma.song.findFirst({ where: { id: songId, userId: auth.userId } })
    if (!updatedSong) {
      return NextResponse.json({ error: "Song not found" }, { status: 404 })
    }

    return NextResponse.json(sanitizeSong(updatedSong))
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
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
    const auth = await requireAuth(request)
    const { id } = await params
    const songId = Number.parseInt(id, 10)
    if (!Number.isInteger(songId) || songId <= 0) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400 })
    }

    const song = await prisma.song.findFirst({ where: { id: songId, userId: auth.userId } })
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
    await prisma.song.deleteMany({ where: { id: songId, userId: auth.userId } })

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Error deleting song:", error)
    return NextResponse.json(
      { error: "Failed to delete song" },
      { status: 500 }
    )
  }
}
