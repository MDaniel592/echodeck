import { NextRequest, NextResponse } from "next/server"
import { AuthError, requireAuth } from "../../../lib/requireAuth"
import {
  createPlaylistForUser,
  listPlaylistsForUser,
  PlaylistServiceError,
} from "../../../lib/services.playlist"

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request)
    const playlists = await listPlaylistsForUser(auth.userId)

    return NextResponse.json(playlists)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
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
    const playlist = await createPlaylistForUser(auth.userId, body?.name)

    return NextResponse.json(playlist, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof PlaylistServiceError) {
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
