function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

/**
 * Normalizes downloader/scanner generated title prefixes like:
 * - 1771186023467-1370741-uhi9i1-Track Name
 * - 1230851-dohkjy-Track Name
 */
export function normalizeSongTitle(raw: string, fallback = "Unknown title"): string {
  let value = (raw || "").replace(/\.[a-z0-9]{2,5}$/i, "")
  value = value.replace(/[_]+/g, " ")

  // Strip repeated long numeric/hash-like prefixes produced by downloader filenames.
  value = value.replace(/^(?:\d{6,}[\s-]+){1,4}(?:[a-z0-9]{4,}[\s-]+)?/i, "")
  value = value.replace(/^\d{5,}[-][a-z0-9]{4,}[-\s]+/i, "")
  value = value.replace(/^[\s.-]+/, "")

  value = collapseWhitespace(value)
  return value || fallback
}

/** Normalize a string for fuzzy comparison (lowercase, strip accents, collapse non-alnum). */
export function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

/** Common special character replacements for ASCII-safe API queries. */
const CHAR_MAP: Record<string, string> = {
  Ø: "O", ø: "o", Đ: "D", đ: "d", Ł: "L", ł: "l",
  Æ: "AE", æ: "ae", Œ: "OE", œ: "oe", ß: "ss",
}

/** Convert a string to ASCII-safe form for API queries (Øneheart → Oneheart). */
export function toAscii(value: string): string {
  let result = value
  for (const [from, to] of Object.entries(CHAR_MAP)) {
    result = result.replaceAll(from, to)
  }
  return result
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .trim()
}

/**
 * YouTube platform noise patterns — these add NO musical value and should always be stripped.
 * Used in both parenthesized (...) and bracketed [...] forms.
 */
const YT_NOISE_PATTERN =
  /official|video|audio|music\s*video|lyric\s*video|visuali[sz]er|premiere|teaser|trailer|clip\s*officiel|videoclip|1080p|2160p|4k|hd|hq|uhd|full\s*video/i

/**
 * Strip YouTube platform noise from a title, but KEEP musical variant tags
 * like (Slowed + Reverb), (Remix), (VIP), (Acoustic), (Live), etc.
 */
export function stripYouTubeNoise(value: string): string {
  return value
    // Remove parenthesized YouTube noise: (Official Video), (4K Music Video), etc.
    .replace(/\(([^)]*)\)/g, (match, inner: string) => YT_NOISE_PATTERN.test(inner) ? " " : match)
    .replace(/\[([^\]]*)\]/g, (match, inner: string) => YT_NOISE_PATTERN.test(inner) ? " " : match)
    // Remove trailing "visual(s) by ...", "prod. by ..." suffixes
    .replace(/\b(visual|visuals|prod\.?)\s+by\b.+$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim()
}

/**
 * Try to extract the real song title from YouTube-style "ARTIST - TITLE" formats.
 * Also handles "ARTIST1, ARTIST2 - TITLE" where one of the comma-separated
 * names matches the song's known artist.
 * Returns null if the pattern doesn't match or the artist doesn't appear before the dash.
 */
export function extractTitleFromArtistDash(rawTitle: string, artist: string): string | null {
  if (!artist) return null
  const dashIdx = rawTitle.indexOf(" - ")
  if (dashIdx < 0) return null

  const beforeDash = normalizeToken(rawTitle.slice(0, dashIdx))
  const normalizedArtist = normalizeToken(artist)
  if (!normalizedArtist) return null

  // Check if what's before the dash matches (or contains) the artist
  if (
    beforeDash === normalizedArtist ||
    beforeDash.includes(normalizedArtist) ||
    normalizedArtist.includes(beforeDash)
  ) {
    const extracted = rawTitle.slice(dashIdx + 3).trim()
    return extracted || null
  }
  return null
}

/**
 * Full YouTube title cleaning pipeline:
 * 1. Try to extract the real title from "ARTIST - TITLE" format
 * 2. Strip YouTube platform noise (Official Video, 4K, etc.)
 * 3. Apply normalizeSongTitle for download-prefix cleanup
 *
 * Musical variant tags like (Slowed + Reverb), (Remix) are preserved.
 */
export function cleanYouTubeTitle(rawTitle: string, artist: string): string {
  // First try to extract title from "ARTIST - TITLE" pattern
  const extracted = extractTitleFromArtistDash(rawTitle, artist)
  let title = extracted ?? rawTitle

  // Strip YouTube platform noise
  title = stripYouTubeNoise(title)

  // Apply standard normalization (download prefixes, extensions, etc.)
  title = normalizeSongTitle(title, rawTitle)

  return title
}

/**
 * Aggressively strip ALL parenthetical/bracket tags for search purposes (e.g., lyrics lookup).
 * This removes both YouTube noise AND musical variants (Slowed + Reverb, Remix, etc.)
 * because the underlying content (lyrics) is the same regardless of the variant.
 */
export function stripAllTags(value: string): string {
  return value
    .replace(/\([^)]+\)/g, " ")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\b(feat\.?|ft\.?|featuring)\b.+$/i, " ")
    .replace(/\b(visual|visuals|prod\.?)\s+by\b.+$/i, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
}
