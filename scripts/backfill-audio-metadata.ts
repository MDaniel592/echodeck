import fs from "fs/promises"
import prisma from "../lib/prisma"
import { extractAudioMetadataFromFile } from "../lib/audioMetadata"

type SongRow = {
  id: number
  title: string
  filePath: string
  duration: number | null
  bitrate: number | null
  sampleRate: number | null
  channels: number | null
  replayGainTrackDb: number | null
  replayGainAlbumDb: number | null
  replayGainTrackPeak: number | null
  replayGainAlbumPeak: number | null
}

function hasMissingAudioMetadata(song: SongRow): boolean {
  return (
    !song.duration ||
    !song.bitrate ||
    !song.sampleRate ||
    !song.channels
  )
}

function parseArgValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag)
  if (idx < 0) return null
  return process.argv[idx + 1] ?? null
}

function parseLimit(): number | null {
  const raw = parseArgValue("--limit")
  if (!raw) return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

async function main() {
  const onlyMissing = !process.argv.includes("--all")
  const limit = parseLimit()

  const songs = await prisma.song.findMany({
    select: {
      id: true,
      title: true,
      filePath: true,
      duration: true,
      bitrate: true,
      sampleRate: true,
      channels: true,
      replayGainTrackDb: true,
      replayGainAlbumDb: true,
      replayGainTrackPeak: true,
      replayGainAlbumPeak: true,
    },
    orderBy: { id: "asc" },
  })

  const candidates = (onlyMissing ? songs.filter(hasMissingAudioMetadata) : songs).slice(0, limit ?? undefined)
  console.log(
    `Backfill audio metadata: scanning ${candidates.length} song(s) ` +
      `(mode=${onlyMissing ? "missing-only" : "all"}${limit ? ` limit=${limit}` : ""})`
  )

  let updated = 0
  let unchanged = 0
  let missingFile = 0
  let noMetadata = 0
  let failed = 0

  for (let i = 0; i < candidates.length; i += 1) {
    const song = candidates[i]
    if ((i + 1) % 50 === 0 || i === 0 || i === candidates.length - 1) {
      console.log(`Progress ${i + 1}/${candidates.length}`)
    }

    try {
      await fs.access(song.filePath)
    } catch {
      missingFile += 1
      continue
    }

    try {
      const extracted = await extractAudioMetadataFromFile(song.filePath)
      const nextDuration = extracted.duration ?? song.duration
      const nextBitrate = extracted.bitrate ?? song.bitrate
      const nextSampleRate = extracted.sampleRate ?? song.sampleRate
      const nextChannels = extracted.channels ?? song.channels
      const nextReplayGainTrackDb = extracted.replayGainTrackDb ?? song.replayGainTrackDb
      const nextReplayGainAlbumDb = extracted.replayGainAlbumDb ?? song.replayGainAlbumDb
      const nextReplayGainTrackPeak = extracted.replayGainTrackPeak ?? song.replayGainTrackPeak
      const nextReplayGainAlbumPeak = extracted.replayGainAlbumPeak ?? song.replayGainAlbumPeak

      const changed =
        nextDuration !== song.duration ||
        nextBitrate !== song.bitrate ||
        nextSampleRate !== song.sampleRate ||
        nextChannels !== song.channels ||
        nextReplayGainTrackDb !== song.replayGainTrackDb ||
        nextReplayGainAlbumDb !== song.replayGainAlbumDb ||
        nextReplayGainTrackPeak !== song.replayGainTrackPeak ||
        nextReplayGainAlbumPeak !== song.replayGainAlbumPeak

      const gotAny =
        extracted.duration !== null ||
        extracted.bitrate !== null ||
        extracted.sampleRate !== null ||
        extracted.channels !== null ||
        extracted.replayGainTrackDb !== null ||
        extracted.replayGainAlbumDb !== null ||
        extracted.replayGainTrackPeak !== null ||
        extracted.replayGainAlbumPeak !== null

      if (!gotAny) {
        noMetadata += 1
        continue
      }

      if (!changed) {
        unchanged += 1
        continue
      }

      await prisma.song.update({
        where: { id: song.id },
        data: {
          duration: nextDuration,
          bitrate: nextBitrate,
          sampleRate: nextSampleRate,
          channels: nextChannels,
          replayGainTrackDb: nextReplayGainTrackDb,
          replayGainAlbumDb: nextReplayGainAlbumDb,
          replayGainTrackPeak: nextReplayGainTrackPeak,
          replayGainAlbumPeak: nextReplayGainAlbumPeak,
        },
      })
      updated += 1
    } catch {
      failed += 1
    }
  }

  console.log(
    `Done. updated=${updated} unchanged=${unchanged} missingFile=${missingFile} ` +
      `noMetadata=${noMetadata} failed=${failed}`
  )
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
