import { NextRequest, NextResponse } from "next/server"
import prisma from "../../../../lib/prisma"
import { AuthError, requireAuth } from "../../../../lib/requireAuth"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let userId = 0
  try {
    const auth = await requireAuth(request)
    userId = auth.userId
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const taskId = Number.parseInt(id, 10)
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return NextResponse.json({ error: "Invalid task ID" }, { status: 400 })
  }

  const eventLimitParam = request.nextUrl.searchParams.get("eventLimit")
  const parsedEventLimit = Number.parseInt(eventLimitParam || "", 10)
  const eventLimit = Number.isInteger(parsedEventLimit)
    ? Math.min(Math.max(parsedEventLimit, 20), 2000)
    : 300

  const songLimitParam = request.nextUrl.searchParams.get("songLimit")
  const parsedSongLimit = Number.parseInt(songLimitParam || "", 10)
  const songLimit = Number.isInteger(parsedSongLimit)
    ? Math.min(Math.max(parsedSongLimit, 1), 500)
    : 200

  try {
    const task = await prisma.downloadTask.findFirst({
      where: { id: taskId, userId },
      include: {
        playlist: {
          select: { id: true, name: true },
        },
        events: {
          // Fetch newest events first so long-running tasks still return recent logs,
          // then reverse to keep chronological display order in the client.
          orderBy: { id: "desc" },
          take: eventLimit,
        },
        songs: {
          orderBy: { createdAt: "desc" },
          take: songLimit,
        },
      },
    })

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }

    return NextResponse.json({
      ...task,
      events: [...task.events].reverse(),
    })
  } catch (error) {
    console.error("Failed to fetch task details:", error)
    return NextResponse.json({ error: "Failed to fetch task details" }, { status: 500 })
  }
}
