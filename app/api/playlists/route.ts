import { NextRequest, NextResponse } from "next/server"
import prisma from "../../../lib/prisma"
import { AuthError, requireAuth } from "../../../lib/requireAuth"

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request)
    const playlists = await prisma.playlist.findMany({
      where: { userId: auth.userId },
      orderBy: { name: "asc" },
      include: { _count: { select: { songs: true } } },
    })

    return NextResponse.json(playlists)
  } catch (error) {
    console.error("Error fetching playlists:", error)
    return NextResponse.json(
      { error: "Failed to fetch playlists" },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request)
    const body = await request.json()
    const name = typeof body?.name === "string" ? body.name.trim() : ""

    if (!name) {
      return NextResponse.json({ error: "Playlist name is required" }, { status: 400 })
    }

    if (name.length > 80) {
      return NextResponse.json({ error: "Playlist name is too long" }, { status: 400 })
    }

    const playlist = await prisma.playlist.create({
      data: { userId: auth.userId, name },
      include: { _count: { select: { songs: true } } },
    })

    return NextResponse.json(playlist, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: "Playlist already exists" }, { status: 409 })
    }

    console.error("Error creating playlist:", error)
    return NextResponse.json(
      { error: "Failed to create playlist" },
      { status: 500 }
    )
  }
}
