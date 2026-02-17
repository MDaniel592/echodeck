import "dotenv/config"
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

type RefreshResult =
  | { kind: "updated"; thumbnail: string; coverPath: string }
  | { kind: "skipped"; reason: string }
  | { kind: "failed"; reason: string }

async function refreshSongArtwork(song: SongRow): Promise<RefreshResult> {
  if (!song.sourceUrl) {
    return { kind: "skipped", reason: "no_source_url" }
  }

  let thumbnail: string | null = null
  try {
    const info = await getVideoInfo(song.sourceUrl)
    thumbnail = info.thumbnail
  } catch (error) {
    return {
      kind: "failed",
      reason: `metadata_error:${error instanceof Error ? error.message : "unknown"}`,
    }
  }

  if (!thumbnail) {
    return { kind: "failed", reason: "no_thumbnail" }
  }

  const newCoverPath = await downloadSongArtwork(song.id, thumbnail, song.filePath)
  if (!newCoverPath) {
    return { kind: "failed", reason: "download_failed" }
  }

  await prisma.song.update({
    where: { id: song.id },
    data: {
      thumbnail,
      coverPath: newCoverPath,
    },
  })

  if (song.coverPath && song.coverPath !== newCoverPath) {
    await fs.unlink(song.coverPath).catch(() => {})
  }

  return { kind: "updated", thumbnail, coverPath: newCoverPath }
}

async function main() {
  const songs = await prisma.song.findMany({
    where: { source: "youtube" },
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

  console.log(`Found ${songs.length} YouTube song(s) to refresh.`)

  let updated = 0
  let skipped = 0
  let failed = 0

  for (const song of songs) {
    const result = await refreshSongArtwork(song)
    if (result.kind === "updated") {
      updated += 1
      console.log(`Updated [${song.id}] ${song.title} -> ${result.thumbnail}`)
      continue
    }
    if (result.kind === "skipped") {
      skipped += 1
      console.log(`Skipped [${song.id}] ${song.title} (${result.reason})`)
      continue
    }
    failed += 1
    console.log(`Failed [${song.id}] ${song.title} (${result.reason})`)
  }

  console.log(`Done. updated=${updated} skipped=${skipped} failed=${failed}`)
}

main()
  .catch((error) => {
    console.error("Artwork refresh failed:", error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
