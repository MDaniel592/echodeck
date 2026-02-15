import { NextRequest, NextResponse } from "next/server"
import prisma from "../../../../lib/prisma"
import { hashPassword, createToken } from "../../../../lib/auth"

export async function POST(request: NextRequest) {
  try {
    // In production, require SETUP_SECRET for first-user bootstrap.
    const setupSecret = process.env.SETUP_SECRET
    if (process.env.NODE_ENV === "production" && !setupSecret) {
      return NextResponse.json(
        { error: "Server misconfiguration: SETUP_SECRET is required in production" },
        { status: 503 }
      )
    }

    if (setupSecret && process.env.NODE_ENV === "production") {
      const body = await request.clone().json()
      if (body?.setupSecret !== setupSecret) {
        return NextResponse.json(
          { error: "Invalid setup secret" },
          { status: 403 }
        )
      }
    }

    const body = await request.json()
    const username = typeof body?.username === "string" ? body.username.trim() : ""
    const password = typeof body?.password === "string" ? body.password : ""

    if (!username || username.length < 1) {
      return NextResponse.json(
        { error: "Username is required" },
        { status: 400 }
      )
    }

    if (username.length > 50) {
      return NextResponse.json(
        { error: "Username is too long" },
        { status: 400 }
      )
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      )
    }

    const passwordHash = await hashPassword(password)

    // Atomic check-and-create: attempt to create the user and rely on
    // application-level guard.  We use a transaction that checks count
    // and creates in one atomic unit so two concurrent requests can't
    // both succeed.
    let user: { id: number }
    try {
      user = await prisma.$transaction(async (tx) => {
        const existingCount = await tx.user.count()
        if (existingCount > 0) {
          throw new SetupAlreadyCompleteError()
        }
        return tx.user.create({
          data: { username, passwordHash, role: "admin" },
        })
      })
    } catch (error) {
      if (error instanceof SetupAlreadyCompleteError) {
        return NextResponse.json(
          { error: "Setup already completed" },
          { status: 403 }
        )
      }
      throw error
    }

    const token = createToken(user.id)

    const response = NextResponse.json({ success: true })
    response.cookies.set("auth_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: "/",
    })

    return response
  } catch (error) {
    console.error("Setup error:", error)
    return NextResponse.json(
      { error: "Setup failed" },
      { status: 500 }
    )
  }
}

class SetupAlreadyCompleteError extends Error {
  constructor() {
    super("Setup already completed")
    this.name = "SetupAlreadyCompleteError"
  }
}
