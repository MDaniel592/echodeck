import { backfillOwnershipToBootstrapUser } from "../lib/ownershipBackfill"
import prisma from "../lib/prisma"

async function main() {
  const result = await backfillOwnershipToBootstrapUser()
  if (!result.userId) {
    console.log("Ownership backfill skipped: no users found.")
    return
  }

  console.log(
    `Ownership backfill complete for user ${result.userId}: ` +
      `songs=${result.songsUpdated}, playlists=${result.playlistsUpdated}, ` +
      `tasks=${result.tasksUpdated}, taskEvents=${result.taskEventsUpdated}, ` +
      `artists=${result.artistsUpdated}, albums=${result.albumsUpdated}, libraries=${result.librariesUpdated}`
  )
}

main()
  .catch((error) => {
    console.error("Ownership backfill failed:", error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
