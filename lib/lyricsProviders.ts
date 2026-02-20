import { appendFileSync, mkdirSync, readFileSync } from "fs"
import { dirname, join } from "path"
import { createHmac } from "crypto"
import { safeFetch } from "./safeFetch"
import { normalizeToken, stripAllTags, toAscii } from "./songTitle"

const MAX_LYRICS_LENGTH = 20_000
export const DEFAULT_BUDGET_MS = 6_000
const FETCH_MAX_BYTES = 512_000
const MUSIXMATCH_LYRICS_ENABLED = !/^(0|false|no|off)$/i.test(
  (process.env.MUSIXMATCH_LYRICS_ENABLED || "1").trim()
)
const MUSIXMATCH_SECRET_TTL_MS = 6 * 60 * 60 * 1000
const MUSIXMATCH_BASE_URL = "https://www.musixmatch.com/ws/1.1/"
const MUSIXMATCH_APP_ID = "web-desktop-app-v1.0"
const MUSIXMATCH_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
const MUSIXMATCH_MOBILE_LYRICS_ENABLED = !/^(0|false|no|off)$/i.test(
  (process.env.MUSIXMATCH_MOBILE_LYRICS_ENABLED || "1").trim()
)
const MUSIXMATCH_MOBILE_BASE_URL = "https://apic-appmobile.musixmatch.com/ws/1.1/"
const MUSIXMATCH_MOBILE_APP_ID = (process.env.MUSIXMATCH_MOBILE_APP_ID || "mac-ios-v2.0").trim()
const MUSIXMATCH_MOBILE_APP_VERSION = (process.env.MUSIXMATCH_MOBILE_APP_VERSION || "1.37.2").trim()
const MUSIXMATCH_MOBILE_USER_AGENT =
  (process.env.MUSIXMATCH_MOBILE_USER_AGENT || "Musixmatch/2025120901 CFNetwork/3860.300.31 Darwin/25.2.0").trim()
const MUSIXMATCH_MOBILE_TOKEN_TTL_MS = 6 * 60 * 60 * 1000
const MUSIXMATCH_TOKENS_JSON = (process.env.MUSIXMATCH_TOKENS_JSON || "").trim()
const GENIUS_LYRICS_ENABLED = !/^(0|false|no|off)$/i.test(
  (process.env.GENIUS_LYRICS_ENABLED || "1").trim()
)
const GENIUS_ACCESS_TOKEN = (
  process.env.GENIUS_ACCESS_TOKEN ||
  process.env.GENIUS_CLIENT_ACCESS_TOKEN ||
  ""
).trim()
const GENIUS_API_BASE_URL = "https://api.genius.com"
const LYRICS_SEARCH_FILE_LOGGING = process.env.NODE_ENV !== "test" && !/^(0|false|no|off)$/i.test(
  (process.env.LYRICS_SEARCH_FILE_LOGGING || "1").trim()
)
const LYRICS_SEARCH_LOG_PATH = (process.env.LYRICS_SEARCH_LOG_PATH || join(process.cwd(), "logs", "lyrics-search.jsonl")).trim()

// Build User-Agent from package.json at module load
const LYRICS_USER_AGENT = (() => {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"))
    return `${pkg.name}/${pkg.version}`
  } catch {
    return "EchoDeck/unknown"
  }
})()

type LrcLibSearchResult = {
  trackName?: string
  artistName?: string
  duration?: number
  plainLyrics?: string
  syncedLyrics?: string
}

type MusixmatchTrack = {
  track_id?: number
  track_name?: string
  artist_name?: string
  track_length?: number
  has_lyrics?: number
}

type MusixmatchTrackSearchPayload = {
  message?: {
    body?: {
      track_list?: Array<{ track?: MusixmatchTrack } | MusixmatchTrack>
    }
  }
}

type MusixmatchLyricsPayload = {
  message?: {
    body?: {
      lyrics?: {
        lyrics_body?: string
      }
    }
  }
}

type MusixmatchMobileTokenPayload = {
  message?: {
    body?: {
      user_token?: string
    }
  }
}

type GeniusSongResult = {
  id?: number
  title?: string
  full_title?: string
  artist_names?: string
  url?: string
  path?: string
  primary_artist?: {
    name?: string
  }
}

type GeniusSearchPayload = {
  response?: {
    hits?: Array<{
      type?: string
      result?: GeniusSongResult
    }>
  }
}

export type LookupQuery = {
  title: string
  artist: string
  album: string
  duration: number | null
}

const TITLE_SEGMENT_SEPARATOR = /\s+(?:-|–|—|\||｜|•|·|:)\s+/u

