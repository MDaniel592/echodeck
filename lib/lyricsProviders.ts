import { appendFileSync, mkdirSync, readFileSync } from "fs"
import { dirname, join } from "path"
import { safeFetch } from "./safeFetch"
import { normalizeToken, stripAllTags, toAscii } from "./songTitle"

const MAX_LYRICS_LENGTH = 20_000
export const DEFAULT_BUDGET_MS = 10_000
const FETCH_MAX_BYTES = 512_000
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

function stripArtistSuffixNoise(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ""

  const stripped = trimmed
    // Common channel suffixes that pollute artist metadata from video sources.
    .replace(/\s*[-|｜]\s*(?:official|topic|vevo)\b.*$/iu, "")
    .replace(/\s+\b(?:official|vevo)\b(?:\s+(?:channel|music|records?|tv))?\s*$/iu, "")
    .replace(/\s+\btopic\b\s+(?:channel|music|records?|tv)\s*$/iu, "")
    .replace(/\s{2,}/g, " ")
    .trim()

  return stripped || trimmed
}

export function splitArtistTokens(value: string): string[] {
  const normalized = value
    .replace(/\b(?:feat\.?|ft\.?|featuring|with|w\/|con)\b/giu, ",")
    .replace(/\s+x\s+/giu, ",")
    .replace(/[&+\/|｜]/gu, ",")

  return uniqueByNormalized(
    normalized
      .split(",")
      .map((part) => stripArtistSuffixNoise(trimDanglingSeparators(stripAllTags(part))))
      .filter(Boolean)
  )
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

/**
 * Extracts the inner HTML of every `data-lyrics-container="true"` div,
 * correctly handling arbitrarily-nested child divs by counting open/close tags.
 * The naive regex approach ([\s\S]*?<\/div>) stops at the first nested </div>,
 * which cuts off most of the lyrics.
 */
function extractLyricsContainerBlocks(html: string): string[] {
  const blocks: string[] = []
  const openTagRe = /<div[^>]*data-lyrics-container="true"[^>]*>/gi
  let match: RegExpExecArray | null

  while ((match = openTagRe.exec(html)) !== null) {
    const contentStart = match.index + match[0].length
    let depth = 1
    let cursor = contentStart
    let contentEnd = -1

    while (cursor < html.length) {
      const nextOpen = html.indexOf("<div", cursor)
      const nextClose = html.indexOf("</div", cursor)

      if (nextClose < 0) break

      if (nextOpen >= 0 && nextOpen < nextClose) {
        depth++
        cursor = nextOpen + 4
      } else {
        depth--
        if (depth === 0) {
          contentEnd = nextClose
          break
        }
        cursor = nextClose + 6
      }
    }

    const raw = contentEnd >= 0
      ? html.slice(contentStart, contentEnd)
      : html.slice(contentStart)

    const text = stripHtmlToText(raw)
    if (text) blocks.push(text)
  }

  return blocks
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

  const blocks = extractLyricsContainerBlocks(html)
  if (blocks.length === 0) return null
  return blocks.join("\n").trim()
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

    // Require at least a partial title match to avoid returning unrelated lyrics.
    if (!localBestSong || localBestScore < 2) return null

    const songUrl = (localBestSong.url || (localBestSong.path ? `https://genius.com${localBestSong.path}` : "")).trim()
    if (!songUrl) return null

    const pageResponse = await safeFetch(
      songUrl,
      {
        headers: {
          "User-Agent": LYRICS_USER_AGENT,
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
  params.set("q", toAscii(query.title + ' ' + query.artist) || (query.title + '+' + query.artist))
  if (query.duration) params.set("duration", toAscii(query.duration.toString()) || query.duration.toString())

  let response: Awaited<ReturnType<typeof safeFetch>>
  const url = `https://lrclib.net/api/search?${params.toString()}`;
  try {
    response = await safeFetch(
      url,
      { headers: { "User-Agent": LYRICS_USER_AGENT } },
      {
        allowedContentTypes: ["application/json"],
        timeoutMs,
        // maxBytes: FETCH_MAX_BYTES,
      }
    )
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    appendLyricsSearchLog("provider_miss", { provider: "lrclib", reason: "fetch_error", title: query.title, artist: query.artist, url: url, user_agent: LYRICS_USER_AGENT, error: errorMsg })
    return null
  }
  if (!response.ok) {
    appendLyricsSearchLog("provider_miss", { provider: "lrclib", reason: `http_${response.status}`, title: query.title, artist: query.artist, url: url })
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
