import { NextRequest, NextResponse } from "next/server"
import prisma from "../../../lib/prisma"
import { AuthError, requireAuth } from "../../../lib/requireAuth"

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request)
    const tags = await prisma.songTag.findMany({
      where: { userId: auth.userId },
      orderBy: [{ name: "asc" }],
      include: {
        _count: {
          select: { songs: true },
        },
      },
    })
    return NextResponse.json(tags)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Error fetching song tags:", error)
    return NextResponse.json({ error: "Failed to fetch song tags" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request)
    const body = await request.json().catch(() => ({}))
    const name = typeof body?.name === "string" ? body.name.trim() : ""
    const color = typeof body?.color === "string" ? body.color.trim() : null

    if (!name) {
      return NextResponse.json({ error: "Tag name is required" }, { status: 400 })
    }

    if (name.length > 50) {
      return NextResponse.json({ error: "Tag name is too long" }, { status: 400 })
    }

    const created = await prisma.songTag.create({
      data: {
        userId: auth.userId,
        name,
        color: color || null,
      },
      include: {
        _count: {
          select: { songs: true },
        },
      },
    })

    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: "Tag already exists" }, { status: 409 })
    }
    console.error("Error creating song tag:", error)
    return NextResponse.json({ error: "Failed to create song tag" }, { status: 500 })
  }
}