let musixmatchSecretCache: { value: string; fetchedAt: number } | null = null
let musixmatchMobileTokenCache: { value: string; fetchedAt: number } | null = null
let lyricsSearchLogReady = false

export function appendLyricsSearchLog(event: string, payload: Record<string, unknown>): void {
  if (!LYRICS_SEARCH_FILE_LOGGING) return
  try {
    if (!lyricsSearchLogReady) {
      mkdirSync(dirname(LYRICS_SEARCH_LOG_PATH), { recursive: true })
      lyricsSearchLogReady = true
    }
    const line = JSON.stringify({
      at: new Date().toISOString(),
      event,
      ...payload,
    })
    appendFileSync(LYRICS_SEARCH_LOG_PATH, `${line}\n`, "utf8")
  } catch {
    // Intentionally ignore logging failures.
  }
}

function cleanLyrics(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, MAX_LYRICS_LENGTH)
}

export function segmentTitle(value: string): string | null {
  const parts = value
    .split(TITLE_SEGMENT_SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length < 2) return null
  return parts[0] || null
}

export function trimDanglingSeparators(value: string): string {
  return value
    .replace(/\s*(?:-|–|—|\||｜|•|·|:)\s*$/u, "")
    .replace(/\s{2,}/g, " ")
    .trim()
}

export function uniqueByNormalized(values: Array<string | null | undefined>): string[] {
  const unique: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const trimmed = (value || "").trim()
    if (!trimmed) continue
    const key = normalizeToken(trimmed)
    if (!key || seen.has(key)) continue
    seen.add(key)
    unique.push(trimmed)
  }
  return unique
}

export function splitArtistTokens(value: string): string[] {
  const normalized = value
    .replace(/\b(?:feat\.?|ft\.?|featuring|with|w\/|con)\b/giu, ",")
    .replace(/\s+x\s+/giu, ",")
    .replace(/[&+\/|｜]/gu, ",")

  return uniqueByNormalized(
    normalized
      .split(",")
      .map((part) => trimDanglingSeparators(stripAllTags(part)))
      .filter(Boolean)
  )
}

function cleanMusixmatchLyrics(value: unknown): string | null {
  if (typeof value !== "string") return null
  const withoutDisclaimer = value
    .replace(/\n?\*+\s*This Lyrics is NOT for Commercial use\s*\*+.*$/i, "")
    .replace(/\n?This Lyrics is NOT for Commercial use.*$/i, "")
  return cleanLyrics(withoutDisclaimer)
}

function parseMusixmatchMobileUserTokenEnv(rawValue: string, appIdHint?: string): string | null {
  const value = rawValue.trim()
  if (!value) return null

  // Plain token value.
  if (!value.startsWith("{") && !value.startsWith("[")) {
    return value
  }

  try {
    const parsed = JSON.parse(value) as {
      user_token?: unknown
      message?: { body?: { user_token?: unknown } }
      tokens?: Record<string, unknown>
    }
    const direct = typeof parsed.user_token === "string" ? parsed.user_token.trim() : ""
    if (direct) return direct
    const nested = typeof parsed.message?.body?.user_token === "string"
      ? parsed.message.body.user_token.trim()
      : ""
    if (nested) return nested
    if (parsed.tokens && typeof parsed.tokens === "object") {
      const preferredKeys = [
        appIdHint || "",
        "mxm-account-v1.0",
        "web-desktop-app-v1.0",
      ].filter(Boolean)
      for (const key of preferredKeys) {
        const candidate = parsed.tokens[key]
        if (typeof candidate === "string" && candidate.trim()) {
          return candidate.trim()
        }
      }
      for (const candidate of Object.values(parsed.tokens)) {
        if (typeof candidate === "string" && candidate.trim()) {
          return candidate.trim()
        }
      }
    }
    return null
  } catch {
    return value
  }
}

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: "\"",
  apos: "'",
  nbsp: " ",
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, dec: string) => {
      const code = Number.parseInt(dec, 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : _
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const code = Number.parseInt(hex, 16)
      return Number.isFinite(code) ? String.fromCodePoint(code) : _
    })
    .replace(/&([a-z][a-z0-9]+);/gi, (full, name: string) => HTML_ENTITIES[name.toLowerCase()] || full)
}

