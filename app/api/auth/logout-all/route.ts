import { NextRequest, NextResponse } from "next/server"
import prisma from "../../../../lib/prisma"
import { AuthError, requireAuth } from "../../../../lib/requireAuth"

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request)

    await prisma.user.update({
      where: { id: auth.userId },
      data: {
        authTokenVersion: { increment: 1 },
      },
    })

    const response = NextResponse.json({ success: true })
    response.cookies.set("auth_token", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 0,
      path: "/",
    })
    return response
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Logout-all failed:", error)
    return NextResponse.json({ error: "Logout-all failed" }, { status: 500 })
  }
}
