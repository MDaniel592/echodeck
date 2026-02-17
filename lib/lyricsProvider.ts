import { safeFetch } from "./safeFetch"

const MAX_LYRICS_LENGTH = 20_000
const FETCH_TIMEOUT_MS = 8_000
const FETCH_MAX_BYTES = 512_000

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
}

type LookupQuery = {
  title: string
  artist: string
  album: string
  duration: number | null
}

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function cleanLyrics(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, MAX_LYRICS_LENGTH)
}

function simplifyTitle(value: string): string {
  return value
    .replace(/\([^)]*(live|remaster|version|edit|mix|karaoke)[^)]*\)/gi, " ")
    .replace(/\[[^\]]*(live|remaster|version|edit|mix|karaoke)[^\]]*\]/gi, " ")
    .replace(/\b(feat\.?|ft\.?|featuring)\b.+$/i, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
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

async function lookupLrcLib(query: LookupQuery): Promise<string | null> {
  if (!query.title) return null

  const params = new URLSearchParams()
  params.set("track_name", query.title)
  if (query.artist) params.set("artist_name", query.artist)
  if (query.album) params.set("album_name", query.album)

  const response = await safeFetch(
    `https://lrclib.net/api/search?${params.toString()}`,
    undefined,
    {
      allowedContentTypes: ["application/json"],
      timeoutMs: FETCH_TIMEOUT_MS,
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

async function lookupLyricsOvh(query: LookupQuery): Promise<string | null> {
  if (!query.title || !query.artist) return null
  const response = await safeFetch(
    `https://api.lyrics.ovh/v1/${encodeURIComponent(query.artist)}/${encodeURIComponent(query.title)}`,
    undefined,
    {
      allowedContentTypes: ["application/json"],
      timeoutMs: FETCH_TIMEOUT_MS,
      maxBytes: FETCH_MAX_BYTES,
    }
  )
  if (!response.ok) return null
  const payload = (await response.json().catch(() => null)) as unknown
  if (!payload || typeof payload !== "object") return null
  const rawLyrics = (payload as { lyrics?: unknown }).lyrics
  return cleanLyrics(rawLyrics)
}

export async function lookupLyrics(input: LyricsLookupInput): Promise<string | null> {
  const title = input.title.trim()
  const artist = (input.artist || "").trim()
  const album = (input.album || "").trim()
  if (!title) return null

  const query: LookupQuery = {
    title,
    artist,
    album,
    duration: input.duration ?? null,
  }

  const primary = await lookupLrcLib(query).catch(() => null)
  if (primary) return primary

  const simplifiedTitle = simplifyTitle(title)
  if (simplifiedTitle && simplifiedTitle !== title) {
    const secondary = await lookupLrcLib({
      ...query,
      title: simplifiedTitle,
      album: "",
    }).catch(() => null)
    if (secondary) return secondary
  }

  const fallback = await lookupLyricsOvh({
    ...query,
    title: simplifiedTitle || title,
  }).catch(() => null)
  return fallback
}
