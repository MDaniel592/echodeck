import { NextRequest, NextResponse } from "next/server"
import prisma from "../../../../../lib/prisma"
import {
  appendTaskEvent,
  enqueueDownloadTask,
  startDownloadTaskWorker,
  isTerminalTaskStatus,
} from "../../../../../lib/downloadTasks"
import { redactSensitiveText } from "../../../../../lib/sanitize"

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
      select: {
        id: true,
        status: true,
        source: true,
        sourceUrl: true,
        format: true,
        quality: true,
        bestAudioPreference: true,
        playlistId: true,
      },
    })

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }

    if (!isTerminalTaskStatus(task.status)) {
      return NextResponse.json(
        { error: "Only completed or failed tasks can be retried" },
        { status: 409 }
      )
    }

    const newTask = await enqueueDownloadTask({
      source: task.source as "youtube" | "soundcloud" | "spotify",
      sourceUrl: task.sourceUrl,
      format: task.format as "mp3" | "flac" | "wav" | "ogg",
      quality: (task.quality as "best" | "320" | "256" | "192" | "128") ?? undefined,
      bestAudioPreference: (task.bestAudioPreference as "auto" | "opus" | "aac") ?? undefined,
      playlistId: task.playlistId,
    })

    await appendTaskEvent(newTask.id, "info", `Retried from task #${taskId}.`)

    try {
      await startDownloadTaskWorker(newTask.id)
    } catch (error) {
      const message = redactSensitiveText(error instanceof Error ? error.message : "Failed to start worker")
      await prisma.downloadTask.update({
        where: { id: newTask.id },
        data: {
          status: "failed",
          errorMessage: message,
          completedAt: new Date(),
          workerPid: null,
        },
      })
      await appendTaskEvent(newTask.id, "error", message)
      return NextResponse.json({ error: message }, { status: 500 })
    }

    return NextResponse.json({ task: newTask }, { status: 202 })
  } catch (error) {
    console.error("Failed to retry task:", error)
    return NextResponse.json({ error: "Failed to retry task" }, { status: 500 })
  }
}
