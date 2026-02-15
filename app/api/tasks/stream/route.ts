import { NextRequest } from "next/server"
import prisma from "../../../../lib/prisma"
import { redactSensitiveText } from "../../../../lib/sanitize"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
const DEFAULT_SSE_POLL_MS = 5000
const MIN_SSE_POLL_MS = 2000
const DEFAULT_SSE_MAX_CLIENTS = 60
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
  return parsePositiveInt(process.env.TASK_SSE_MAX_CLIENTS, DEFAULT_SSE_MAX_CLIENTS)
}

async function getTasksSnapshot(request: NextRequest) {
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
      },
    }),
    prisma.downloadTask.count({ where }),
  ])

  return {
    tasks: tasks.map((task) => ({
      ...task,
      lastEvent: task.events[0] || null,
    })),
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  }
}

export async function GET(request: NextRequest) {
  if (activeClients >= getMaxClients()) {
    return new Response("Too many live task stream clients", { status: 503 })
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
          const snapshot = await getTasksSnapshot(request)
          const payload = JSON.stringify(snapshot)
          if (payload === lastPayload) return
          lastPayload = payload
          controller.enqueue(encoder.encode(`event: tasks\ndata: ${payload}\n\n`))
        } catch (error) {
          const message = redactSensitiveText(error instanceof Error ? error.message : "Failed to stream tasks")
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
