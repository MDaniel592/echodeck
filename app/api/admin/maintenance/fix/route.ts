import { NextRequest, NextResponse } from "next/server"
import { AuthError, requireAdmin, requireAuth } from "../../../../../lib/requireAuth"
import {
  type MaintenanceAction,
  runMaintenanceAction,
} from "../../../../../lib/adminMaintenance"

const SUPPORTED_ACTIONS: MaintenanceAction[] = [
  "attach_library",
  "backfill_metadata",
  "dedupe_library_imports",
  "normalize_titles",
  "fill_missing_covers",
]

function isSupportedAction(value: string): value is MaintenanceAction {
  return SUPPORTED_ACTIONS.includes(value as MaintenanceAction)
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request)
    requireAdmin(auth)

    const body = await request.json()
    const action = typeof body?.action === "string" ? body.action : ""
    const dryRun = body?.dryRun !== false

    if (!isSupportedAction(action)) {
      return NextResponse.json(
        { error: "Invalid action", supportedActions: SUPPORTED_ACTIONS },
        { status: 400 }
      )
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
