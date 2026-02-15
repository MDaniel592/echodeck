import { NextRequest, NextResponse } from "next/server"
import prisma from "../../../../lib/prisma"
import { verifyToken } from "../../../../lib/auth"

export async function GET(request: NextRequest) {
  try {
    const userCount = await prisma.user.count()
    if (userCount === 0) {
      return NextResponse.json({ authenticated: false, needsSetup: true })
    }

    const token = request.cookies.get("auth_token")?.value
    if (!token) {
      return NextResponse.json({ authenticated: false, needsSetup: false })
    }

    const payload = verifyToken(token)
    if (!payload) {
      return NextResponse.json({ authenticated: false, needsSetup: false })
    }

    return NextResponse.json({ authenticated: true, needsSetup: false })
  } catch (error) {
    console.error("Auth check error:", error)
    return NextResponse.json({ authenticated: false, needsSetup: false })
  }
}