function decodeJsQuotedStringLiteral(value: string): string {
  let out = ""
  for (let idx = 0; idx < value.length; idx += 1) {
    const ch = value[idx]
    if (ch !== "\\") {
      out += ch
      continue
    }
    idx += 1
    if (idx >= value.length) {
      out += "\\"
      break
    }
    const esc = value[idx]
    if (esc === "n") out += "\n"
    else if (esc === "r") out += "\r"
    else if (esc === "t") out += "\t"
    else if (esc === "b") out += "\b"
    else if (esc === "f") out += "\f"
    else if (esc === "v") out += "\v"
    else if (esc === "0") out += "\0"
    else if (esc === "'" || esc === "\"" || esc === "\\") out += esc
    else if (esc === "x") {
      const hex = value.slice(idx + 1, idx + 3)
      if (/^[\da-f]{2}$/i.test(hex)) {
        out += String.fromCodePoint(Number.parseInt(hex, 16))
        idx += 2
      } else {
        out += "x"
      }
    } else if (esc === "u") {
      const hex = value.slice(idx + 1, idx + 5)
      if (/^[\da-f]{4}$/i.test(hex)) {
        out += String.fromCodePoint(Number.parseInt(hex, 16))
        idx += 4
      } else {
        out += "u"
      }
    } else if (esc === "\n") {
      // JS line continuation.
    } else if (esc === "\r") {
      if (value[idx + 1] === "\n") idx += 1
    } else {
      out += esc
    }
  }
  return out
}

function extractJsonFromWindowAssignment(html: string, assignmentPrefix: string): unknown | null {
  const idx = html.indexOf(assignmentPrefix)
  if (idx < 0) return null

  const parseCallStart = html.indexOf("JSON.parse(", idx)
  if (parseCallStart < 0) return null

  let cursor = parseCallStart + "JSON.parse(".length
  while (cursor < html.length && /\s/.test(html[cursor] || "")) cursor += 1
  const quote = html[cursor]
  if (quote !== "'" && quote !== "\"") return null

  cursor += 1
  let raw = ""
  let escaped = false
  for (; cursor < html.length; cursor += 1) {
    const ch = html[cursor]
    if (!escaped && ch === quote) break
    raw += ch
    if (escaped) escaped = false
    else if (ch === "\\") escaped = true
  }
  if (cursor >= html.length) return null

  const decoded = decodeJsQuotedStringLiteral(raw)
  return JSON.parse(decoded) as unknown
}

