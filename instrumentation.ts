export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Fail fast if required environment variables are missing
    const { validateAuthConfig } = await import("./lib/auth")
    validateAuthConfig()
    if (process.env.NODE_ENV === "production" && !process.env.SETUP_SECRET) {
      throw new Error("SETUP_SECRET must be set in production")
    }

    // Ensure legacy rows have ownership after schema upgrades.
    try {
      const { backfillOwnershipToBootstrapUser } = await import("./lib/ownershipBackfill")
      const result = await backfillOwnershipToBootstrapUser()
      if (
        result.userId &&
        (
          result.songsUpdated ||
          result.playlistsUpdated ||
          result.tasksUpdated ||
          result.taskEventsUpdated ||
          result.artistsUpdated ||
          result.albumsUpdated ||
          result.librariesUpdated
        )
      ) {
        console.log(
          `Ownership backfill applied for user ${result.userId}: ` +
            `songs=${result.songsUpdated}, playlists=${result.playlistsUpdated}, ` +
            `tasks=${result.tasksUpdated}, taskEvents=${result.taskEventsUpdated}, ` +
            `artists=${result.artistsUpdated}, albums=${result.albumsUpdated}, libraries=${result.librariesUpdated}`
        )
      }
    } catch (error) {
      console.error("Failed to run ownership backfill at startup:", error)
    }

    try {
      const { ensureSubsonicTokens } = await import("./lib/subsonicTokens")
      const generated = await ensureSubsonicTokens()
      if (generated > 0) {
        console.log(`Generated ${generated} missing Subsonic token(s).`)
      }
    } catch (error) {
      console.error("Failed to ensure Subsonic tokens at startup:", error)
    }

    // Recover any tasks left in "running" state from a previous crash
    try {
      const { recoverStaleTasks } = await import("./lib/downloadTasks")
      const recovered = await recoverStaleTasks()
      if (recovered > 0) {
        console.log(`Recovered ${recovered} stale download task(s) from previous run.`)
      }

      const { drainQueuedTaskWorkers } = await import("./lib/downloadTasks")
      const started = await drainQueuedTaskWorkers()
      if (started > 0) {
        console.log(`Started ${started} queued download task worker(s) at startup.`)
      }

      const { recoverLibraryScanQueue, startLibraryScanScheduler } = await import("./lib/libraryScanQueue")
      const scanRecovery = await recoverLibraryScanQueue()
      if (scanRecovery.failedRunning > 0) {
        console.log(`Marked ${scanRecovery.failedRunning} interrupted library scan(s) as failed.`)
      }
      if (scanRecovery.queuedStarted > 0) {
        console.log(`Started ${scanRecovery.queuedStarted} queued library scan(s) at startup.`)
      }
      startLibraryScanScheduler()
    } catch (error) {
      console.error("Failed to recover stale tasks at startup:", error)
    }
  }
}
