import { NextRequest, NextResponse } from "next/server"
import { getRateLimitMetrics, resetRateLimitMetrics } from "../../../../../lib/rateLimit"
import { AuthError, requireAdmin, requireAuth } from "../../../../../lib/requireAuth"

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request)
    requireAdmin(auth)

    const parsedLimit = Number.parseInt(request.nextUrl.searchParams.get("limit") || "", 10)
    const limit = Number.isInteger(parsedLimit) ? parsedLimit : 50
    return NextResponse.json(getRateLimitMetrics(limit))
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Failed to fetch rate-limit metrics:", error)
    return NextResponse.json({ error: "Failed to fetch rate-limit metrics" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request)
    requireAdmin(auth)

    const body = await request.json().catch(() => ({}))
    if (body?.reset === true) {
      resetRateLimitMetrics()
      return NextResponse.json({ success: true, reset: true })
    }
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Failed to reset rate-limit metrics:", error)
    return NextResponse.json({ error: "Failed to reset rate-limit metrics" }, { status: 500 })
  }
}