function stripHtmlToText(value: string): string {
  const withBreaks = value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
  const decoded = decodeHtmlEntities(withBreaks)
  return decoded
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function extractGeniusLyricsFromPage(html: string): string | null {
  try {
    const payload = extractJsonFromWindowAssignment(html, "window.__PRELOADED_STATE__")
    if (payload && typeof payload === "object") {
      const lyricsHtml = (payload as {
        songPage?: {
          lyricsData?: {
            body?: {
              html?: unknown
            }
          }
        }
      }).songPage?.lyricsData?.body?.html
      if (typeof lyricsHtml === "string" && lyricsHtml.trim()) {
        return stripHtmlToText(lyricsHtml)
      }
    }
  } catch {
    // Ignore parse errors and fallback to data-lyrics-container.
  }

  const blocks = Array.from(
    html.matchAll(/<div[^>]*data-lyrics-container="true"[^>]*>([\s\S]*?)<\/div>/gi)
  )
    .map((match) => stripHtmlToText(match[1] || ""))
    .filter(Boolean)

  if (blocks.length === 0) return null
  return blocks.join("\n").trim()
}

function buildMusixmatchSignature(url: string, secret: string): string {
  const now = new Date()
  const yyyy = String(now.getFullYear())
  const mm = String(now.getMonth() + 1).padStart(2, "0")
  const dd = String(now.getDate()).padStart(2, "0")
  const message = `${url}${yyyy}${mm}${dd}`
  const signature = createHmac("sha256", secret).update(message).digest("base64")
  return `&signature=${encodeURIComponent(signature)}&signature_protocol=sha256`
}

async function getMusixmatchSecret(timeoutMs: number): Promise<string | null> {
  if (!MUSIXMATCH_LYRICS_ENABLED) return null

  if (
    musixmatchSecretCache &&
    Date.now() - musixmatchSecretCache.fetchedAt < MUSIXMATCH_SECRET_TTL_MS
  ) {
    return musixmatchSecretCache.value
  }

  const startedAt = Date.now()
  const remaining = () => Math.max(300, timeoutMs - (Date.now() - startedAt))
  if (remaining() <= 300) return null

  const searchPage = await safeFetch(
    "https://www.musixmatch.com/search",
    {
      headers: {
        "User-Agent": MUSIXMATCH_BROWSER_USER_AGENT,
        Cookie: "mxm_bab=AB",
      },
    },
    {
      timeoutMs: remaining(),
      maxBytes: FETCH_MAX_BYTES,
    }
  ).catch(() => null)
  if (!searchPage?.ok) return null

  const html = await searchPage.text().catch(() => null)
  if (!html) return null

  const appRegex = /src="([^"]*\/_next\/static\/chunks\/pages\/_app-[^"]+\.js)"/g
  let appPath: string | null = null
  for (const match of html.matchAll(appRegex)) {
    appPath = match[1] || appPath
  }
  if (!appPath) return null

  const appUrl = new URL(appPath, "https://www.musixmatch.com/search").toString()
  const appScript = await safeFetch(
    appUrl,
    {
      headers: {
        "User-Agent": MUSIXMATCH_BROWSER_USER_AGENT,
        Cookie: "mxm_bab=AB",
      },
    },
    {
      timeoutMs: remaining(),
      maxBytes: FETCH_MAX_BYTES,
    }
  ).catch(() => null)
  if (!appScript?.ok) return null

  const js = await appScript.text().catch(() => null)
  if (!js) return null

  const encodedMatch = js.match(/from\(\s*"([^"]+)"\s*\.split/)
  if (!encodedMatch?.[1]) return null

  const reversed = encodedMatch[1].split("").reverse().join("")
  const secret = Buffer.from(reversed, "base64").toString("utf8").trim()
  if (!secret) return null

  musixmatchSecretCache = { value: secret, fetchedAt: Date.now() }
  return secret
}

async function musixmatchRequest(
  endpoint: string,
  params: URLSearchParams,
  timeoutMs: number
): Promise<unknown | null> {
  if (!MUSIXMATCH_LYRICS_ENABLED) return null

  const secret = await getMusixmatchSecret(timeoutMs).catch(() => null)
  if (!secret) return null

  const normalizedParams = new URLSearchParams(params.toString())
  normalizedParams.set("app_id", MUSIXMATCH_APP_ID)
  normalizedParams.set("format", "json")

  const url = `${MUSIXMATCH_BASE_URL}${endpoint}?${normalizedParams.toString()}`
  const signedUrl = `${url}${buildMusixmatchSignature(url, secret)}`

  const response = await safeFetch(
    signedUrl,
    {
      headers: {
        "User-Agent": MUSIXMATCH_BROWSER_USER_AGENT,
        Cookie: "mxm_bab=AB",
      },
    },
    {
      allowedContentTypes: ["application/json"],
      timeoutMs,
      maxBytes: FETCH_MAX_BYTES,
    }
  ).catch(() => null)
  if (!response?.ok) return null

  return response.json().catch(() => null)
}

async function getMusixmatchMobileUserToken(timeoutMs: number): Promise<string | null> {
  if (!MUSIXMATCH_MOBILE_LYRICS_ENABLED) return null

  const explicitToken = parseMusixmatchMobileUserTokenEnv(
    process.env.MUSIXMATCH_MOBILE_USERTOKEN || "",
    MUSIXMATCH_MOBILE_APP_ID
  )
  if (explicitToken) return explicitToken
  const bundleToken = parseMusixmatchMobileUserTokenEnv(MUSIXMATCH_TOKENS_JSON, MUSIXMATCH_MOBILE_APP_ID)
  if (bundleToken) return bundleToken

  if (
    musixmatchMobileTokenCache &&
    Date.now() - musixmatchMobileTokenCache.fetchedAt < MUSIXMATCH_MOBILE_TOKEN_TTL_MS
  ) {
    return musixmatchMobileTokenCache.value
  }

  const url = `${MUSIXMATCH_MOBILE_BASE_URL}token.get?app_id=${encodeURIComponent(MUSIXMATCH_MOBILE_APP_ID)}`
  const response = await safeFetch(
    url,
    {
      headers: {
        Accept: "application/json",
        "x-mxm-app-version": MUSIXMATCH_MOBILE_APP_VERSION,
        "User-Agent": MUSIXMATCH_MOBILE_USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9",
        Connection: "keep-alive",
      },
    },
    {
      allowedContentTypes: ["application/json"],
      timeoutMs,
      maxBytes: FETCH_MAX_BYTES,
    }
  ).catch(() => null)
  if (!response?.ok) return null

  const payload = (await response.json().catch(() => null)) as MusixmatchMobileTokenPayload | null
  const userToken = (payload?.message?.body?.user_token || "").trim()
  if (!userToken) return null

  musixmatchMobileTokenCache = { value: userToken, fetchedAt: Date.now() }
  return userToken
}

async function musixmatchMobileRequest(
  endpoint: string,
  params: URLSearchParams,
  timeoutMs: number
): Promise<unknown | null> {
  if (!MUSIXMATCH_MOBILE_LYRICS_ENABLED) return null

  const userToken = await getMusixmatchMobileUserToken(timeoutMs).catch(() => null)
  if (!userToken) return null

  const normalizedParams = new URLSearchParams(params.toString())
  normalizedParams.set("app_id", MUSIXMATCH_MOBILE_APP_ID)
  normalizedParams.set("usertoken", userToken)
  normalizedParams.set("format", "json")

  const url = `${MUSIXMATCH_MOBILE_BASE_URL}${endpoint}?${normalizedParams.toString()}`
  const response = await safeFetch(
    url,
    {
      headers: {
        Accept: "application/json",
        "x-mxm-app-version": MUSIXMATCH_MOBILE_APP_VERSION,
        "User-Agent": MUSIXMATCH_MOBILE_USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9",
        Connection: "keep-alive",
      },
    },
    {
      allowedContentTypes: ["application/json"],
      timeoutMs,
      maxBytes: FETCH_MAX_BYTES,
    }
  ).catch(() => null)
  if (!response?.ok) return null

  return response.json().catch(() => null)
}

function collectMusixmatchTracks(node: unknown, tracks: MusixmatchTrack[], depth = 0): void {
  if (depth > 6 || !node) return

  if (Array.isArray(node)) {
    for (const item of node) {
      collectMusixmatchTracks(item, tracks, depth + 1)
    }
    return
  }

  if (typeof node !== "object") return

  const track = normalizeMusixmatchTrack(node)
  if (track?.track_id && (track.track_name || track.artist_name)) {
    tracks.push(track)
  }

  for (const value of Object.values(node as Record<string, unknown>)) {
    if (value && typeof value === "object") {
      collectMusixmatchTracks(value, tracks, depth + 1)
    }
  }
}

function extractMusixmatchTracks(payload: unknown): MusixmatchTrack[] {
  const tracks: MusixmatchTrack[] = []
  collectMusixmatchTracks(payload, tracks, 0)
  const uniqueByTrackId = new Map<number, MusixmatchTrack>()
  for (const track of tracks) {
    if (typeof track.track_id !== "number") continue
    if (!uniqueByTrackId.has(track.track_id)) {
      uniqueByTrackId.set(track.track_id, track)
    }
  }
  return Array.from(uniqueByTrackId.values())
}

function normalizeMusixmatchTrack(raw: unknown): MusixmatchTrack | null {
  if (!raw || typeof raw !== "object") return null
  const candidate = raw as { track?: unknown }
  const track = candidate.track && typeof candidate.track === "object"
    ? candidate.track as MusixmatchTrack
    : raw as MusixmatchTrack
  if (!track || typeof track !== "object") return null
  return track
}

export async function lookupMusixmatch(query: LookupQuery, timeoutMs: number): Promise<string | null> {
  if (!MUSIXMATCH_LYRICS_ENABLED || !query.title) return null
  appendLyricsSearchLog("provider_attempt", {
    provider: "musixmatch_signed",
    title: query.title,
    artist: query.artist,
    duration: query.duration,
  })

  const baseArtist = query.artist.trim()
  const artistVariants = splitArtistTokens(baseArtist)
  const searchQueries = uniqueByNormalized([
    [baseArtist, query.title].filter(Boolean).join(" "),
    query.title,
    artistVariants[0] ? `${artistVariants[0]} ${query.title}` : null,
  ]).slice(0, 3)

  const normalizedQuery = {
    title: normalizeToken(query.title),
    artist: normalizeToken(baseArtist),
    duration: query.duration,
  }

  const queryAttempts = searchQueries.map(async (searchQuery) => {
    const payload = await musixmatchRequest(
      "track.search",
      new URLSearchParams({
        q: searchQuery,
        f_has_lyrics: "true",
        page_size: "10",
        page: "1",
      }),
      timeoutMs
    ).catch(() => null) as MusixmatchTrackSearchPayload | null

    const trackList = payload?.message?.body?.track_list
    if (!Array.isArray(trackList)) return null

    let localBestTrack: MusixmatchTrack | null = null
    let localBestScore = Number.NEGATIVE_INFINITY
    for (const rawTrack of trackList) {
      const track = normalizeMusixmatchTrack(rawTrack)
      if (!track?.track_id) continue
      if (track.has_lyrics === 0) continue
      const score = scoreCandidate(
        {
          trackName: track.track_name,
          artistName: track.artist_name,
          duration: track.track_length,
          plainLyrics: "has_lyrics",
        },
        normalizedQuery
      )
      if (!localBestTrack || score > localBestScore) {
        localBestTrack = track
        localBestScore = score
      }
    }
    if (!localBestTrack?.track_id) return null

    const lyricsPayload = await musixmatchRequest(
      "track.lyrics.get",
      new URLSearchParams({
        track_id: String(localBestTrack.track_id),
      }),
      timeoutMs
    ).catch(() => null) as MusixmatchLyricsPayload | null

    const rawLyrics = lyricsPayload?.message?.body?.lyrics?.lyrics_body
    const cleaned = cleanMusixmatchLyrics(rawLyrics)
    if (!cleaned) return null
    return {
      lyrics: cleaned,
      trackId: localBestTrack.track_id,
    }
  })

  const winner = await firstNonNull(queryAttempts)
  if (!winner) {
    appendLyricsSearchLog("provider_miss", {
      provider: "musixmatch_signed",
      reason: "no_track_or_lyrics_match",
      title: query.title,
      artist: query.artist,
    })
    return null
  }

  appendLyricsSearchLog("provider_hit", {
    provider: "musixmatch_signed",
    title: query.title,
    artist: query.artist,
    trackId: winner.trackId,
  })
  return winner.lyrics
}

export async function lookupMusixmatchMobile(query: LookupQuery, timeoutMs: number): Promise<string | null> {
  if (!MUSIXMATCH_MOBILE_LYRICS_ENABLED || !query.title) return null
  appendLyricsSearchLog("provider_attempt", {
    provider: "musixmatch_mobile",
    title: query.title,
    artist: query.artist,
    duration: query.duration,
  })

  const baseArtist = query.artist.trim()
  const artistVariants = splitArtistTokens(baseArtist)
  const searchQueries = uniqueByNormalized([
    [baseArtist, query.title].filter(Boolean).join(" "),
    query.title,
    artistVariants[0] ? `${artistVariants[0]} ${query.title}` : null,
  ]).slice(0, 3)

  const normalizedQuery = {
    title: normalizeToken(query.title),
    artist: normalizeToken(baseArtist),
    duration: query.duration,
  }

  const queryAttempts = searchQueries.map(async (searchQuery) => {
    const payload = await musixmatchMobileRequest(
      "community/opensearch/tracks",
      new URLSearchParams({
        query: searchQuery,
      }),
      timeoutMs
    ).catch(() => null)

    const trackList = extractMusixmatchTracks(payload)
    if (trackList.length === 0) return null

    let localBestTrack: MusixmatchTrack | null = null
    let localBestScore = Number.NEGATIVE_INFINITY
    for (const track of trackList) {
      if (!track?.track_id) continue
      if (track.has_lyrics === 0) continue

      const score = scoreCandidate(
        {
          trackName: track.track_name,
          artistName: track.artist_name,
          duration: track.track_length,
          plainLyrics: "has_lyrics",
        },
        normalizedQuery
      )
      if (!localBestTrack || score > localBestScore) {
        localBestTrack = track
        localBestScore = score
      }
    }
    if (!localBestTrack?.track_id) return null

    const lyricsPayload = await musixmatchMobileRequest(
      "track.lyrics.get",
      new URLSearchParams({
        track_id: String(localBestTrack.track_id),
      }),
      timeoutMs
    ).catch(() => null) as MusixmatchLyricsPayload | null

    const rawLyrics = lyricsPayload?.message?.body?.lyrics?.lyrics_body
    const cleaned = cleanMusixmatchLyrics(rawLyrics)
    if (!cleaned) return null
    return {
      lyrics: cleaned,
      trackId: localBestTrack.track_id,
    }
  })

  const winner = await firstNonNull(queryAttempts)
  if (!winner) {
    appendLyricsSearchLog("provider_miss", {
      provider: "musixmatch_mobile",
      reason: "no_track_or_lyrics_match",
      title: query.title,
      artist: query.artist,
    })
    return null
  }

  appendLyricsSearchLog("provider_hit", {
    provider: "musixmatch_mobile",
    title: query.title,
    artist: query.artist,
    trackId: winner.trackId,
  })
  return winner.lyrics
}

function normalizeGeniusSong(raw: unknown): GeniusSongResult | null {
  if (!raw || typeof raw !== "object") return null
  return raw as GeniusSongResult
}

export async function lookupGenius(query: LookupQuery, timeoutMs: number): Promise<string | null> {
  if (!GENIUS_LYRICS_ENABLED || !GENIUS_ACCESS_TOKEN || !query.title) return null
  appendLyricsSearchLog("provider_attempt", {
    provider: "genius",
    title: query.title,
    artist: query.artist,
    duration: query.duration,
  })

  const baseArtist = query.artist.trim()
  const artistVariants = splitArtistTokens(baseArtist)
  const searchQueries = uniqueByNormalized([
    [baseArtist, query.title].filter(Boolean).join(" "),
    query.title,
    artistVariants[0] ? `${artistVariants[0]} ${query.title}` : null,
  ]).slice(0, 3)

  const normalizedQuery = {
    title: normalizeToken(query.title),
    artist: normalizeToken(baseArtist),
    duration: query.duration,
  }

  const queryAttempts = searchQueries.map(async (searchQuery) => {
    const response = await safeFetch(
      `${GENIUS_API_BASE_URL}/search?${new URLSearchParams({ q: searchQuery }).toString()}`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${GENIUS_ACCESS_TOKEN}`,
          "User-Agent": LYRICS_USER_AGENT,
        },
      },
      {
        allowedContentTypes: ["application/json"],
        timeoutMs,
        maxBytes: FETCH_MAX_BYTES,
      }
    ).catch(() => null)
    if (!response?.ok) return null

    const payload = (await response.json().catch(() => null)) as GeniusSearchPayload | null
    const hits = payload?.response?.hits
    if (!Array.isArray(hits)) return null

    let localBestSong: GeniusSongResult | null = null
    let localBestScore = Number.NEGATIVE_INFINITY
    for (const hit of hits) {
      if (hit?.type && hit.type !== "song") continue
      const song = normalizeGeniusSong(hit?.result)
      if (!song) continue
      if (!song.url && !song.path) continue
      const score = scoreCandidate(
        {
          trackName: song.title || song.full_title,
          artistName: song.primary_artist?.name || song.artist_names,
          plainLyrics: "has_lyrics",
        },
        normalizedQuery
      )
      if (!localBestSong || score > localBestScore) {
        localBestSong = song
        localBestScore = score
      }
    }

    const songUrl = (localBestSong?.url || (localBestSong?.path ? `https://genius.com${localBestSong.path}` : "")).trim()
    if (!songUrl) return null

    const pageResponse = await safeFetch(
      songUrl,
      {
        headers: {
          "User-Agent": MUSIXMATCH_BROWSER_USER_AGENT,
        },
      },
      {
        timeoutMs,
        maxBytes: FETCH_MAX_BYTES,
      }
    ).catch(() => null)
    if (!pageResponse?.ok) return null

    const pageHtml = await pageResponse.text().catch(() => "")
    const extracted = pageHtml ? extractGeniusLyricsFromPage(pageHtml) : null
    const cleaned = cleanLyrics(extracted)
    if (!cleaned) return null
    return {
      lyrics: cleaned,
      songId: localBestSong?.id || null,
    }
  })

  const winner = await firstNonNull(queryAttempts)
  if (!winner) {
    appendLyricsSearchLog("provider_miss", {
      provider: "genius",
      reason: "no_song_or_lyrics_match",
      title: query.title,
      artist: query.artist,
    })
    return null
  }
  appendLyricsSearchLog("provider_hit", {
    provider: "genius",
    title: query.title,
    artist: query.artist,
    songId: winner.songId,
  })
  return winner.lyrics
}

function scoreCandidate(
  candidate: LrcLibSearchResult,
  query: { title: string; artist: string; duration: number | null }
): number {
  const candidateTitle = normalizeToken(candidate.trackName || "")
  const candidateArtist = normalizeToken(candidate.artistName || "")

  let score = 0
  if (candidateTitle && candidateTitle === query.title) score += 5
  if (candidateArtist && candidateArtist === query.artist) score += 5
  if (candidateTitle && query.title && (candidateTitle.includes(query.title) || query.title.includes(candidateTitle))) {
    score += 2
  }
  if (candidateArtist && query.artist && (candidateArtist.includes(query.artist) || query.artist.includes(candidateArtist))) {
    score += 2
  }
  if (typeof candidate.duration === "number" && typeof query.duration === "number") {
    const delta = Math.abs(candidate.duration - query.duration)
    if (delta <= 2) score += 4
    else if (delta <= 5) score += 2
    else if (delta <= 10) score += 1
  }
  return score
}

export async function lookupLrcLib(query: LookupQuery, timeoutMs: number): Promise<string | null> {
  if (!query.title) return null
  appendLyricsSearchLog("provider_attempt", {
    provider: "lrclib",
    title: query.title,
    artist: query.artist,
    album: query.album,
    duration: query.duration,
  })

  const params = new URLSearchParams()
  params.set("track_name", toAscii(query.title) || query.title)
  if (query.artist) params.set("artist_name", toAscii(query.artist) || query.artist)
  if (query.album) params.set("album_name", toAscii(query.album) || query.album)

  const response = await safeFetch(
    `https://lrclib.net/api/search?${params.toString()}`,
    { headers: { "User-Agent": LYRICS_USER_AGENT } },
    {
      allowedContentTypes: ["application/json"],
      timeoutMs,
      maxBytes: FETCH_MAX_BYTES,
    }
  )
  if (!response.ok) {
    appendLyricsSearchLog("provider_miss", { provider: "lrclib", reason: `http_${response.status}`, title: query.title, artist: query.artist })
    return null
  }

  const payload = (await response.json().catch(() => null)) as unknown
  if (!Array.isArray(payload) || payload.length === 0) {
    appendLyricsSearchLog("provider_miss", { provider: "lrclib", reason: "empty_payload", title: query.title, artist: query.artist })
    return null
  }

  const normalizedQuery = {
    title: normalizeToken(query.title),
    artist: normalizeToken(query.artist),
    duration: query.duration,
  }

  let best: { lyrics: string; score: number; candidate: LrcLibSearchResult } | null = null
  for (const raw of payload) {
    if (!raw || typeof raw !== "object") continue
    const candidate = raw as LrcLibSearchResult
    const lyrics = cleanLyrics(candidate.syncedLyrics || candidate.plainLyrics)
    if (!lyrics) continue
    const score = scoreCandidate(candidate, normalizedQuery)
    if (!best || score > best.score) {
      best = { lyrics, score, candidate }
    }
  }

  if (!best) {
    appendLyricsSearchLog("provider_miss", { provider: "lrclib", reason: "no_lyrics_candidate", title: query.title, artist: query.artist })
    return null
  }

  // If artist is unknown, require at least a clear title overlap to reduce false positives.
  if (!normalizedQuery.artist) {
    const bestTitle = normalizeToken(best.candidate.trackName || "")
    const titleMatches =
      bestTitle === normalizedQuery.title ||
      bestTitle.includes(normalizedQuery.title) ||
      normalizedQuery.title.includes(bestTitle)
    if (!bestTitle || !titleMatches) {
      appendLyricsSearchLog("provider_miss", { provider: "lrclib", reason: "title_guard", title: query.title, artist: query.artist })
      return null
    }
  }

  appendLyricsSearchLog("provider_hit", {
    provider: "lrclib",
    title: query.title,
    artist: query.artist,
    matchedTitle: best.candidate.trackName || null,
    matchedArtist: best.candidate.artistName || null,
  })
  return best.lyrics
}

export async function lookupLyricsOvh(query: LookupQuery, timeoutMs: number): Promise<string | null> {
  if (!query.title || !query.artist) return null
  appendLyricsSearchLog("provider_attempt", {
    provider: "lyrics_ovh",
    title: query.title,
    artist: query.artist,
  })
  const response = await safeFetch(
    `https://api.lyrics.ovh/v1/${encodeURIComponent(query.artist)}/${encodeURIComponent(query.title)}`,
    { headers: { "User-Agent": LYRICS_USER_AGENT } },
    {
      allowedContentTypes: ["application/json"],
      timeoutMs,
      maxBytes: FETCH_MAX_BYTES,
    }
  )
  if (!response.ok) {
    appendLyricsSearchLog("provider_miss", { provider: "lyrics_ovh", reason: `http_${response.status}`, title: query.title, artist: query.artist })
    return null
  }
  const payload = (await response.json().catch(() => null)) as unknown
  if (!payload || typeof payload !== "object") {
    appendLyricsSearchLog("provider_miss", { provider: "lyrics_ovh", reason: "invalid_payload", title: query.title, artist: query.artist })
    return null
  }
  const rawLyrics = (payload as { lyrics?: unknown }).lyrics
  const cleaned = cleanLyrics(rawLyrics)
  if (cleaned) {
    appendLyricsSearchLog("provider_hit", { provider: "lyrics_ovh", title: query.title, artist: query.artist })
  } else {
    appendLyricsSearchLog("provider_miss", { provider: "lyrics_ovh", reason: "empty_lyrics", title: query.title, artist: query.artist })
  }
  return cleaned
}

export function firstNonNull<T>(promises: Array<Promise<T | null>>): Promise<T | null> {
  if (promises.length === 0) return Promise.resolve(null)

  return new Promise((resolve) => {
    let pending = promises.length
    let resolved = false

    const settle = (value: T | null) => {
      if (resolved) return
      if (value) {
        resolved = true
        resolve(value)
        return
      }
      pending -= 1
      if (pending === 0) {
        resolve(null)
      }
    }

    for (const promise of promises) {
      promise.then(settle).catch(() => settle(null))
    }
  })
}
