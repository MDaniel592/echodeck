/**
 * Backfill lyrics for all songs, preferring synced LRC format.
 *
 * --clear-plain   Also clear existing plain-text (non-LRC) lyrics so they get
 *                 re-fetched with the new syncedLyrics preference.
 * --limit N       Max number of songs to process (default: all).
 * --concurrency N Parallel requests (default: 3).
 * --dry-run       Print what would happen without writing to DB.
 */
import prisma from "../lib/prisma"
import { lookupLyrics } from "../lib/lyricsProvider"
import { isLrcFormat } from "../lib/lyricsParser"

const args = process.argv.slice(2)
const CLEAR_PLAIN = args.includes("--clear-plain")
const DRY_RUN = args.includes("--dry-run")
const LIMIT = (() => {
  const i = args.indexOf("--limit")
  return i >= 0 ? parseInt(args[i + 1], 10) : 0
})()
const CONCURRENCY = (() => {
  const i = args.indexOf("--concurrency")
  return i >= 0 ? Math.max(1, parseInt(args[i + 1], 10)) : 3
})()

async function processChunk(songs: { id: number; title: string; artist: string | null; album: string | null; duration: number | null; lyrics: string | null }[]) {
  return Promise.all(songs.map(async (song) => {
    const fetched = await lookupLyrics({
      title: song.title,
      artist: song.artist || "",
      album: song.album || "",
      duration: song.duration,
      timeoutMs: 8000,
    }).catch(() => null)

    if (!fetched) {
      console.log(`  ✗ no lyrics found: [${song.id}] ${song.artist} - ${song.title}`)
      return
    }

    const fmt = isLrcFormat(fetched) ? "LRC" : "TXT"
    console.log(`  ✓ ${fmt} [${song.id}] ${song.artist} - ${song.title} (${fetched.length} chars)`)

    if (!DRY_RUN) {
      await prisma.song.update({
        where: { id: song.id },
        data: { lyrics: fetched },
      }).catch(() => {})
    }
  }))
}

async function main() {
  console.log(`Backfill lyrics — clear-plain=${CLEAR_PLAIN} dry-run=${DRY_RUN} limit=${LIMIT || "all"} concurrency=${CONCURRENCY}`)

  // Step 1: Optionally clear plain-text lyrics so they get re-fetched as LRC
  if (CLEAR_PLAIN) {
    const plainSongs = await prisma.song.findMany({
      where: { lyrics: { not: null } },
      select: { id: true, title: true, artist: true, lyrics: true },
    })
    const toReset = plainSongs.filter(s => s.lyrics && !isLrcFormat(s.lyrics))
    console.log(`\nClearing ${toReset.length} plain-text lyrics for re-fetch...`)
    for (const s of toReset) {
      console.log(`  reset [${s.id}] ${s.artist} - ${s.title}`)
      if (!DRY_RUN) {
        await prisma.song.update({ where: { id: s.id }, data: { lyrics: null } })
      }
    }
  }

  // Step 2: Fetch lyrics for songs without them
  const where = { lyrics: null, title: { not: "" } }
  const total = await prisma.song.count({ where })
  const take = LIMIT > 0 ? LIMIT : total

  console.log(`\nFetching lyrics for ${Math.min(take, total)} / ${total} songs without lyrics...\n`)

  let offset = 0
  let processed = 0

  while (processed < take) {
    const chunkSize = Math.min(CONCURRENCY, take - processed)
    const songs = await prisma.song.findMany({
      where,
      select: { id: true, title: true, artist: true, album: true, duration: true, lyrics: true },
      orderBy: { id: "asc" },
      skip: offset,
      take: chunkSize,
    })
    if (songs.length === 0) break

    await processChunk(songs)
    processed += songs.length
    offset += chunkSize

    console.log(`  [${processed}/${Math.min(take, total)}]`)
  }

  const finalCount = await prisma.song.count({ where: { lyrics: { not: null } } })
  const lrcCount = await prisma.$queryRaw<{c: bigint}[]>`SELECT COUNT(*) as c FROM Song WHERE lyrics IS NOT NULL AND SUBSTR(LTRIM(lyrics), 1, 1) = '['`

  console.log(`\nDone. ${finalCount} songs with lyrics (≈${Number(lrcCount[0]?.c ?? 0)} LRC format)`)

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
