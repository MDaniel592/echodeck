import { backfillPlaylistEntriesFromSongAssignments } from "../lib/playlistEntries"
import prisma from "../lib/prisma"

async function main() {
  const result = await backfillPlaylistEntriesFromSongAssignments()
  console.log(`Playlist entry backfill complete: created=${result.created}`)
}

main()
  .catch((error) => {
    console.error("Playlist entry backfill failed:", error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
