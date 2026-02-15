import { NextRequest, NextResponse } from "next/server"
import prisma from "../../../lib/prisma"

export async function GET() {
  try {
    const playlists = await prisma.playlist.findMany({
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
    const body = await request.json()
    const name = typeof body?.name === "string" ? body.name.trim() : ""

    if (!name) {
      return NextResponse.json({ error: "Playlist name is required" }, { status: 400 })
    }

    if (name.length > 80) {
      return NextResponse.json({ error: "Playlist name is too long" }, { status: 400 })
    }

    const playlist = await prisma.playlist.create({
      data: { name },
      include: { _count: { select: { songs: true } } },
    })

    return NextResponse.json(playlist, { status: 201 })
  } catch (error) {
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
