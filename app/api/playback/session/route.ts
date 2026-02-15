import { NextRequest, NextResponse } from "next/server"
import prisma from "../../../../lib/prisma"
import { AuthError, requireAuth } from "../../../../lib/requireAuth"
import { sanitizeSong } from "../../../../lib/sanitize"

type RepeatMode = "off" | "all" | "one"

function normalizeRepeatMode(input: unknown): RepeatMode {
  if (input === "all" || input === "one") return input
  return "off"
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request)
    const deviceId = request.nextUrl.searchParams.get("deviceId")?.trim() || ""
    if (!deviceId) {
      return NextResponse.json({ error: "deviceId is required" }, { status: 400 })
    }

    const session = await prisma.playbackSession.findUnique({
      where: {
        userId_deviceId: {
          userId: auth.userId,
          deviceId,
        },
      },
      include: {
        currentSong: true,
        queueItems: {
          orderBy: { sortOrder: "asc" },
          include: { song: true },
        },
      },
    })

    if (!session) {
      return NextResponse.json({
        session: null,
        queue: [],
      })
    }

    return NextResponse.json({
      session: {
        id: session.id,
        deviceId: session.deviceId,
        positionSec: session.positionSec,
        isPlaying: session.isPlaying,
        repeatMode: session.repeatMode,
        shuffle: session.shuffle,
        updatedAt: session.updatedAt,
        currentSong: session.currentSong ? sanitizeSong(session.currentSong) : null,
      },
      queue: session.queueItems.map((item) => ({
        id: item.id,
        sortOrder: item.sortOrder,
        song: sanitizeSong(item.song),
      })),
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Failed to fetch playback session:", error)
    return NextResponse.json({ error: "Failed to fetch playback session" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await requireAuth(request)
    const body = await request.json()
    const deviceId = typeof body?.deviceId === "string" ? body.deviceId.trim() : ""
    if (!deviceId) {
      return NextResponse.json({ error: "deviceId is required" }, { status: 400 })
    }

    const currentSongIdRaw = body?.currentSongId
    const currentSongId =
      currentSongIdRaw === null || currentSongIdRaw === undefined || currentSongIdRaw === ""
        ? null
        : Number.parseInt(String(currentSongIdRaw), 10)
    if (currentSongId !== null) {
      if (!Number.isInteger(currentSongId) || currentSongId <= 0) {
        return NextResponse.json({ error: "Invalid currentSongId" }, { status: 400 })
      }
      const song = await prisma.song.findFirst({
        where: { id: currentSongId, userId: auth.userId },
        select: { id: true },
      })
      if (!song) {
        return NextResponse.json({ error: "Song not found" }, { status: 404 })
      }
    }

    const parsedPosition = Number(body?.positionSec)
    const positionSec = Number.isFinite(parsedPosition) ? Math.max(0, parsedPosition) : 0
    const isPlaying = Boolean(body?.isPlaying)
    const repeatMode = normalizeRepeatMode(body?.repeatMode)
    const shuffle = Boolean(body?.shuffle)

    const session = await prisma.playbackSession.upsert({
      where: {
        userId_deviceId: {
          userId: auth.userId,
          deviceId,
        },
      },
      create: {
        userId: auth.userId,
        deviceId,
        currentSongId,
        positionSec,
        isPlaying,
        repeatMode,
        shuffle,
      },
      update: {
        currentSongId,
        positionSec,
        isPlaying,
        repeatMode,
        shuffle,
      },
      select: {
        id: true,
        deviceId: true,
        currentSongId: true,
        positionSec: true,
        isPlaying: true,
        repeatMode: true,
        shuffle: true,
        updatedAt: true,
      },
    })

    return NextResponse.json({ session })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Failed to update playback session:", error)
    return NextResponse.json({ error: "Failed to update playback session" }, { status: 500 })
  }
}
