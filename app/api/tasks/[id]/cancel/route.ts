import { NextRequest, NextResponse } from "next/server"
import prisma from "../../../../../lib/prisma"
import { appendTaskEvent, drainQueuedTaskWorkers } from "../../../../../lib/downloadTasks"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const taskId = Number.parseInt(id, 10)
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return NextResponse.json({ error: "Invalid task ID" }, { status: 400 })
  }

  try {
    const task = await prisma.downloadTask.findUnique({
      where: { id: taskId },
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
    if (
      task.status === "running" &&
      task.workerPid &&
      task.workerPid > 1 &&
      task.heartbeatAt &&
      Date.now() - task.heartbeatAt.getTime() < 2 * 60 * 1000
    ) {
      try {
        process.kill(task.workerPid, "SIGTERM")
      } catch {
        // Process may already be dead
      }
    }

    await prisma.downloadTask.update({
      where: { id: taskId },
      data: {
        status: "failed",
        errorMessage: "Cancelled by user.",
        completedAt: new Date(),
        workerPid: null,
      },
    })

    await appendTaskEvent(taskId, "status", "Task cancelled by user.")
    await drainQueuedTaskWorkers()

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Failed to cancel task:", error)
    return NextResponse.json({ error: "Failed to cancel task" }, { status: 500 })
  }
}
