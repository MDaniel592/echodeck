import { NextRequest, NextResponse } from "next/server"
import { getMaintenanceAudit } from "../../../../../lib/adminMaintenance"
import { AuthError, requireAdmin, requireAuth } from "../../../../../lib/requireAuth"

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request)
    requireAdmin(auth)

    const audit = await getMaintenanceAudit(auth.userId)
    return NextResponse.json(audit)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Failed to run maintenance audit:", error)
    return NextResponse.json({ error: "Failed to run maintenance audit" }, { status: 500 })
  }
}
