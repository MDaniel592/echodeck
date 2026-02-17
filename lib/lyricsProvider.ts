import { readFileSync } from "fs"
import { join } from "path"
import { safeFetch } from "./safeFetch"
import { normalizeToken, extractTitleFromArtistDash, stripAllTags, toAscii } from "./songTitle"

const MAX_LYRICS_LENGTH = 20_000
const DEFAULT_BUDGET_MS = 6_000
const FETCH_MAX_BYTES = 512_000

// Build User-Agent from package.json at module load
const LYRICS_USER_AGENT = (() => {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"))
    return `${pkg.name}/${pkg.version} (https://github.com/MDaniel592/echodeck)`
  } catch {
    return "EchoDeck/unknown (https://github.com/MDaniel592/echodeck)"
  }
})()

type LrcLibSearchResult = {
  trackName?: string
  artistName?: string
  duration?: number
  plainLyrics?: string
  syncedLyrics?: string
}

export type LyricsLookupInput = {
  title: string
  artist?: string | null
  album?: string | null
  duration?: number | null
  /** Total timeout budget in ms for the entire lookup (default: 6000) */
  timeoutMs?: number
}

type LookupQuery = {
  title: string
  artist: string
  album: string
  duration: number | null
}

function cleanLyrics(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, MAX_LYRICS_LENGTH)
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

async function lookupLrcLib(query: LookupQuery, timeoutMs: number): Promise<string | null> {
  if (!query.title) return null

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
  if (!response.ok) return null

  const payload = (await response.json().catch(() => null)) as unknown
  if (!Array.isArray(payload) || payload.length === 0) return null

  const normalizedQuery = {
    title: normalizeToken(query.title),
    artist: normalizeToken(query.artist),
    duration: query.duration,
  }

  let best: { lyrics: string; score: number; candidate: LrcLibSearchResult } | null = null
  for (const raw of payload) {
    if (!raw || typeof raw !== "object") continue
    const candidate = raw as LrcLibSearchResult
    const lyrics = cleanLyrics(candidate.plainLyrics || candidate.syncedLyrics)
    if (!lyrics) continue
    const score = scoreCandidate(candidate, normalizedQuery)
    if (!best || score > best.score) {
      best = { lyrics, score, candidate }
    }
  }

  if (!best) return null

  // If artist is unknown, require strict title match to reduce false positives.
  if (!normalizedQuery.artist) {
    const bestTitle = normalizeToken(best.candidate.trackName || "")
    if (!bestTitle || bestTitle !== normalizedQuery.title) {
      return null
    }
    if (
      typeof normalizedQuery.duration === "number" &&
      typeof best.candidate.duration === "number" &&
      Math.abs(best.candidate.duration - normalizedQuery.duration) > 8
    ) {
      return null
    }
  }

  return best.lyrics
}

async function lookupLyricsOvh(query: LookupQuery, timeoutMs: number): Promise<string | null> {
  if (!query.title || !query.artist) return null
  const response = await safeFetch(
    `https://api.lyrics.ovh/v1/${encodeURIComponent(query.artist)}/${encodeURIComponent(query.title)}`,
    { headers: { "User-Agent": LYRICS_USER_AGENT } },
    {
      allowedContentTypes: ["application/json"],
      timeoutMs,
      maxBytes: FETCH_MAX_BYTES,
    }
  )
  if (!response.ok) return null
  const payload = (await response.json().catch(() => null)) as unknown
  if (!payload || typeof payload !== "object") return null
  const rawLyrics = (payload as { lyrics?: unknown }).lyrics
  return cleanLyrics(rawLyrics)
}

function firstNonNull(promises: Array<Promise<string | null>>): Promise<string | null> {
  if (promises.length === 0) return Promise.resolve(null)

  return new Promise((resolve) => {
    let pending = promises.length
    let resolved = false

    const settle = (value: string | null) => {
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

export async function lookupLyrics(input: LyricsLookupInput): Promise<string | null> {
  const title = input.title.trim()
  const artist = (input.artist || "").trim()
  const album = (input.album || "").trim()
  if (!title) return null

  const budget = input.timeoutMs ?? DEFAULT_BUDGET_MS
  // Primary gets 40% of budget, fallback rounds share remaining 60%
  const primaryTimeout = Math.round(budget * 0.4)
  const secondaryTimeout = Math.round(budget * 0.3)
  const tertiaryTimeout = Math.round(budget * 0.3)

  const query: LookupQuery = {
    title,
    artist,
    album,
    duration: input.duration ?? null,
  }

  // Try extracting title from "ARTIST - TITLE" YouTube format
  const extractedTitle = extractTitleFromArtistDash(title, artist)

  // Try REVERSE interpretation: "TITLE - REAL_ARTIST" (common for remix/slowed channels)
  // Also handles "TITLE - REAL_ARTIST (junk) + more junk"
  let reversedTitle: string | null = null
  let reversedArtist: string | null = null
  if (!extractedTitle && title.includes(" - ")) {
    const dashIdx = title.indexOf(" - ")
    reversedTitle = stripAllTags(title.slice(0, dashIdx).trim()) || null
    // Clean the artist part aggressively: strip tags, then take only the portion
    // before any "+", "|", "｜" separators which usually indicate added effects/noise
    let rawReversedArtist = stripAllTags(title.slice(dashIdx + 3).trim())
    rawReversedArtist = rawReversedArtist.split(/\s*[+|｜]\s*/)[0].trim()
    reversedArtist = rawReversedArtist || null
  }

  // Aggressively strip ALL tags for search (including Slowed+Reverb — lyrics are the same)
  const strippedTitle = stripAllTags(extractedTitle || title)
  // Best cleaned title to use for searches
  const cleanTitle = strippedTitle || extractedTitle || title

  // Extract first artist from multi-artist strings ("Øneheart, reidenshi" → "Øneheart")
  const firstArtist = artist.includes(",") ? artist.split(",")[0].trim() : null

  // --- Round 1: primary search with original metadata ---
  const primary = await lookupLrcLib(query, primaryTimeout).catch(() => null)
  if (primary) return primary

  // --- Round 2: cleaned title, reversed interpretation, first-artist, lyrics.ovh (parallel) ---
  const round2: Array<Promise<string | null>> = []

  if (cleanTitle !== title) {
    round2.push(
      lookupLrcLib({
        ...query,
        title: cleanTitle,
        album: "",
      }, secondaryTimeout).catch(() => null)
    )
  }

  // Try reversed "TITLE - REAL_ARTIST" interpretation
  if (reversedTitle && reversedArtist) {
    round2.push(
      lookupLrcLib({
        title: reversedTitle,
        artist: reversedArtist,
        album: "",
        duration: query.duration,
      }, secondaryTimeout).catch(() => null)
    )
  }

  // Try with just the first artist from a multi-artist field
  if (firstArtist) {
    round2.push(
      lookupLrcLib({
        ...query,
        title: cleanTitle,
        artist: firstArtist,
        album: "",
      }, secondaryTimeout).catch(() => null)
    )
  }

  round2.push(
    lookupLyricsOvh({
      ...query,
      title: reversedTitle || cleanTitle,
      artist: reversedArtist || artist,
    }, secondaryTimeout).catch(() => null)
  )

  const round2Result = await firstNonNull(round2)
  if (round2Result) return round2Result

  // --- Round 3: title-only search as last resort (no artist filter) ---
  if (artist) {
    return lookupLrcLib({
      title: reversedTitle || cleanTitle,
      artist: "",
      album: "",
      duration: query.duration,
    }, tertiaryTimeout).catch(() => null)
  }

  return null
}
