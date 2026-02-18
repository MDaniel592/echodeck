import { NextRequest, NextResponse } from "next/server"
import prisma from "../../../../../lib/prisma"
import { AuthError, requireAdmin, requireAuth } from "../../../../../lib/requireAuth"

type ProviderMetrics = {
  source: string
  total: number
  queued: number
  running: number
  completed: number
  completedWithErrors: number
  failed: number
  avgDurationSec: number | null
  p95DurationSec: number | null
  errorRatePct: number
}

function percentile(sortedMs: number[], p: number): number | null {
  if (sortedMs.length === 0) return null
  const rank = Math.min(sortedMs.length - 1, Math.max(0, Math.ceil((p / 100) * sortedMs.length) - 1))
  return sortedMs[rank] ?? null
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request)
    requireAdmin(auth)

    const windowHoursRaw = Number.parseInt(request.nextUrl.searchParams.get("windowHours") || "", 10)
    const windowHours = Number.isInteger(windowHoursRaw) ? Math.min(Math.max(windowHoursRaw, 1), 168) : 24
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000)

    const tasks = await prisma.downloadTask.findMany({
      where: { createdAt: { gte: since } },
      select: {
        source: true,
        status: true,
        startedAt: true,
        completedAt: true,
        workerPid: true,
        heartbeatAt: true,
      },
    })

    const provider = new Map<string, ProviderMetrics & { durationsMs: number[] }>()

    for (const task of tasks) {
      const row = provider.get(task.source) || {
        source: task.source,
        total: 0,
        queued: 0,
        running: 0,
        completed: 0,
        completedWithErrors: 0,
        failed: 0,
        avgDurationSec: null,
        p95DurationSec: null,
        errorRatePct: 0,
        durationsMs: [],
      }
      row.total += 1
      if (task.status === "queued") row.queued += 1
      if (task.status === "running") row.running += 1
      if (task.status === "completed") row.completed += 1
      if (task.status === "completed_with_errors") row.completedWithErrors += 1
      if (task.status === "failed") row.failed += 1
      if (task.startedAt && task.completedAt) {
        const ms = task.completedAt.getTime() - task.startedAt.getTime()
        if (Number.isFinite(ms) && ms >= 0) row.durationsMs.push(ms)
      }
      provider.set(task.source, row)
    }

    const providerRows = Array.from(provider.values())
      .map((row) => {
        row.durationsMs.sort((a, b) => a - b)
        const avgMs = row.durationsMs.length > 0
          ? row.durationsMs.reduce((sum, value) => sum + value, 0) / row.durationsMs.length
          : null
        const p95Ms = percentile(row.durationsMs, 95)
        const errorCount = row.failed + row.completedWithErrors
        const errorRatePct = row.total > 0 ? Math.round((errorCount / row.total) * 1000) / 10 : 0
        return {
          source: row.source,
          total: row.total,
          queued: row.queued,
          running: row.running,
          completed: row.completed,
          completedWithErrors: row.completedWithErrors,
          failed: row.failed,
          avgDurationSec: avgMs === null ? null : Math.round((avgMs / 1000) * 10) / 10,
          p95DurationSec: p95Ms === null ? null : Math.round((p95Ms / 1000) * 10) / 10,
          errorRatePct,
        }
      })
      .sort((a, b) => b.total - a.total || a.source.localeCompare(b.source))

    const staleCutoff = Date.now() - 5 * 60 * 1000
    const runningWorkers = tasks.filter((task) => task.status === "running")
    const queuedTasks = tasks.filter((task) => task.status === "queued")
    const staleWorkers = runningWorkers.filter((task) => {
      if (!task.workerPid || !task.heartbeatAt) return false
      return task.heartbeatAt.getTime() < staleCutoff
    })

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      windowHours,
      totals: {
        tasks: tasks.length,
        running: runningWorkers.length,
        queued: queuedTasks.length,
      },
      workers: {
        runningWorkers: runningWorkers.filter((task) => typeof task.workerPid === "number").length,
        staleCandidates: staleWorkers.length,
      },
      providers: providerRows,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Failed to fetch download metrics:", error)
    return NextResponse.json({ error: "Failed to fetch download metrics" }, { status: 500 })
  }
}
