import { NextRequest, NextResponse } from "next/server"
import { drainQueuedTaskWorkers, recoverStaleTasks } from "../../../../lib/downloadTasks"
import { AuthError, requireAdmin, requireAuth } from "../../../../lib/requireAuth"

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request)
    requireAdmin(auth)

    const recovered = await recoverStaleTasks()
    const started = await drainQueuedTaskWorkers()
    return NextResponse.json({ recovered, started })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Failed to recover stale tasks:", error)
    return NextResponse.json({ error: "Failed to recover stale tasks" }, { status: 500 })
  }
}
