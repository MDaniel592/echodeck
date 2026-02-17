import { NextRequest, NextResponse } from "next/server"
import prisma from "../../../../../lib/prisma"
import { sanitizeSong } from "../../../../../lib/sanitize"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const normalized = (token || "").trim()
  if (!normalized) {
    return NextResponse.json({ error: "Invalid share token" }, { status: 400 })
  }

  const share = await prisma.share.findUnique({
    where: { token: normalized },
    include: {
      user: { select: { username: true } },
      entries: {
        include: {
          song: true,
          album: {
            select: { id: true, title: true, albumArtist: true, year: true },
          },
          playlist: {
            select: { id: true, name: true },
          },
        },
        orderBy: { id: "asc" },
      },
    },
  })

  if (!share) {
    return NextResponse.json({ error: "Share not found" }, { status: 404 })
  }

  if (share.expiresAt && share.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: "Share expired" }, { status: 410 })
  }

  await prisma.share.update({
    where: { id: share.id },
    data: {
      lastVisited: new Date(),
      visitCount: { increment: 1 },
    },
  }).catch(() => {})

  return NextResponse.json({
    id: share.id,
    username: share.user.username,
    description: share.description,
    createdAt: share.createdAt,
    expiresAt: share.expiresAt,
    visitCount: share.visitCount + 1,
    entries: share.entries.map((entry) => {
      if (entry.type === "song" && entry.song) {
        return {
          type: "song",
          song: sanitizeSong(entry.song),
        }
      }
      if (entry.type === "album" && entry.album) {
        return {
          type: "album",
          album: entry.album,
        }
      }
      if (entry.type === "playlist" && entry.playlist) {
        return {
          type: "playlist",
          playlist: entry.playlist,
        }
      }
      return {
        type: entry.type,
      }
    }),
  })
}
