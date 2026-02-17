import { NextRequest, NextResponse } from "next/server"
import prisma from "../../../../../lib/prisma"
import { AuthError, requireAuth } from "../../../../../lib/requireAuth"
import { sanitizeSong } from "../../../../../lib/sanitize"

async function resolveTag(userId: number, idRaw: string) {
  const tagId = Number.parseInt(idRaw, 10)
  if (!Number.isInteger(tagId) || tagId <= 0) return null
  return prisma.songTag.findFirst({ where: { id: tagId, userId } })
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(request)
    const { id } = await context.params
    const tag = await resolveTag(auth.userId, id)
    if (!tag) {
      return NextResponse.json({ error: "Tag not found" }, { status: 404 })
    }

    const page = Math.max(1, Number.parseInt(request.nextUrl.searchParams.get("page") || "1", 10) || 1)
    const limit = Math.min(1000, Math.max(1, Number.parseInt(request.nextUrl.searchParams.get("limit") || "100", 10) || 100))
    const skip = (page - 1) * limit

    const [songs, total] = await Promise.all([
      prisma.song.findMany({
        where: {
          userId: auth.userId,
          tagAssignments: { some: { tagId: tag.id } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take: limit,
      }),
      prisma.song.count({
        where: {
          userId: auth.userId,
          tagAssignments: { some: { tagId: tag.id } },
        },
      }),
    ])

    return NextResponse.json({
      tag,
      songs: songs.map(sanitizeSong),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Error fetching songs for tag:", error)
    return NextResponse.json({ error: "Failed to fetch songs for tag" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(request)
    const { id } = await context.params
    const tag = await resolveTag(auth.userId, id)
    if (!tag) {
      return NextResponse.json({ error: "Tag not found" }, { status: 404 })
    }

    const body = await request.json().catch(() => ({}))
    const incoming = Array.isArray(body?.songIds) ? body.songIds : []
    const normalizedSongIds = incoming
      .map((value: unknown) => (typeof value === "number" ? value : Number.parseInt(String(value), 10)))
      .filter((value: number): value is number => Number.isInteger(value) && value > 0)
    const uniqueSongIds: number[] = Array.from(new Set(normalizedSongIds))

    if (uniqueSongIds.length > 0) {
      const found = await prisma.song.findMany({
        where: { userId: auth.userId, id: { in: uniqueSongIds } },
        select: { id: true },
      })
      if (found.length !== uniqueSongIds.length) {
        return NextResponse.json({ error: "One or more songs were not found" }, { status: 400 })
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.songTagAssignment.deleteMany({ where: { tagId: tag.id } })

      if (uniqueSongIds.length > 0) {
        await tx.songTagAssignment.createMany({
          data: uniqueSongIds.map((songId) => ({ tagId: tag.id, songId })),
        })
      }
    })

    const updated = await prisma.songTag.findUnique({
      where: { id: tag.id },
      include: {
        _count: {
          select: { songs: true },
        },
      },
    })

    return NextResponse.json({
      tag: updated,
      assignedSongIds: uniqueSongIds,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Error updating songs for tag:", error)
    return NextResponse.json({ error: "Failed to update songs for tag" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(request)
    const { id } = await context.params
    const tag = await resolveTag(auth.userId, id)
    if (!tag) {
      return NextResponse.json({ error: "Tag not found" }, { status: 404 })
    }

    const body = await request.json().catch(() => ({}))
    const incoming = Array.isArray(body?.songIds) ? body.songIds : []
    const uniqueSongIds: number[] = Array.from(
      new Set(
        incoming
          .map((value: unknown) => (typeof value === "number" ? value : Number.parseInt(String(value), 10)))
          .filter((value: number): value is number => Number.isInteger(value) && value > 0)
      )
    )

    if (uniqueSongIds.length === 0) {
      return NextResponse.json({ error: "No songIds provided" }, { status: 400 })
    }

    const found = await prisma.song.findMany({
      where: { userId: auth.userId, id: { in: uniqueSongIds } },
      select: { id: true },
    })
    if (found.length !== uniqueSongIds.length) {
      return NextResponse.json({ error: "One or more songs were not found" }, { status: 400 })
    }

    for (const songId of uniqueSongIds) {
      await prisma.songTagAssignment
        .create({
          data: { tagId: tag.id, songId },
        })
        .catch((err: unknown) => {
          if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "P2002") {
            return null
          }
          throw err
        })
    }

    return NextResponse.json({ ok: true, addedSongIds: uniqueSongIds })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Error adding songs to tag:", error)
    return NextResponse.json({ error: "Failed to add songs to tag" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(request)
    const { id } = await context.params
    const tag = await resolveTag(auth.userId, id)
    if (!tag) {
      return NextResponse.json({ error: "Tag not found" }, { status: 404 })
    }

    const body = await request.json().catch(() => ({}))
    const incoming = Array.isArray(body?.songIds) ? body.songIds : []
    const uniqueSongIds: number[] = Array.from(
      new Set(
        incoming
          .map((value: unknown) => (typeof value === "number" ? value : Number.parseInt(String(value), 10)))
          .filter((value: number): value is number => Number.isInteger(value) && value > 0)
      )
    )

    if (uniqueSongIds.length === 0) {
      return NextResponse.json({ error: "No songIds provided" }, { status: 400 })
    }

    await prisma.songTagAssignment.deleteMany({
      where: {
        tagId: tag.id,
        songId: { in: uniqueSongIds },
      },
    })

    return NextResponse.json({ ok: true, removedSongIds: uniqueSongIds })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Error removing songs from tag:", error)
    return NextResponse.json({ error: "Failed to remove songs from tag" }, { status: 500 })
  }
}
