import { createHash } from "crypto"
import { NextRequest } from "next/server"

let warnedIgnoredForwardedHeaders = false

function hashClientMaterial(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24)
}

function hasForwardedHeaders(request: NextRequest): boolean {
  return Boolean(
    request.headers.get("x-forwarded-for") ||
      request.headers.get("x-real-ip") ||
      request.headers.get("cf-connecting-ip")
  )
}

function normalizeIp(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ""
  if (trimmed.includes(":") && !trimmed.includes(".")) {
    // IPv6, keep as-is.
    return trimmed.toLowerCase()
  }
  // Strip optional port from IPv4 like "1.2.3.4:5678".
  const noPort = trimmed.replace(/:\d+$/, "")
  return noPort.toLowerCase()
}

function extractTrustedProxyIp(request: NextRequest): string {
  const fromForwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0] || ""
  const candidate =
    fromForwardedFor ||
    request.headers.get("x-real-ip") ||
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("true-client-ip") ||
    ""

  return normalizeIp(candidate)
}

function buildFingerprint(request: NextRequest): string {
  const userAgent = (request.headers.get("user-agent") || "").slice(0, 240)
  const acceptLanguage = (request.headers.get("accept-language") || "").slice(0, 120)
  const acceptEncoding = (request.headers.get("accept-encoding") || "").slice(0, 120)
  const secChUa = (request.headers.get("sec-ch-ua") || "").slice(0, 120)
  const secFetchSite = (request.headers.get("sec-fetch-site") || "").slice(0, 40)

  return [userAgent, acceptLanguage, acceptEncoding, secChUa, secFetchSite].join("|")
}

export function getClientIdentifier(request: NextRequest, namespace: string): string {
  const trustProxy = process.env.TRUST_PROXY === "1"

  if (trustProxy) {
    const ip = extractTrustedProxyIp(request)
    const material = ip ? `ip:${ip}` : `fallback:${buildFingerprint(request)}`
    return `${namespace}:${hashClientMaterial(material)}`
  }

  if (
    process.env.NODE_ENV === "production" &&
    hasForwardedHeaders(request) &&
    !warnedIgnoredForwardedHeaders
  ) {
    warnedIgnoredForwardedHeaders = true
    console.warn("[security] Forwarded IP headers detected but TRUST_PROXY=0; using fingerprint fallback for rate limiting.")
  }

  return `${namespace}:${hashClientMaterial(buildFingerprint(request))}`
}
