import { normalizeToken, stripAllTags } from "./songTitle"

export type SmartPlaylistRule = {
  artistContains?: string
  albumContains?: string
  genreContains?: string
  sourceEquals?: string
  yearGte?: number
  yearLte?: number
  minPlayCount?: number
  starredOnly?: boolean
  hasLyrics?: boolean
  libraryId?: number
  search?: string
  sortBy?: "createdAt" | "playCount" | "lastPlayedAt" | "year" | "title" | "artist"
  sortOrder?: "asc" | "desc"
  limit?: number
}

const MAX_RULE_LIMIT = 1000
const DEFAULT_RULE_LIMIT = 200

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function asPositiveInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10)
    if (Number.isInteger(parsed) && parsed > 0) return parsed
  }
  return undefined
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value
  return undefined
}

export function parseSmartPlaylistRule(input: unknown): { rule: SmartPlaylistRule; errors: string[] } {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {}
  const errors: string[] = []

  const sortBy = asTrimmedString(raw.sortBy)
  const sortOrder = asTrimmedString(raw.sortOrder)

  const rule: SmartPlaylistRule = {
    artistContains: asTrimmedString(raw.artistContains),
    albumContains: asTrimmedString(raw.albumContains),
    genreContains: asTrimmedString(raw.genreContains),
    sourceEquals: asTrimmedString(raw.sourceEquals),
    yearGte: asPositiveInt(raw.yearGte),
    yearLte: asPositiveInt(raw.yearLte),
    minPlayCount: asPositiveInt(raw.minPlayCount),
    starredOnly: asBoolean(raw.starredOnly),
    hasLyrics: asBoolean(raw.hasLyrics),
    libraryId: asPositiveInt(raw.libraryId),
    search: asTrimmedString(raw.search),
    sortBy:
      sortBy === "createdAt" ||
      sortBy === "playCount" ||
      sortBy === "lastPlayedAt" ||
      sortBy === "year" ||
      sortBy === "title" ||
      sortBy === "artist"
        ? sortBy
        : undefined,
    sortOrder: sortOrder === "asc" || sortOrder === "desc" ? sortOrder : undefined,
    limit: asPositiveInt(raw.limit),
  }

  if (rule.limit && rule.limit > MAX_RULE_LIMIT) {
    errors.push(`limit must be <= ${MAX_RULE_LIMIT}`)
    rule.limit = MAX_RULE_LIMIT
  }

  if (rule.yearGte && rule.yearLte && rule.yearGte > rule.yearLte) {
    errors.push("yearGte cannot be greater than yearLte")
  }

  return { rule, errors }
}

export function parseSmartPlaylistRuleJson(ruleJson: string): {
  rule: SmartPlaylistRule
  errors: string[]
  invalidJson: boolean
} {
  try {
    const parsed = JSON.parse(ruleJson)
    const result = parseSmartPlaylistRule(parsed)
    return {
      ...result,
      invalidJson: false,
    }
  } catch {
    return {
      rule: {},
      errors: ["Stored rule JSON is invalid"],
      invalidJson: true,
    }
  }
}

export function buildSmartPlaylistWhere(userId: number, rule: SmartPlaylistRule): Record<string, unknown> {
  const where: Record<string, unknown> = { userId }

  if (rule.artistContains) where.artist = { contains: rule.artistContains }
  if (rule.albumContains) where.album = { contains: rule.albumContains }
  if (rule.genreContains) where.genre = { contains: rule.genreContains }
  if (rule.sourceEquals) where.source = { equals: rule.sourceEquals }
  if (rule.minPlayCount) where.playCount = { gte: rule.minPlayCount }
  if (rule.libraryId) where.libraryId = rule.libraryId
  if (rule.starredOnly) where.starredAt = { not: null }

  if (rule.hasLyrics === true) where.lyrics = { not: null }
  if (rule.hasLyrics === false) where.lyrics = null

  if (rule.yearGte || rule.yearLte) {
    where.year = {
      ...(rule.yearGte ? { gte: rule.yearGte } : {}),
      ...(rule.yearLte ? { lte: rule.yearLte } : {}),
    }
  }

  if (rule.search) {
    where.OR = [
      { title: { contains: rule.search } },
      { artist: { contains: rule.search } },
      { album: { contains: rule.search } },
      { genre: { contains: rule.search } },
      { source: { contains: rule.search } },
    ]
  }

  return where
}

export function resolveSmartPlaylistOrder(rule: SmartPlaylistRule): { [key: string]: "asc" | "desc" } {
  const field = rule.sortBy || "createdAt"
  const order = rule.sortOrder || "desc"
  return { [field]: order }
}

export function resolveSmartPlaylistLimit(rule: SmartPlaylistRule): number {
  return Math.min(MAX_RULE_LIMIT, Math.max(1, rule.limit || DEFAULT_RULE_LIMIT))
}

export type DuplicateSongInput = {
  id: number
  title: string
  artist: string | null
  duration: number | null
  filePath: string
  source: string
  bitrate: number | null
  fileSize: number | null
  createdAt: Date
}

export type DuplicateSongGroup = {
  fingerprint: string
  songs: DuplicateSongInput[]
}

function duplicateFingerprint(song: DuplicateSongInput): string {
  const cleanedTitle = stripAllTags(song.title || "")
  const titleToken = normalizeToken(cleanedTitle || song.title || "")
  const artistToken = normalizeToken(song.artist || "")
  const durationBucket = typeof song.duration === "number" ? Math.round(song.duration / 5) * 5 : -1
  return `${titleToken}::${artistToken}::${durationBucket}`
}

function qualityScore(song: DuplicateSongInput): number {
  let score = 0
  if (song.bitrate) score += song.bitrate
  if (song.fileSize) score += Math.min(song.fileSize / 10000, 5000)
  if (song.source === "library") score += 400
  return score
}

export function groupDuplicateSongs(songs: DuplicateSongInput[], minGroupSize = 2): DuplicateSongGroup[] {
  const grouped = new Map<string, DuplicateSongInput[]>()

  for (const song of songs) {
    const fingerprint = duplicateFingerprint(song)
    if (!fingerprint.startsWith("::")) {
      const bucket = grouped.get(fingerprint) || []
      bucket.push(song)
      grouped.set(fingerprint, bucket)
    }
  }

  const results: DuplicateSongGroup[] = []
  for (const [fingerprint, bucket] of grouped.entries()) {
    if (bucket.length < minGroupSize) continue

    bucket.sort((a, b) => {
      const scoreDelta = qualityScore(b) - qualityScore(a)
      if (scoreDelta !== 0) return scoreDelta
      return b.createdAt.getTime() - a.createdAt.getTime()
    })

    results.push({
      fingerprint,
      songs: bucket,
    })
  }

  results.sort((a, b) => b.songs.length - a.songs.length)
  return results
}
