import { NextResponse } from "next/server"
import { drainQueuedTaskWorkers, recoverStaleTasks } from "../../../../lib/downloadTasks"

export async function POST() {
  try {
    const recovered = await recoverStaleTasks()
    const started = await drainQueuedTaskWorkers()
    return NextResponse.json({ recovered, started })
  } catch (error) {
    console.error("Failed to recover stale tasks:", error)
    return NextResponse.json({ error: "Failed to recover stale tasks" }, { status: 500 })
  }
}
