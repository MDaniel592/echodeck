import prisma from "./prisma"
import { lookupLyrics } from "./lyricsProvider"

const SUBSONIC_LYRICS_LOOKUP_TIMEOUT_MS = Math.max(
  1500,
  Math.min(15000, Number.parseInt(process.env.SUBSONIC_LYRICS_LOOKUP_TIMEOUT_MS || "5000", 10) || 5000)
)

export async function resolveAndPersistLyricsForSong(input: {
  songId: number
  title: string
  artist?: string | null
  album?: string | null
  duration?: number | null
  currentLyrics?: string | null
}): Promise<string | null> {
  if (input.currentLyrics && input.currentLyrics.trim()) {
    return input.currentLyrics
  }

  const title = (input.title || "").trim()
  if (!title) return null

  const fetched = await lookupLyrics({
    title,
    artist: (input.artist || "").trim(),
    album: (input.album || "").trim(),
    duration: input.duration ?? null,
    timeoutMs: SUBSONIC_LYRICS_LOOKUP_TIMEOUT_MS,
  }).catch(() => null)

  if (!fetched) return null

  await prisma.song
    .update({
      where: { id: input.songId },
      data: { lyrics: fetched },
    })
    .catch(() => {})

  return fetched
}

export async function resolveLyricsWithoutSong(input: {
  title: string
  artist?: string | null
  album?: string | null
  duration?: number | null
}): Promise<string | null> {
  const title = (input.title || "").trim()
  if (!title) return null

  return lookupLyrics({
    title,
    artist: (input.artist || "").trim(),
    album: (input.album || "").trim(),
    duration: input.duration ?? null,
    timeoutMs: SUBSONIC_LYRICS_LOOKUP_TIMEOUT_MS,
  }).catch(() => null)
}
