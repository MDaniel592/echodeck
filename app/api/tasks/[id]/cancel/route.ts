import { NextRequest, NextResponse } from "next/server"
import prisma from "../../../../../lib/prisma"
import { appendTaskEvent, drainQueuedTaskWorkers } from "../../../../../lib/downloadTasks"
import { AuthError, requireAuth } from "../../../../../lib/requireAuth"

export async function POST(
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

  try {
    const task = await prisma.downloadTask.findFirst({
      where: { id: taskId, userId },
      select: { id: true, status: true, workerPid: true, heartbeatAt: true },
    })

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }

    if (task.status !== "queued" && task.status !== "running") {
      return NextResponse.json(
        { error: "Only queued or running tasks can be cancelled" },
        { status: 409 }
      )
    }

    // Try to kill the worker process if running
    if (task.status === "running" && task.workerPid && task.workerPid > 1) {
      try {
        process.kill(task.workerPid, "SIGTERM")
      } catch {
        // Process may already be dead
      }
    }

    const cancelled = await prisma.downloadTask.updateMany({
      where: {
        id: taskId,
        userId,
        status: {
          in: ["queued", "running"],
        },
      },
      data: {
        status: "failed",
        errorMessage: "Cancelled by user.",
        completedAt: new Date(),
        workerPid: null,
      },
    })
    if (cancelled.count === 0) {
      return NextResponse.json(
        { error: "Task can no longer be cancelled" },
        { status: 409 }
      )
    }

    await appendTaskEvent(userId, taskId, "status", "Task cancelled by user.")
    await drainQueuedTaskWorkers()

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Failed to cancel task:", error)
    return NextResponse.json({ error: "Failed to cancel task" }, { status: 500 })
  }
}
