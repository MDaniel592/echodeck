import { NextRequest, NextResponse } from "next/server"
import { AuthError, requireAuth } from "../../../../lib/requireAuth"
import {
  deletePlaylistForUser,
  parsePlaylistId,
  PlaylistServiceError,
  renamePlaylistForUser,
} from "../../../../lib/services.playlist"

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(request)
    const { id } = await context.params
    const body = await request.json().catch(() => ({}))
    const playlistId = parsePlaylistId(id)
    if (!playlistId) {
      return NextResponse.json({ error: "Invalid playlist ID" }, { status: 400 })
    }
    const updated = await renamePlaylistForUser(auth.userId, playlistId, body?.name)

    return NextResponse.json(updated)
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
    console.error("Error renaming playlist:", error)
    return NextResponse.json({ error: "Failed to rename playlist" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(request)
    const { id } = await context.params
    const playlistId = parsePlaylistId(id)
    if (!playlistId) {
      return NextResponse.json({ error: "Invalid playlist ID" }, { status: 400 })
    }
    await deletePlaylistForUser(auth.userId, playlistId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error instanceof PlaylistServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Error deleting playlist:", error)
    return NextResponse.json({ error: "Failed to delete playlist" }, { status: 500 })
  }
}
