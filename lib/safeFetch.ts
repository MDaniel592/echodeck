import { URL } from "url"
import dns from "dns/promises"
import net from "net"

const MAX_REDIRECTS = 5
const DEFAULT_TIMEOUT_MS = 15_000
const MAX_RESPONSE_BYTES = 50 * 1024 * 1024 // 50 MB

const ALLOWED_HOSTS = new Set([
  // Spotify
  "open.spotify.com",
  "i.scdn.co",
  "api.spotify.com",
  // YouTube
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
  "m.youtube.com",
  "music.youtube.com",
  "i.ytimg.com",
  "img.youtube.com",
  // SoundCloud
  "soundcloud.com",
  "www.soundcloud.com",
  "on.soundcloud.com",
  "i1.sndcdn.com",
  // GitHub (for binary updates)
  "api.github.com",
  "github.com",
  "objects.githubusercontent.com",
  // Third-party music APIs used by spotdl
  "api.lucida.to",
  "spotify.afkarxyz.fun",
  "api.song.link",
  "amazon.afkarxyz.fun",
  "triton.squid.wtf",
  "hifi-one.spotisaver.net",
  "hifi-two.spotisaver.net",
  "tidal.kinoplus.online",
  "tidal-api.binimum.org",
  // Lyrics
  "lrclib.net",
  "www.lrclib.net",
  "api.genius.com",
  "genius.com",
  "www.genius.com",
])

const ALLOWED_HOST_SUFFIXES = [
  ".googleusercontent.com",
  ".ytimg.com",
  ".scdn.co",
  ".sndcdn.com",
]

function isAllowlistedHost(hostname: string): boolean {
  if (ALLOWED_HOSTS.has(hostname)) return true
  return ALLOWED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number)
    // 10.0.0.0/8
    if (parts[0] === 10) return true
    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true
    // 127.0.0.0/8
    if (parts[0] === 127) return true
    // 169.254.0.0/16 (link-local)
    if (parts[0] === 169 && parts[1] === 254) return true
    // 0.0.0.0
    if (parts[0] === 0) return true
    return false
  }

  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase()
    if (normalized === "::1") return true
    if (normalized.startsWith("fe80:")) return true // link-local
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true // ULA
    if (normalized === "::") return true
    return false
  }

  return false
}

async function validateHost(hostname: string): Promise<void> {
  // If hostname is a raw IP, check directly
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error(`Blocked request to private IP: ${hostname}`)
    }
    return
  }

  // Resolve DNS and check all addresses
  try {
    const addresses = await dns.resolve4(hostname)
    for (const addr of addresses) {
      if (isPrivateIp(addr)) {
        throw new Error(`Blocked request: ${hostname} resolves to private IP ${addr}`)
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Blocked")) throw error
    // DNS resolution failed — let fetch handle it
  }
}

export interface SafeFetchOptions {
  /** Maximum response size in bytes (default: 50MB) */
  maxBytes?: number
  /** Timeout in milliseconds (default: 15s) */
  timeoutMs?: number
  /** Maximum redirects to follow (default: 5) */
  maxRedirects?: number
  /** Allowed content type prefixes (e.g. ["image/", "application/json"]) */
  allowedContentTypes?: string[]
  /** Skip host allowlist check (for known-safe internal use only) */
  skipHostCheck?: boolean
}

export async function safeFetch(
  url: string,
  init?: RequestInit,
  options?: SafeFetchOptions
): Promise<Response> {
  const maxRedirects = options?.maxRedirects ?? MAX_REDIRECTS
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = options?.maxBytes ?? MAX_RESPONSE_BYTES
  const allowedContentTypes = options?.allowedContentTypes
  const skipHostCheck = options?.skipHostCheck ?? false

  let currentUrl = url
  let redirectCount = 0

  while (true) {
    const parsed = new URL(currentUrl)

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error(`Blocked request: unsupported protocol ${parsed.protocol}`)
    }

    if (!skipHostCheck && !isAllowlistedHost(parsed.hostname)) {
      throw new Error(`Blocked request: host ${parsed.hostname} is not allowlisted`)
    }

    await validateHost(parsed.hostname)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(currentUrl, {
        ...init,
        signal: controller.signal,
        redirect: "manual",
      })

      // Handle redirects manually to re-validate each hop
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location")
        if (!location) {
          throw new Error("Redirect with no Location header")
        }

        redirectCount++
        if (redirectCount > maxRedirects) {
          throw new Error(`Too many redirects (max ${maxRedirects})`)
        }

        // Resolve relative redirects
        currentUrl = new URL(location, currentUrl).toString()
        continue
      }

      // Validate content type if restrictions specified
      if (allowedContentTypes && response.ok) {
        const contentType = response.headers.get("content-type") || ""
        const isAllowed = allowedContentTypes.some((prefix) =>
          contentType.toLowerCase().startsWith(prefix.toLowerCase())
        )
        if (!isAllowed) {
          throw new Error(
            `Blocked response: content-type "${contentType}" not in allowed list`
          )
        }
      }

      // Check Content-Length if available
      const contentLength = response.headers.get("content-length")
      if (contentLength) {
        const size = Number(contentLength)
        if (size > maxBytes) {
          throw new Error(
            `Response too large: ${size} bytes (max ${maxBytes})`
          )
        }
      }

      return response
    } finally {
      clearTimeout(timeout)
    }
  }
}

/**
 * Convenience wrapper that fetches and returns the buffer,
 * enforcing the size limit during streaming.
 */
export async function safeFetchBuffer(
  url: string,
  init?: RequestInit,
  options?: SafeFetchOptions
): Promise<{ buffer: Buffer; contentType: string | null }> {
  const maxBytes = options?.maxBytes ?? MAX_RESPONSE_BYTES
  const response = await safeFetch(url, init, options)

  if (!response.ok) {
    throw new Error(`Fetch failed: HTTP ${response.status}`)
  }

  const chunks: Uint8Array[] = []
  let totalSize = 0

  if (response.body) {
    const reader = response.body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        totalSize += value.byteLength
        if (totalSize > maxBytes) {
          reader.cancel()
          throw new Error(`Response exceeded size limit of ${maxBytes} bytes`)
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }
  }

  return {
    buffer: Buffer.concat(chunks),
    contentType: response.headers.get("content-type"),
  }
}
