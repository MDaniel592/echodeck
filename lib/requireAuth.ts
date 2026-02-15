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

export async function requireAuth(request: NextRequest): Promise<AuthedUser> {
  const token = request.cookies.get("auth_token")?.value
  if (!token) {
    throw new AuthError("Unauthorized", 401)
  }

  const payload = verifyToken(token)
  if (!payload?.userId || !Number.isInteger(payload.userId)) {
    throw new AuthError("Unauthorized", 401)
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, username: true, role: true, disabledAt: true },
  })
  if (!user || user.disabledAt) {
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
