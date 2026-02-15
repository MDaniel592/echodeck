export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Fail fast if required environment variables are missing
    const { validateAuthConfig } = await import("./lib/auth")
    validateAuthConfig()
    if (process.env.NODE_ENV === "production" && !process.env.SETUP_SECRET) {
      throw new Error("SETUP_SECRET must be set in production")
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
    } catch (error) {
      console.error("Failed to recover stale tasks at startup:", error)
    }
  }
}
