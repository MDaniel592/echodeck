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
