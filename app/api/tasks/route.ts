import { NextRequest, NextResponse } from "next/server"
import prisma from "../../../lib/prisma"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams

  const parsedLimit = Number.parseInt(searchParams.get("limit") || "", 10)
  const limit = Number.isInteger(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 30

  const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1)
  const skip = (page - 1) * limit

  const status = searchParams.get("status") || undefined
  const source = searchParams.get("source") || undefined

  const where: Record<string, unknown> = {}
  if (status) where.status = status
  if (source) where.source = source

  try {
    const [tasks, total] = await Promise.all([
      prisma.downloadTask.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          playlist: {
            select: { id: true, name: true },
          },
          events: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
          _count: {
            select: {
              events: true,
              songs: true,
            },
          },
        },
      }),
      prisma.downloadTask.count({ where }),
    ])

    return NextResponse.json({
      tasks: tasks.map((task) => ({
        ...task,
        lastEvent: task.events[0] || null,
      })),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    })
  } catch (error) {
    console.error("Failed to fetch tasks:", error)
    return NextResponse.json({ error: "Failed to fetch tasks" }, { status: 500 })
  }
}
