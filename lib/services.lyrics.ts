import prisma from "./prisma"
import { lookupLyrics, lookupLrcLibSynced } from "./lyricsProvider"
import { isLrcFormat } from "./lyricsParser"

const SUBSONIC_LYRICS_LOOKUP_TIMEOUT_MS = Math.max(
  1500,
  Math.min(15000, Number.parseInt(process.env.SUBSONIC_LYRICS_LOOKUP_TIMEOUT_MS || "15000", 10) || 15000)
)

// Extended timeout for background LrcLib synced-lyrics upgrades.
const LRCLIB_UPGRADE_TIMEOUT_MS = Math.max(
  SUBSONIC_LYRICS_LOOKUP_TIMEOUT_MS,
  Math.min(20000, Number.parseInt(process.env.LRCLIB_UPGRADE_TIMEOUT_MS || "15000", 10) || 15000)
)

/**
 * Fires a background LrcLib search for synced (LRC-timestamped) lyrics.
 * If synced lyrics are found, the DB is updated so the next playback session
 * gets karaoke-ready lyrics. Does NOT block the caller.
 */
function scheduleSyncedUpgrade(input: {
  songId: number
  title: string
  artist?: string | null
  album?: string | null
  duration?: number | null
}): void {
  lookupLrcLibSynced({
    title: input.title,
    artist: input.artist,
    album: input.album,
    duration: input.duration,
    timeoutMs: LRCLIB_UPGRADE_TIMEOUT_MS,
  })
    .then(async (synced) => {
      if (!synced) return
      await prisma.song.update({
        where: { id: input.songId },
        data: { lyrics: synced },
      })
    })
    .catch(() => {
      // Upgrade failures are silent — plain lyrics remain usable.
    })
}

export async function resolveAndPersistLyricsForSong(input: {
  songId: number
  title: string
  artist?: string | null
  album?: string | null
  duration?: number | null
  currentLyrics?: string | null
}): Promise<string | null> {
  if (input.currentLyrics && input.currentLyrics.trim()) {
    // If we already have lyrics but they are plain text (not synced LRC), kick off a
    // background upgrade so the next session can use timestamped karaoke lyrics.
    if (!isLrcFormat(input.currentLyrics)) {
      scheduleSyncedUpgrade(input)
    }
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
  }).catch((error) => {
    const msg = error instanceof Error ? error.message : String(error)
    console.warn(`[lyrics] lookup failed for "${title}" (songId=${input.songId}): ${msg}`)
    return null
  })

  if (!fetched) return null

  try {
    await prisma.song.update({
      where: { id: input.songId },
      data: { lyrics: fetched },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.warn(`[lyrics] failed to persist lyrics for songId=${input.songId}: ${msg}`)
  }

  // If the found lyrics are plain (not LRC), schedule a background upgrade so that
  // synced lyrics land in the DB for the next session (maximum karaoke priority).
  if (!isLrcFormat(fetched)) {
    scheduleSyncedUpgrade(input)
  }

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
