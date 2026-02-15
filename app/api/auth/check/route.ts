import { NextRequest, NextResponse } from "next/server"
import prisma from "../../../../lib/prisma"
import { AuthError, requireAuth } from "../../../../lib/requireAuth"

export async function GET(request: NextRequest) {
  try {
    const userCount = await prisma.user.count()
    if (userCount === 0) {
      return NextResponse.json({ authenticated: false, needsSetup: true })
    }

    const auth = await requireAuth(request)
    return NextResponse.json({
      authenticated: true,
      needsSetup: false,
      user: { id: auth.userId, role: auth.role },
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ authenticated: false, needsSetup: false })
    }
    console.error("Auth check error:", error)
    return NextResponse.json({ authenticated: false, needsSetup: false })
  }
}
