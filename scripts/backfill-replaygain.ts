import fs from "fs/promises"
import prisma from "../lib/prisma"
import { analyzeAndTagReplayGain } from "../lib/audioNormalize"

type SongRow = {
  id: number
  title: string
  filePath: string
  replayGainTrackDb: number | null
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
  const all = process.argv.includes("--all")
  const limit = parseLimit()

  const songs = await prisma.song.findMany({
    select: {
      id: true,
      title: true,
      filePath: true,
      replayGainTrackDb: true,
    },
    where: all ? undefined : { replayGainTrackDb: null },
    orderBy: { id: "asc" },
  })

  const candidates = limit ? songs.slice(0, limit) : songs
  console.log(
    `Backfill ReplayGain: scanning ${candidates.length} song(s) ` +
      `(mode=${all ? "all" : "missing-only"}${limit ? ` limit=${limit}` : ""})`
  )

  let updated = 0
  let skipped = 0
  let missingFile = 0
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
      console.log(`  [${song.id}] missing file: ${song.filePath}`)
      continue
    }

    try {
      const result = await analyzeAndTagReplayGain(song.filePath)
      if (!result) {
        skipped += 1
        continue
      }

      await prisma.song.update({
        where: { id: song.id },
        data: {
          replayGainTrackDb: result.trackGainDb,
          replayGainTrackPeak: result.trackPeak,
        },
      })
      console.log(`  [${song.id}] ${song.title}: ${result.trackGainDb.toFixed(2)} dB`)
      updated += 1
    } catch {
      failed += 1
      console.log(`  [${song.id}] failed: ${song.title}`)
    }
  }

  console.log(
    `Done. updated=${updated} skipped=${skipped} missingFile=${missingFile} failed=${failed}`
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
