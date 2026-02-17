import { NextRequest, NextResponse } from "next/server"
import prisma from "../../../../lib/prisma"
import { AuthError, requireAuth } from "../../../../lib/requireAuth"
import { groupDuplicateSongs } from "../../../../lib/organization"

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request)
    const minGroupSize = Math.min(
      10,
      Math.max(2, Number.parseInt(request.nextUrl.searchParams.get("minGroupSize") || "2", 10) || 2)
    )
    const songLimit = Math.min(
      20_000,
      Math.max(100, Number.parseInt(request.nextUrl.searchParams.get("songLimit") || "5000", 10) || 5000)
    )
    const groupLimit = Math.min(
      1000,
      Math.max(1, Number.parseInt(request.nextUrl.searchParams.get("groupLimit") || "200", 10) || 200)
    )

    const songs = await prisma.song.findMany({
      where: { userId: auth.userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: songLimit,
      select: {
        id: true,
        title: true,
        artist: true,
        duration: true,
        filePath: true,
        source: true,
        bitrate: true,
        fileSize: true,
        createdAt: true,
      },
    })

    const groups = groupDuplicateSongs(songs, minGroupSize)

    return NextResponse.json({
      scannedSongs: songs.length,
      minGroupSize,
      groupCount: groups.length,
      groups: groups.slice(0, groupLimit),
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Error finding duplicate songs:", error)
    return NextResponse.json({ error: "Failed to find duplicate songs" }, { status: 500 })
  }
}
