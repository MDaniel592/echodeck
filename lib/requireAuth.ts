import { NextRequest } from "next/server"
import prisma from "./prisma"
import { verifyToken } from "./auth"

export class AuthError extends Error {
  status: number

  constructor(message: string, status = 401) {
    super(message)
    this.name = "AuthError"
    this.status = status
  }
}

export type AuthedUser = {
  userId: number
  role: "admin" | "user"
  username: string
}

function isTransientDbError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const maybeCode = "code" in error ? String((error as { code?: unknown }).code || "") : ""
  const message =
    "message" in error ? String((error as { message?: unknown }).message || "").toLowerCase() : ""
  if (maybeCode === "P1008") return true
  return (
    message.includes("operation has timed out") ||
    message.includes("database is locked") ||
    message.includes("sqlite_busy") ||
    message.includes("timed out")
  )
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function findUserForAuth(userId: number) {
  let lastError: unknown
  const attempts = 3
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, username: true, role: true, authTokenVersion: true, disabledAt: true },
      })
    } catch (error) {
      lastError = error
      if (!isTransientDbError(error) || attempt === attempts - 1) {
        throw error
      }
      await sleep(80 * (attempt + 1))
    }
  }
  throw lastError
}

export async function requireAuth(request: NextRequest): Promise<AuthedUser> {
  const token = request.cookies.get("auth_token")?.value
  if (!token) {
    throw new AuthError("Unauthorized", 401)
  }

  const payload = verifyToken(token)
  if (!payload?.userId || !Number.isInteger(payload.userId)) {
    throw new AuthError("Unauthorized", 401)
  }

  const user = await findUserForAuth(payload.userId)
  if (!user || user.disabledAt) {
    throw new AuthError("Unauthorized", 401)
  }

  const tokenVersion = Number.isInteger(payload.tokenVersion) ? payload.tokenVersion : 0
  if (tokenVersion !== user.authTokenVersion) {
    throw new AuthError("Unauthorized", 401)
  }

  return {
    userId: user.id,
    role: user.role,
    username: user.username,
  }
}

export function requireAdmin(user: AuthedUser): void {
  if (user.role !== "admin") {
    throw new AuthError("Forbidden", 403)
  }
}
