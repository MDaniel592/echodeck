import { NextRequest, NextResponse } from "next/server"
import {
  appendTaskEvent,
  enqueueDownloadTask,
  normalizeBestAudioPreference,
  normalizeFormat,
  normalizeQuality,
  PlaylistSelectionError,
  resolveTaskPlaylistSelection,
  SOUNDCLOUD_HOSTS,
  startDownloadTaskWorker,
  YOUTUBE_HOSTS,
} from "../../../../lib/downloadTasks"
import prisma from "../../../../lib/prisma"
import { AuthError, requireAuth } from "../../../../lib/requireAuth"
import { redactSensitiveText } from "../../../../lib/sanitize"

function detectSource(host: string): "youtube" | "soundcloud" | null {
  if (YOUTUBE_HOSTS.has(host)) return "youtube"
  if (SOUNDCLOUD_HOSTS.has(host)) return "soundcloud"
  return null
}

export async function POST(request: NextRequest) {
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

  let body: Record<string, unknown> = {}
  try {
    const parsedBody: unknown = await request.json()
    if (parsedBody && typeof parsedBody === "object") {
      body = parsedBody as Record<string, unknown>
    }
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 })
  }
  const url = typeof body.url === "string" ? body.url : undefined

  if (!url) {
    return NextResponse.json({ error: "URL is required" }, { status: 400 })
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 })
  }

  if (parsed.protocol !== "https:") {
    return NextResponse.json({ error: "Only HTTPS URLs are allowed" }, { status: 400 })
  }

  const host = parsed.hostname.toLowerCase()
  const source = detectSource(host)
  if (!source) {
    return NextResponse.json({ error: "URL must be from YouTube or SoundCloud" }, { status: 400 })
  }

  const quality = normalizeQuality(body.quality)
  const format = normalizeFormat(body.format)
  const bestAudioPreference = normalizeBestAudioPreference(body.bestAudioPreference)

  let playlistSelection: Awaited<ReturnType<typeof resolveTaskPlaylistSelection>>
  try {
    playlistSelection = await resolveTaskPlaylistSelection({
      userId,
      playlistId: body.playlistId,
      playlistName: body.playlistName,
    })
  } catch (error) {
    if (error instanceof PlaylistSelectionError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const message = redactSensitiveText(
      error instanceof Error ? error.message : "Failed to resolve playlist selection"
    )
    return NextResponse.json({ error: message }, { status: 500 })
  }

  try {
    const task = await enqueueDownloadTask({
      userId,
      source,
      sourceUrl: parsed.toString(),
      format,
      quality,
      bestAudioPreference,
      playlistId: playlistSelection.playlistId,
    })

    if (playlistSelection.playlistId && playlistSelection.playlistName) {
      const message = playlistSelection.created
        ? `Created playlist "${playlistSelection.playlistName}" for this task.`
        : `Assigned task to playlist "${playlistSelection.playlistName}".`
      await appendTaskEvent(userId, task.id, "info", message)
    }

    try {
      await startDownloadTaskWorker(task.id)
    } catch (error) {
      const message = redactSensitiveText(error instanceof Error ? error.message : "Failed to start worker")
      await enqueueFailure(userId, task.id, message)
      return NextResponse.json({ error: message }, { status: 500 })
    }

    return NextResponse.json({ task }, { status: 202 })
  } catch (error) {
    const message = redactSensitiveText(error instanceof Error ? error.message : "Failed to queue task")
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

async function enqueueFailure(userId: number, taskId: number, message: string) {
  const safeMessage = redactSensitiveText(message)
  await prisma.downloadTask.update({
    where: { id: taskId },
    data: {
      status: "failed",
      errorMessage: safeMessage,
      completedAt: new Date(),
      workerPid: null,
    },
  })
  await appendTaskEvent(userId, taskId, "error", safeMessage)
}
