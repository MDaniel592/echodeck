import { NextRequest, NextResponse } from "next/server"
import prisma from "../../../lib/prisma"
import { AuthError, requireAuth } from "../../../lib/requireAuth"

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request)
    const libraries = await prisma.library.findMany({
      where: { userId: auth.userId },
      orderBy: { name: "asc" },
      include: {
        paths: { orderBy: { path: "asc" } },
        scanRuns: { orderBy: { startedAt: "desc" }, take: 1 },
        _count: { select: { songs: true } },
      },
    })
    return NextResponse.json(libraries)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Failed to fetch libraries:", error)
    return NextResponse.json({ error: "Failed to fetch libraries" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request)
    const body = await request.json()
    const name = typeof body?.name === "string" ? body.name.trim() : ""
    const inputPath = typeof body?.path === "string" ? body.path.trim() : ""

    if (!name) {
      return NextResponse.json({ error: "Library name is required" }, { status: 400 })
    }
    if (!inputPath) {
      return NextResponse.json({ error: "Initial path is required" }, { status: 400 })
    }

    const created = await prisma.library.create({
      data: {
        userId: auth.userId,
        name,
        paths: {
          create: {
            path: inputPath,
            enabled: true,
          },
        },
      },
      include: {
        paths: true,
        _count: { select: { songs: true } },
      },
    })

    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: "Library already exists" }, { status: 409 })
    }
    console.error("Failed to create library:", error)
    return NextResponse.json({ error: "Failed to create library" }, { status: 500 })
  }
}
