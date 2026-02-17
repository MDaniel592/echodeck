import { NextRequest, NextResponse } from "next/server"
import { AuthError, requireAdmin, requireAuth } from "../../../../../lib/requireAuth"
import {
  type MaintenanceAction,
  type MaintenanceProgress,
  runMaintenanceAction,
} from "../../../../../lib/adminMaintenance"

const SUPPORTED_ACTIONS: MaintenanceAction[] = [
  "attach_library",
  "backfill_metadata",
  "dedupe_library_imports",
  "normalize_titles",
  "fill_missing_covers",
  "refresh_file_metadata",
  "fetch_missing_lyrics",
  "queue_redownload_candidates",
  "refresh_origin_metadata",
]

function isSupportedAction(value: string): value is MaintenanceAction {
  return SUPPORTED_ACTIONS.includes(value as MaintenanceAction)
}

function encodeNdjsonLine(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value)}\n`)
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request)
    requireAdmin(auth)

    const body = await request.json()
    const action = typeof body?.action === "string" ? body.action : ""
    const dryRun = body?.dryRun !== false
    const stream = body?.stream === true

    if (!isSupportedAction(action)) {
      return NextResponse.json(
        { error: "Invalid action", supportedActions: SUPPORTED_ACTIONS },
        { status: 400 }
      )
    }

    if (stream) {
      const startedAt = Date.now()
      const readable = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encodeNdjsonLine({
              type: "started",
              action,
              dryRun,
              startedAt,
            })
          )

          void runMaintenanceAction(
            auth.userId,
            action,
            dryRun,
            (event: MaintenanceProgress) => {
              controller.enqueue(
                encodeNdjsonLine({
                  type: "progress",
                  event,
                })
              )
            }
          )
            .then((result) => {
              controller.enqueue(
                encodeNdjsonLine({
                  type: "result",
                  result,
                  startedAt,
                  finishedAt: Date.now(),
                })
              )
              controller.close()
            })
            .catch((error) => {
              controller.enqueue(
                encodeNdjsonLine({
                  type: "error",
                  error: error instanceof Error ? error.message : "Maintenance action failed.",
                })
              )
              controller.close()
            })
        },
      })

      return new NextResponse(readable, {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-store",
        },
      })
    }

    const result = await runMaintenanceAction(auth.userId, action, dryRun)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Failed to run maintenance fix:", error)
    return NextResponse.json({ error: "Failed to run maintenance fix" }, { status: 500 })
  }
}
