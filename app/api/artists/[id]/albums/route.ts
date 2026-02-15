import { NextRequest, NextResponse } from "next/server"
import prisma from "../../../../../lib/prisma"
import { AuthError, requireAuth } from "../../../../../lib/requireAuth"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request)
    const { id } = await params
    const artistId = Number.parseInt(id, 10)
    if (!Number.isInteger(artistId) || artistId <= 0) {
      return NextResponse.json({ error: "Invalid artist id" }, { status: 400 })
    }

    const artist = await prisma.artist.findFirst({
      where: { id: artistId, userId: auth.userId },
      select: { id: true, name: true },
    })
    if (!artist) {
      return NextResponse.json({ error: "Artist not found" }, { status: 404 })
    }

    const albums = await prisma.album.findMany({
      where: { userId: auth.userId, artistId },
      orderBy: [{ year: "desc" }, { title: "asc" }],
      include: {
        _count: { select: { songs: true } },
      },
    })

    return NextResponse.json({ artist, albums })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Failed to fetch artist albums:", error)
    return NextResponse.json({ error: "Failed to fetch artist albums" }, { status: 500 })
  }
}
