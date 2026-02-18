import { NextRequest, NextResponse } from "next/server"
import prisma from "../../../../lib/prisma"
import { verifyPassword, createToken } from "../../../../lib/auth"
import { encryptSubsonicPassword } from "../../../../lib/subsonicPassword"
import { checkRateLimit, peekRateLimit } from "../../../../lib/rateLimit"
import { getClientIdentifier } from "../../../../lib/clientIdentity"

const LOGIN_MAX_ATTEMPTS_PER_ACCOUNT = 10
const LOGIN_MAX_ATTEMPTS_PER_CLIENT = 50
const LOGIN_WINDOW_MS = 15 * 60 * 1000 // 15 minutes
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const username = typeof body?.username === "string" ? body.username.trim() : ""
    const password = typeof body?.password === "string" ? body.password : ""

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username and password are required" },
        { status: 400 }
      )
    }

    const client = getClientIdentifier(request, "login")
    const clientKey = `login:client:${client}`
    const accountKey = `login:account:${username.toLowerCase()}`

    const perClientLimit = await peekRateLimit(
      clientKey,
      LOGIN_MAX_ATTEMPTS_PER_CLIENT,
      LOGIN_WINDOW_MS
    )
    if (!perClientLimit.allowed) {
      return NextResponse.json(
        { error: `Too many login attempts. Try again in ${perClientLimit.retryAfterSeconds}s.` },
        {
          status: 429,
          headers: {
            "Retry-After": String(perClientLimit.retryAfterSeconds),
          },
        }
      )
    }

    const accountLimit = await peekRateLimit(
      accountKey,
      LOGIN_MAX_ATTEMPTS_PER_ACCOUNT,
      LOGIN_WINDOW_MS
    )
    if (!accountLimit.allowed) {
      return NextResponse.json(
        { error: `Too many login attempts. Try again in ${accountLimit.retryAfterSeconds}s.` },
        {
          status: 429,
          headers: {
            "Retry-After": String(accountLimit.retryAfterSeconds),
          },
        }
      )
    }

    const user = await prisma.user.findUnique({
      where: { username },
      select: { id: true, passwordHash: true, subsonicPasswordEnc: true, authTokenVersion: true, disabledAt: true },
    })
    if (!user) {
      await Promise.all([
        checkRateLimit(clientKey, LOGIN_MAX_ATTEMPTS_PER_CLIENT, LOGIN_WINDOW_MS),
        checkRateLimit(accountKey, LOGIN_MAX_ATTEMPTS_PER_ACCOUNT, LOGIN_WINDOW_MS),
      ])
      return NextResponse.json(
        { error: "Invalid username or password" },
        { status: 401 }
      )
    }
    if (user.disabledAt) {
      return NextResponse.json(
        { error: "Account is disabled" },
        { status: 403 }
      )
    }

    const valid = await verifyPassword(password, user.passwordHash)
    if (!valid) {
      await Promise.all([
        checkRateLimit(clientKey, LOGIN_MAX_ATTEMPTS_PER_CLIENT, LOGIN_WINDOW_MS),
        checkRateLimit(accountKey, LOGIN_MAX_ATTEMPTS_PER_ACCOUNT, LOGIN_WINDOW_MS),
      ])
      return NextResponse.json(
        { error: "Invalid username or password" },
        { status: 401 }
      )
    }

    const encrypted = encryptSubsonicPassword(password)
    if (encrypted) {
      await prisma.user.update({
        where: { id: user.id },
        data: { subsonicPasswordEnc: encrypted },
      }).catch(() => {})
    }

    const token = createToken(user.id, user.authTokenVersion)

    const response = NextResponse.json({ success: true })
    response.cookies.set("auth_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    })

    return response
  } catch (error) {
    console.error("Login error:", error)
    return NextResponse.json(
      { error: "Login failed" },
      { status: 500 }
    )
  }
}
