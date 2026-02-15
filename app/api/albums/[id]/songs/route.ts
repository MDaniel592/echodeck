import { NextRequest, NextResponse } from "next/server"
import prisma from "../../../../../lib/prisma"
import { AuthError, requireAuth } from "../../../../../lib/requireAuth"
import { sanitizeSong } from "../../../../../lib/sanitize"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request)
    const { id } = await params
    const albumId = Number.parseInt(id, 10)
    if (!Number.isInteger(albumId) || albumId <= 0) {
      return NextResponse.json({ error: "Invalid album id" }, { status: 400 })
    }

    const album = await prisma.album.findFirst({
      where: { id: albumId, userId: auth.userId },
      include: {
        artist: { select: { id: true, name: true } },
      },
    })
    if (!album) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 })
    }

    const songs = await prisma.song.findMany({
      where: { userId: auth.userId, albumId },
      orderBy: [
        { discNumber: "asc" },
        { trackNumber: "asc" },
        { createdAt: "asc" },
      ],
    })

    return NextResponse.json({
      album,
      songs: songs.map(sanitizeSong),
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Failed to fetch album songs:", error)
    return NextResponse.json({ error: "Failed to fetch album songs" }, { status: 500 })
  }
}
