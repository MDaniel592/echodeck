import { NextRequest, NextResponse } from "next/server"
import { verifyToken } from "./lib/auth"

const PUBLIC_PATHS = [
  "/api/auth/",
  "/api/subsonic/",
  "/login",
  "/setup",
  "/_next/",
  "/favicon.ico",
  "/EchoDeck.png",
]

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname.startsWith(p))
}

function splitForwardedValues(value: string | null): string[] {
  if (!value) return []
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function originMatchesConfiguredAllowlist(origin: URL): boolean {
  const configured = splitForwardedValues(process.env.CSRF_TRUSTED_ORIGINS ?? null)
  if (configured.length === 0) return false

  const normalizedOrigin = origin.origin.toLowerCase()
  const normalizedHost = origin.host.toLowerCase()

  return configured.some((entry) => {
    const normalizedEntry = entry.toLowerCase()
    if (normalizedEntry === normalizedOrigin || normalizedEntry === normalizedHost) {
      return true
    }
    try {
      return new URL(entry).origin.toLowerCase() === normalizedOrigin
    } catch {
      return false
    }
  })
}

function isSameOriginMutation(request: NextRequest, originHeader: string): boolean {
  let origin: URL
  try {
    origin = new URL(originHeader)
  } catch {
    return false
  }

  if (origin.origin === request.nextUrl.origin) {
    return true
  }

  if (originMatchesConfiguredAllowlist(origin)) {
    return true
  }

  // Only trust forwarded host/proto when explicitly running behind a trusted proxy.
  if (process.env.TRUST_PROXY !== "1") {
    return false
  }

  const forwardedHosts = splitForwardedValues(request.headers.get("x-forwarded-host")).map((host) => host.toLowerCase())
  if (forwardedHosts.length === 0) return false

  const originHost = origin.host.toLowerCase()
  const hostMatch = forwardedHosts.some((host) => host === originHost)
  if (!hostMatch) return false

  const forwardedProtos = splitForwardedValues(request.headers.get("x-forwarded-proto"))
    .map((proto) => proto.toLowerCase())
  if (forwardedProtos.length === 0) return true

  const originProto = origin.protocol.replace(/:$/, "").toLowerCase()
  return forwardedProtos.some((proto) => proto === originProto)
}

function hasCrossOriginApiMutation(request: NextRequest): boolean {
  const method = request.method.toUpperCase()
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return false

  const { pathname } = request.nextUrl
  if (!pathname.startsWith("/api/")) return false
  if (pathname.startsWith("/api/subsonic/")) return false

  const originHeader = request.headers.get("origin")
  if (!originHeader) return false

  return !isSameOriginMutation(request, originHeader)
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (hasCrossOriginApiMutation(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next()
  }

  const token = request.cookies.get("auth_token")?.value

  if (!token || !verifyToken(token)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const loginUrl = new URL("/login", request.url)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
}
