import { NextRequest, NextResponse } from "next/server"
import prisma from "../../../../../lib/prisma"
import { AuthError, requireAuth } from "../../../../../lib/requireAuth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
const DEFAULT_SSE_POLL_MS = 5000
const MIN_SSE_POLL_MS = 2000
const DEFAULT_SSE_MAX_CLIENTS = 120
let activeClients = 0

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function getSsePollMs(): number {
  const configured = parsePositiveInt(process.env.TASK_SSE_POLL_MS, DEFAULT_SSE_POLL_MS)
  return Math.max(configured, MIN_SSE_POLL_MS)
}

function getMaxClients(): number {
  return parsePositiveInt(process.env.TASK_DETAIL_SSE_MAX_CLIENTS, DEFAULT_SSE_MAX_CLIENTS)
}

async function getTaskDetailSnapshot(taskId: number, request: NextRequest, userId: number) {
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

  const task = await prisma.downloadTask.findFirst({
    where: { id: taskId, userId },
    include: {
      playlist: {
        select: { id: true, name: true },
      },
      events: {
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
    return null
  }

  return {
    ...task,
    events: [...task.events].reverse(),
  }
}

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

  if (activeClients >= getMaxClients()) {
    return new Response("Too many live task detail stream clients", { status: 503 })
  }

  const { id } = await params
  const taskId = Number.parseInt(id, 10)
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return NextResponse.json({ error: "Invalid task ID" }, { status: 400 })
  }

  const initial = await getTaskDetailSnapshot(taskId, request, userId)
  if (!initial) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 })
  }

  const encoder = new TextEncoder()
  let interval: ReturnType<typeof setInterval> | null = null
  let keepAlive: ReturnType<typeof setInterval> | null = null
  let closed = false
  let lastPayload = ""
  const pollMs = getSsePollMs()
  activeClients += 1

  const stream = new ReadableStream({
    start(controller) {
      const close = () => {
        if (closed) return
        closed = true
        activeClients = Math.max(0, activeClients - 1)
        if (interval) clearInterval(interval)
        if (keepAlive) clearInterval(keepAlive)
        controller.close()
      }

      request.signal.addEventListener("abort", close)

      const pushSnapshot = async () => {
        if (closed) return
        try {
          const snapshot = await getTaskDetailSnapshot(taskId, request, userId)
          if (!snapshot) {
            controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: "Task not found" })}\n\n`))
            close()
            return
          }
          const payload = JSON.stringify(snapshot)
          if (payload === lastPayload) return
          lastPayload = payload
          controller.enqueue(encoder.encode(`event: task\ndata: ${payload}\n\n`))
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to stream task details"
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`))
        }
      }

      void pushSnapshot()
      interval = setInterval(() => {
        void pushSnapshot()
      }, pollMs)
      keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode(": keep-alive\n\n"))
      }, 15000)
    },
    cancel() {
      if (closed) return
      closed = true
      activeClients = Math.max(0, activeClients - 1)
      if (interval) clearInterval(interval)
      if (keepAlive) clearInterval(keepAlive)
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
