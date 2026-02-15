import fs from "fs"
import prisma from "./prisma"

const SOUNDCLOUD_HOSTS = new Set(["soundcloud.com", "www.soundcloud.com", "on.soundcloud.com"])
const SPOTIFY_HOSTS = new Set(["open.spotify.com", "spotify.com", "www.spotify.com"])

export function normalizeSoundCloudUrl(sourceUrl: string): string {
  try {
    const parsed = new URL(sourceUrl)
    const host = parsed.hostname.toLowerCase()
    if (!SOUNDCLOUD_HOSTS.has(host)) {
      return sourceUrl
    }

    const normalized = new URL(parsed.toString())
    normalized.hash = ""
    normalized.search = ""
    normalized.hostname = host === "www.soundcloud.com" ? "soundcloud.com" : host

    const normalizedPath = normalized.pathname.replace(/\/+$/, "")
    normalized.pathname = normalizedPath || "/"
    return normalized.toString()
  } catch {
    return sourceUrl
  }
}

export function normalizeSpotifyTrackUrl(sourceUrl: string | null): string | null {
  if (!sourceUrl) return null

  try {
    const parsed = new URL(sourceUrl)
    const host = parsed.hostname.toLowerCase()
    if (!SPOTIFY_HOSTS.has(host)) {
      return sourceUrl
    }

    const parts = parsed.pathname.split("/").filter(Boolean)
    const trackIndex = parts.findIndex((part) => part === "track")
    const trackId = trackIndex >= 0 ? parts[trackIndex + 1] : null

    if (!trackId) {
      return sourceUrl
    }

    return `https://open.spotify.com/track/${trackId}`
  } catch {
    return sourceUrl
  }
}

export async function findReusableSongBySourceUrl(userId: number, source: string, sourceUrl: string | null) {
  if (!sourceUrl) return null

  const candidates = await prisma.song.findMany({
    where: {
      userId,
      source,
      sourceUrl,
    },
    orderBy: { createdAt: "desc" },
  })

  for (const candidate of candidates) {
    if (fs.existsSync(candidate.filePath)) {
      return candidate
    }

    try {
      await prisma.song.delete({ where: { id: candidate.id } })
    } catch {
      // Ignore stale row cleanup races.
    }
  }

  return null
}
