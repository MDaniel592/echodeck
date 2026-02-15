import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import prisma from "../../../../lib/prisma"
import { hashPassword } from "../../../../lib/auth"
import { AuthError, requireAdmin, requireAuth } from "../../../../lib/requireAuth"

async function countActiveAdmins(excludeUserId?: number): Promise<number> {
  const where: {
    role: "admin"
    disabledAt: null
    id?: { not: number }
  } = {
    role: "admin",
    disabledAt: null,
  }

  if (excludeUserId) {
    where.id = { not: excludeUserId }
  }

  return prisma.user.count({ where })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request)
    requireAdmin(auth)

    const { id } = await params
    const userId = Number.parseInt(id, 10)
    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json({ error: "Invalid user id" }, { status: 400 })
    }

    const existing = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, disabledAt: true },
    })
    if (!existing) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const body = await request.json()
    const role = body?.role === "admin" || body?.role === "user" ? body.role : undefined
    const disableRequested = typeof body?.disabled === "boolean" ? body.disabled : undefined
    const password = typeof body?.password === "string" ? body.password : undefined
    const rotateSubsonicToken = body?.rotateSubsonicToken === true

    const updates: {
      role?: "admin" | "user"
      disabledAt?: Date | null
      passwordHash?: string
      subsonicToken?: string
    } = {}

    if (role) {
      if (existing.id === auth.userId && role !== "admin") {
        return NextResponse.json({ error: "You cannot remove your own admin role" }, { status: 409 })
      }
      if (existing.role === "admin" && role !== "admin") {
        const otherActiveAdmins = await countActiveAdmins(existing.id)
        if (otherActiveAdmins <= 0) {
          return NextResponse.json({ error: "At least one active admin is required" }, { status: 409 })
        }
      }
      updates.role = role
    }

    if (disableRequested !== undefined) {
      if (existing.id === auth.userId && disableRequested) {
        return NextResponse.json({ error: "You cannot disable your own account" }, { status: 409 })
      }
      if (existing.role === "admin" && disableRequested) {
        const otherActiveAdmins = await countActiveAdmins(existing.id)
        if (otherActiveAdmins <= 0) {
          return NextResponse.json({ error: "At least one active admin is required" }, { status: 409 })
        }
      }
      updates.disabledAt = disableRequested ? new Date() : null
    }

    if (password !== undefined) {
      if (password.length < 8) {
        return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 })
      }
      updates.passwordHash = await hashPassword(password)
    }

    if (rotateSubsonicToken) {
      updates.subsonicToken = crypto.randomBytes(24).toString("hex")
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid updates provided" }, { status: 400 })
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: updates,
      select: {
        id: true,
        username: true,
        role: true,
        subsonicToken: true,
        disabledAt: true,
        createdAt: true,
      },
    })

    return NextResponse.json({
      ...updated,
      hasSubsonicToken: Boolean(updated.subsonicToken),
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Failed to update user:", error)
    return NextResponse.json({ error: "Failed to update user" }, { status: 500 })
  }
}
