import { NextRequest, NextResponse } from "next/server"
import prisma from "../../../lib/prisma"
import { AuthError, requireAuth } from "../../../lib/requireAuth"
import { sanitizeSong } from "../../../lib/sanitize"

function songPriority(song: {
  source: string
  artist: string | null
  album: string | null
  title: string
  id: number
}): number {
  let score = 0
  if (song.source !== "library") score += 4
  if (song.artist && song.artist.trim()) score += 2
  if (song.album && song.album.trim()) score += 1
  if (song.title && !/^\d{5,}/.test(song.title.trim())) score += 1
  score += Math.min(song.id, 10_000) / 100_000
  return score
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request)
    const searchParams = request.nextUrl.searchParams

    // Pagination
    const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1)
    const limit = Math.min(
      1000,
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
    const tagId = searchParams.get("tagId")
    const sortBy = searchParams.get("sortBy") || "createdAt"
    const sortOrder = searchParams.get("sortOrder") === "asc" ? "asc" : "desc"

    const where: Record<string, unknown> = { userId: auth.userId }

    if (search) {
      where.OR = [
        { title: { contains: search } },
        { artist: { contains: search } },
        { album: { contains: search } },
        { source: { contains: search } },
        { format: { contains: search } },
        { quality: { contains: search } },
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

    if (tagId !== null && tagId !== undefined) {
      const parsed = Number.parseInt(tagId, 10)
      if (Number.isInteger(parsed) && parsed > 0) {
        where.tagAssignments = { some: { tagId: parsed } }
      }
    }

    const libraryId = searchParams.get("libraryId")
    if (libraryId !== null && libraryId !== undefined) {
      const parsed = Number.parseInt(libraryId, 10)
      if (Number.isInteger(parsed) && parsed > 0) {
        where.libraryId = parsed
      }
    }

    const validSortFields = new Set(["createdAt", "title", "artist", "source", "year", "genre", "album"])
    const orderField = validSortFields.has(sortBy) ? sortBy : "createdAt"

    const orderedCandidates = await prisma.song.findMany({
      where,
      orderBy: { [orderField]: sortOrder },
      select: {
        id: true,
        source: true,
        artist: true,
        album: true,
        title: true,
        filePath: true,
      },
    })

    const bestByPath = new Map<string, (typeof orderedCandidates)[number]>()
    for (const song of orderedCandidates) {
      const key = song.filePath.trim().toLowerCase()
      const current = bestByPath.get(key)
      if (!current) {
        bestByPath.set(key, song)
        continue
      }
      if (songPriority(song) > songPriority(current)) {
        bestByPath.set(key, song)
      }
    }
    const dedupedCandidates = Array.from(bestByPath.values())
    const total = dedupedCandidates.length
    const pageIds = dedupedCandidates.slice(skip, skip + limit).map((song) => song.id)

    const songs = pageIds.length > 0
      ? await prisma.song.findMany({
          where: {
            userId: auth.userId,
            id: { in: pageIds },
          },
        })
      : []

    const songsById = new Map(songs.map((song) => [song.id, song]))
    const pagedSongs = pageIds
      .map((id) => songsById.get(id))
      .filter((song): song is (typeof songs)[number] => Boolean(song))

    return NextResponse.json({
      songs: pagedSongs.map(sanitizeSong),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      dedupedInPage: orderedCandidates.length - dedupedCandidates.length,
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
