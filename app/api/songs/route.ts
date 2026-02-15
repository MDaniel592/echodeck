import { NextRequest, NextResponse } from "next/server"
import prisma from "../../../lib/prisma"
import { AuthError, requireAuth } from "../../../lib/requireAuth"
import { sanitizeSong } from "../../../lib/sanitize"

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request)
    const searchParams = request.nextUrl.searchParams

    // Pagination
    const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1)
    const limit = Math.min(
      200,
      Math.max(1, Number.parseInt(searchParams.get("limit") || "100", 10) || 100)
    )
    const skip = (page - 1) * limit

    // Filtering
    const search = searchParams.get("search")?.trim() || undefined
    const source = searchParams.get("source") || undefined
    const albumId = searchParams.get("albumId")
    const year = searchParams.get("year")
    const genre = searchParams.get("genre")?.trim() || undefined
    const playlistId = searchParams.get("playlistId")
    const sortBy = searchParams.get("sortBy") || "createdAt"
    const sortOrder = searchParams.get("sortOrder") === "asc" ? "asc" : "desc"

    const where: Record<string, unknown> = { userId: auth.userId }

    if (search) {
      where.OR = [
        { title: { contains: search } },
        { artist: { contains: search } },
      ]
    }

    if (source) {
      where.source = source
    }

    if (albumId !== null && albumId !== undefined) {
      if (albumId === "none") {
        where.albumId = null
      } else {
        const parsed = Number.parseInt(albumId, 10)
        if (Number.isInteger(parsed) && parsed > 0) {
          where.albumId = parsed
        }
      }
    }

    if (year) {
      const parsedYear = Number.parseInt(year, 10)
      if (Number.isInteger(parsedYear) && parsedYear > 0) {
        where.year = parsedYear
      }
    }

    if (genre) {
      where.genre = { contains: genre }
    }

    if (playlistId !== null && playlistId !== undefined) {
      if (playlistId === "none") {
        where.playlistId = null
      } else {
        const parsed = Number.parseInt(playlistId, 10)
        if (Number.isInteger(parsed) && parsed > 0) {
          where.playlistId = parsed
        }
      }
    }

    const validSortFields = new Set(["createdAt", "title", "artist", "source", "year", "genre", "album"])
    const orderField = validSortFields.has(sortBy) ? sortBy : "createdAt"

    const [songs, total] = await Promise.all([
      prisma.song.findMany({
        where,
        orderBy: { [orderField]: sortOrder },
        skip,
        take: limit,
      }),
      prisma.song.count({ where }),
    ])

    return NextResponse.json({
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
    console.error("Error fetching songs:", error)
    return NextResponse.json(
      { error: "Failed to fetch songs" },
      { status: 500 }
    )
  }
}
