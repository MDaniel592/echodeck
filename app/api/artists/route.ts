import { NextRequest, NextResponse } from "next/server"
import prisma from "../../../lib/prisma"
import { AuthError, requireAuth } from "../../../lib/requireAuth"

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request)
    const page = Math.max(1, Number.parseInt(request.nextUrl.searchParams.get("page") || "1", 10) || 1)
    const limit = Math.min(
      200,
      Math.max(1, Number.parseInt(request.nextUrl.searchParams.get("limit") || "100", 10) || 100)
    )
    const skip = (page - 1) * limit

    const [artists, total] = await Promise.all([
      prisma.artist.findMany({
        where: { userId: auth.userId, songs: { some: {} } },
        orderBy: { name: "asc" },
        skip,
        take: limit,
        include: {
          _count: { select: { albums: true, songs: true } },
        },
      }),
      prisma.artist.count({ where: { userId: auth.userId, songs: { some: {} } } }),
    ])

    return NextResponse.json({
      artists,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Failed to fetch artists:", error)
    return NextResponse.json({ error: "Failed to fetch artists" }, { status: 500 })
  }
}
