import fs from "fs/promises"
import prisma from "../lib/prisma"
import { downloadSongArtwork } from "../lib/artwork"
import { getVideoInfo } from "../lib/ytdlp"

type SongRow = {
  id: number
  title: string
  filePath: string
  sourceUrl: string | null
  thumbnail: string | null
  coverPath: string | null
}

function extractYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()

    if (host === "youtu.be") {
      return parsed.pathname.split("/").filter(Boolean)[0] ?? null
    }

    const direct = parsed.searchParams.get("v")
    if (direct) return direct

    const parts = parsed.pathname.split("/").filter(Boolean)
    if ((parts[0] === "shorts" || parts[0] === "live") && parts[1]) {
      return parts[1]
    }
    return null
  } catch {
    return null
  }
}

function isLikelyLowResThumbnail(url: string | null): boolean {
  if (!url) return false
  const normalized = url.toLowerCase()
  if (!normalized.includes("ytimg.com")) return false
  if (normalized.includes("maxresdefault") || normalized.includes("sddefault")) return false
  return (
    normalized.includes("hqdefault") ||
    normalized.includes("mqdefault") ||
    normalized.includes("/default.") ||
    normalized.includes("sqp=")
  )
}

function thumbnailCandidatesForVideo(videoId: string): string[] {
  return [
    `https://i.ytimg.com/vi_webp/${videoId}/maxresdefault.webp`,
    `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi_webp/${videoId}/sddefault.webp`,
    `https://i.ytimg.com/vi/${videoId}/sddefault.jpg`,
    `https://i.ytimg.com/vi_webp/${videoId}/hqdefault.webp`,
    `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  ]
}

function uniqueUrls(urls: Array<string | null | undefined>): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const value of urls) {
    if (!value) continue
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }
  return result
}

async function refreshSongArtwork(song: SongRow): Promise<{ refreshed: boolean; reason?: string }> {
  if (!song.sourceUrl) {
    return { refreshed: false, reason: "no_source_url" }
  }

  const videoId = extractYouTubeVideoId(song.sourceUrl)
  if (!videoId) {
    return { refreshed: false, reason: "no_video_id" }
  }

  let infoThumbnail: string | null = null
  try {
    const info = await getVideoInfo(song.sourceUrl)
    infoThumbnail = info.thumbnail
  } catch {
    // Best-effort metadata fetch; fallback to direct ytimg candidates.
  }

  const candidates = uniqueUrls([infoThumbnail, ...thumbnailCandidatesForVideo(videoId)])
  if (candidates.length === 0) {
    return { refreshed: false, reason: "no_candidates" }
  }

  for (const candidate of candidates) {
    const newCoverPath = await downloadSongArtwork(song.id, candidate, song.filePath)
    if (!newCoverPath) continue

    await prisma.song.update({
      where: { id: song.id },
      data: {
        thumbnail: candidate,
        coverPath: newCoverPath,
      },
    })

    if (song.coverPath && song.coverPath !== newCoverPath) {
      await fs.unlink(song.coverPath).catch(() => {})
    }

    return { refreshed: true }
  }

  return { refreshed: false, reason: "download_failed" }
}

async function main() {
  const songs = await prisma.song.findMany({
    where: {
      source: "youtube",
      thumbnail: { not: null },
    },
    select: {
      id: true,
      title: true,
      filePath: true,
      sourceUrl: true,
      thumbnail: true,
      coverPath: true,
    },
    orderBy: { id: "asc" },
  })

  const targets = songs.filter((song) => isLikelyLowResThumbnail(song.thumbnail))
  console.log(`Found ${targets.length} low-res YouTube artwork candidate(s).`)

  let refreshed = 0
  let skipped = 0
  let failed = 0

  for (const song of targets) {
    const result = await refreshSongArtwork(song)
    if (result.refreshed) {
      refreshed += 1
      console.log(`Refreshed [${song.id}] ${song.title}`)
      continue
    }

    if (result.reason === "no_video_id" || result.reason === "no_source_url") {
      skipped += 1
      console.log(`Skipped [${song.id}] ${song.title} (${result.reason})`)
    } else {
      failed += 1
      console.log(`Failed [${song.id}] ${song.title} (${result.reason ?? "unknown"})`)
    }
  }

  console.log(`Done. refreshed=${refreshed} skipped=${skipped} failed=${failed}`)
}

main()
  .catch((error) => {
    console.error("Artwork refresh failed:", error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
