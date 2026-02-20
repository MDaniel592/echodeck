import { NextRequest, NextResponse } from "next/server"
import prisma from "../../../../../lib/prisma"
import { AuthError, requireAuth } from "../../../../../lib/requireAuth"
import { resolveAndPersistLyricsForSong } from "../../../../../lib/services.lyrics"

export async function GET(
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

    const song = await prisma.song.findFirst({
      where: { id: songId, userId: auth.userId },
      select: { id: true, title: true, artist: true, album: true, duration: true, lyrics: true },
    })
    if (!song) {
      return NextResponse.json({ error: "Song not found" }, { status: 404 })
    }

    const lyrics = await resolveAndPersistLyricsForSong({
      songId: song.id,
      title: song.title,
      artist: song.artist,
      album: song.album,
      duration: song.duration,
      currentLyrics: song.lyrics,
    })

    return NextResponse.json({ lyrics: lyrics ?? null })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Error fetching lyrics:", error)
    return NextResponse.json({ error: "Failed to fetch lyrics" }, { status: 500 })
  }
}
