import { normalizeToken, extractTitleFromArtistDash, extractQuotedTitle, stripAllTags } from "./songTitle"
import { isLrcFormat } from "./lyricsParser"
import {
  DEFAULT_BUDGET_MS,
  appendLyricsSearchLog,
  firstNonNull,
  lookupGenius,
  lookupLrcLib,
  segmentTitle,
  splitArtistTokens,
  trimDanglingSeparators,
  type LookupQuery,
} from "./lyricsProviders"

export type LyricsLookupInput = {
  title: string
  artist?: string | null
  album?: string | null
  duration?: number | null
  /** Total timeout budget in ms for the entire lookup (default: 6000) */
  timeoutMs?: number
}

export async function lookupLyrics(input: LyricsLookupInput): Promise<string | null> {
  const title = input.title.trim()
  const artist = (input.artist || "").trim()
  const album = (input.album || "").trim()
  if (!title) return null
  appendLyricsSearchLog("lookup_start", {
    title,
    artist,
    album,
    duration: input.duration ?? null,
    timeoutMs: input.timeoutMs ?? DEFAULT_BUDGET_MS,
  })

  const budget = input.timeoutMs ?? DEFAULT_BUDGET_MS
  // Primary LrcLib gets 60% of budget (increased from 50% for better lrclib coverage)
  const primaryTimeout = Math.round(budget * 0.6)
  // Remaining for Genius fallback
  const tertiaryTimeout = Math.round(budget * 0.4)

  const query: LookupQuery = {
    title,
    artist,
    album,
    duration: input.duration ?? null,
  }

  // Try extracting title from "ARTIST - TITLE" YouTube format
  const extractedTitle = extractTitleFromArtistDash(title, artist)
  const dashIdx = title.indexOf(" - ")
  const dashLeftArtist = dashIdx >= 0
    ? trimDanglingSeparators(stripAllTags(title.slice(0, dashIdx).trim()))
    : ""
  const dashLeftArtistCandidates = splitArtistTokens(dashLeftArtist)
  const dashRightTitle = dashIdx >= 0
    ? trimDanglingSeparators(stripAllTags(title.slice(dashIdx + 3).trim()))
    : ""

  // Try REVERSE interpretation: "TITLE - REAL_ARTIST" (common for remix/slowed channels)
  // Also handles "TITLE - REAL_ARTIST (junk) + more junk"
  let reversedTitle: string | null = null
  let reversedArtist: string | null = null
  if (!extractedTitle && dashIdx >= 0) {
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
  const cleanTitleRaw = strippedTitle || extractedTitle || title
  const cleanTitle = trimDanglingSeparators(cleanTitleRaw) || cleanTitleRaw
  const segmentedCleanTitle = segmentTitle(cleanTitle)

  // Extract first artist from multi-artist strings ("Øneheart, reidenshi" → "Øneheart")
  const artistCandidates = splitArtistTokens(artist)
  const firstArtist = artistCandidates[0] || null

  // Extract title from single/double-quoted patterns: "M83 'Midnight City' Official video" → "Midnight City"
  const quotedTitle = extractQuotedTitle(cleanTitle) || extractQuotedTitle(title) || null

  const geniusTitleHint = dashRightTitle || reversedTitle || quotedTitle || segmentedCleanTitle || cleanTitle
  const geniusArtistHint = reversedArtist || dashLeftArtistCandidates[0] || firstArtist || artist

  // --- Round 1: primary search with original metadata ---
  const primary = await lookupLrcLib(query, primaryTimeout).catch(() => null)
  if (primary) {
    appendLyricsSearchLog("lookup_end", { title, artist, provider: "lrclib_primary", found: true })
    return primary
  }


  const finalResult = await lookupGenius({
    title: geniusTitleHint || query.title,
    artist: "",
    album: "",
    duration: query.duration,
  }, tertiaryTimeout).catch(() => null)
  appendLyricsSearchLog("lookup_end", { title, artist, provider: finalResult ? "final_fallback" : "none", found: Boolean(finalResult) })
  return finalResult
}

/**
 * Queries LrcLib with several artist/title variants using the full timeout budget, and
 * returns the result ONLY if it is in synced LRC format. Returns null if only plain-text
 * lyrics are found. Intended for background upgrades when a non-synced result was already
 * returned to the caller.
 */
export async function lookupLrcLibSynced(input: LyricsLookupInput): Promise<string | null> {
  const title = input.title.trim()
  const artist = (input.artist || "").trim()
  if (!title) return null

  const budget = input.timeoutMs ?? DEFAULT_BUDGET_MS
  const duration = input.duration ?? null

  const artistCandidates = splitArtistTokens(artist)
  const firstArtist = artistCandidates[0] || null
  const cleanTitle = trimDanglingSeparators(stripAllTags(title)) || title
  const segCleanTitle = segmentTitle(cleanTitle)

  const seen = new Set<string>()
  const variants: LookupQuery[] = []
  const add = (q: LookupQuery) => {
    const key = `${normalizeToken(q.title)}|${normalizeToken(q.artist)}`
    if (!seen.has(key)) {
      seen.add(key)
      variants.push(q)
    }
  }

  add({ title, artist, album: "", duration })
  if (firstArtist && normalizeToken(firstArtist) !== normalizeToken(artist)) {
    add({ title, artist: firstArtist, album: "", duration })
  }
  if (normalizeToken(cleanTitle) !== normalizeToken(title)) {
    add({ title: cleanTitle, artist: firstArtist || artist, album: "", duration })
  }
  if (segCleanTitle) {
    add({ title: segCleanTitle, artist: firstArtist || artist, album: "", duration })
  }
  for (const variant of artistCandidates.slice(1, 3)) {
    add({ title: cleanTitle || title, artist: variant, album: "", duration })
  }

  const results = await Promise.allSettled(
    variants.map((q) => lookupLrcLib(q, budget).catch(() => null))
  )

  for (const r of results) {
    if (r.status === "fulfilled" && r.value && isLrcFormat(r.value)) {
      return r.value
    }
  }
  return null
}
