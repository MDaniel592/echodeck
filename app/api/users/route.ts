import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import prisma from "../../../lib/prisma"
import { hashPassword } from "../../../lib/auth"
import { AuthError, requireAdmin, requireAuth } from "../../../lib/requireAuth"

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request)
    requireAdmin(auth)

    const users = await prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        username: true,
        role: true,
        subsonicToken: true,
        disabledAt: true,
        createdAt: true,
      },
    })

    return NextResponse.json(
      users.map((user) => ({
        id: user.id,
        username: user.username,
        role: user.role,
        disabledAt: user.disabledAt,
        createdAt: user.createdAt,
        hasSubsonicToken: Boolean(user.subsonicToken),
      }))
    )
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Failed to list users:", error)
    return NextResponse.json({ error: "Failed to list users" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request)
    requireAdmin(auth)

    const body = await request.json()
    const username = typeof body?.username === "string" ? body.username.trim() : ""
    const password = typeof body?.password === "string" ? body.password : ""
    const role = body?.role === "user" ? "user" : "admin"

    if (!username || username.length > 50) {
      return NextResponse.json({ error: "Invalid username" }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 })
    }

    const passwordHash = await hashPassword(password)
    const user = await prisma.user.create({
      data: {
        username,
        passwordHash,
        role,
        subsonicToken: crypto.randomBytes(24).toString("hex"),
      },
      select: {
        id: true,
        username: true,
        role: true,
        subsonicToken: true,
        disabledAt: true,
        createdAt: true,
      },
    })

    return NextResponse.json(
      {
        ...user,
        hasSubsonicToken: Boolean(user.subsonicToken),
      },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: "Username already exists" }, { status: 409 })
    }
    console.error("Failed to create user:", error)
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 })
  }
}
