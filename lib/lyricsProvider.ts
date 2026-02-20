import { normalizeToken, extractTitleFromArtistDash, stripAllTags } from "./songTitle"
import {
  DEFAULT_BUDGET_MS,
  appendLyricsSearchLog,
  firstNonNull,
  lookupGenius,
  lookupLrcLib,
  lookupLyricsOvh,
  lookupMusixmatch,
  lookupMusixmatchMobile,
  segmentTitle,
  splitArtistTokens,
  trimDanglingSeparators,
  uniqueByNormalized,
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
  const musixTitleHint = dashRightTitle || reversedTitle || segmentedCleanTitle || cleanTitle
  const musixArtistHint = reversedArtist || dashLeftArtistCandidates[0] || firstArtist || artist

  // --- Round 1: primary search with original metadata ---
  const primary = await lookupLrcLib(query, primaryTimeout).catch(() => null)
  if (primary) {
    appendLyricsSearchLog("lookup_end", { title, artist, provider: "lrclib_primary", found: true })
    return primary
  }

  // --- Round 2: cleaned title, reversed interpretation, first-artist, Musixmatch, lyrics.ovh (parallel) ---
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

  if (
    dashRightTitle &&
    normalizeToken(dashRightTitle) !== normalizeToken(cleanTitle) &&
    normalizeToken(dashRightTitle) !== normalizeToken(title)
  ) {
    round2.push(
      lookupLrcLib({
        ...query,
        title: dashRightTitle,
        album: "",
      }, secondaryTimeout).catch(() => null)
    )
  }

  if (
    dashRightTitle &&
    dashLeftArtist &&
    normalizeToken(dashLeftArtist) !== normalizeToken(artist)
  ) {
    round2.push(
      lookupLrcLib({
        title: dashRightTitle,
        artist: dashLeftArtist,
        album: "",
        duration: query.duration,
      }, secondaryTimeout).catch(() => null)
    )
  }

  if (
    dashRightTitle &&
    dashLeftArtistCandidates[0] &&
    normalizeToken(dashLeftArtistCandidates[0]) !== normalizeToken(dashLeftArtist)
  ) {
    round2.push(
      lookupLrcLib({
        title: dashRightTitle,
        artist: dashLeftArtistCandidates[0],
        album: "",
        duration: query.duration,
      }, secondaryTimeout).catch(() => null)
    )
  }

  if (segmentedCleanTitle && segmentedCleanTitle !== cleanTitle) {
    round2.push(
      lookupLrcLib({
        ...query,
        title: segmentedCleanTitle,
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
        title: segmentedCleanTitle || cleanTitle,
        artist: firstArtist,
        album: "",
      }, secondaryTimeout).catch(() => null)
    )
  }

  for (const artistVariant of artistCandidates.slice(1, 3)) {
    if (normalizeToken(artistVariant) === normalizeToken(firstArtist || "")) continue
    round2.push(
      lookupLrcLib({
        ...query,
        title: segmentedCleanTitle || cleanTitle,
        artist: artistVariant,
        album: "",
      }, secondaryTimeout).catch(() => null)
    )
  }

  round2.push(
    lookupMusixmatch({
      title: musixTitleHint,
      artist: musixArtistHint,
      album: "",
      duration: query.duration,
    }, secondaryTimeout).catch(() => null)
  )
  round2.push(
    lookupMusixmatchMobile({
      title: musixTitleHint,
      artist: musixArtistHint,
      album: "",
      duration: query.duration,
    }, secondaryTimeout).catch(() => null)
  )
  round2.push(
    lookupGenius({
      title: musixTitleHint,
      artist: musixArtistHint,
      album: "",
      duration: query.duration,
    }, secondaryTimeout).catch(() => null)
  )

  if (
    normalizeToken(musixTitleHint) !== normalizeToken(query.title) ||
    normalizeToken(musixArtistHint) !== normalizeToken(query.artist)
  ) {
    round2.push(
      lookupMusixmatch(query, secondaryTimeout).catch(() => null)
    )
    round2.push(
      lookupMusixmatchMobile(query, secondaryTimeout).catch(() => null)
    )
    round2.push(
      lookupGenius(query, secondaryTimeout).catch(() => null)
    )
  }

  round2.push(
    lookupLyricsOvh({
      ...query,
      title: reversedTitle || cleanTitle,
      artist: reversedArtist || dashLeftArtistCandidates[0] || firstArtist || artist,
    }, secondaryTimeout).catch(() => null)
  )

  const round2Result = await firstNonNull(round2)
  if (round2Result) {
    appendLyricsSearchLog("lookup_end", { title, artist, provider: "round2", found: true })
    return round2Result
  }

  // --- Round 3: title-only search as last resort (no artist filter) ---
  if (artist) {
    const round3Titles = uniqueByNormalized([
      dashRightTitle,
      reversedTitle,
      cleanTitle,
      segmentedCleanTitle,
    ])
    const round3 = round3Titles.map((titleVariant) =>
      lookupLrcLib({
        title: titleVariant,
        artist: "",
        album: "",
        duration: query.duration,
      }, tertiaryTimeout).catch(() => null)
    )
    round3.push(
      lookupMusixmatch({
        title: round3Titles[0] || musixTitleHint || query.title,
        artist: "",
        album: "",
        duration: query.duration,
      }, tertiaryTimeout).catch(() => null)
    )
    round3.push(
      lookupMusixmatchMobile({
        title: round3Titles[0] || musixTitleHint || query.title,
        artist: "",
        album: "",
        duration: query.duration,
      }, tertiaryTimeout).catch(() => null)
    )
    round3.push(
      lookupGenius({
        title: round3Titles[0] || musixTitleHint || query.title,
        artist: "",
        album: "",
        duration: query.duration,
      }, tertiaryTimeout).catch(() => null)
    )
    const round3Result = await firstNonNull(round3)
    appendLyricsSearchLog("lookup_end", { title, artist, provider: round3Result ? "round3" : "none", found: Boolean(round3Result) })
    return round3Result
  }

  const finalResult = await firstNonNull([
    lookupGenius({
      title: musixTitleHint || query.title,
      artist: "",
      album: "",
      duration: query.duration,
    }, tertiaryTimeout).catch(() => null),
    lookupMusixmatch({
      title: musixTitleHint || query.title,
      artist: "",
      album: "",
      duration: query.duration,
    }, tertiaryTimeout).catch(() => null),
    lookupMusixmatchMobile({
      title: musixTitleHint || query.title,
      artist: "",
      album: "",
      duration: query.duration,
    }, tertiaryTimeout).catch(() => null),
  ])
  appendLyricsSearchLog("lookup_end", { title, artist, provider: finalResult ? "final_fallback" : "none", found: Boolean(finalResult) })
  return finalResult
}
