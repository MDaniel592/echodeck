import prisma from "./prisma"

type BackfillResult = {
  userId: number | null
  songsUpdated: number
  playlistsUpdated: number
  tasksUpdated: number
  taskEventsUpdated: number
}

/**
 * Assign legacy rows with null userId to the bootstrap user.
 * Safe to run multiple times.
 */
export async function backfillOwnershipToBootstrapUser(): Promise<BackfillResult> {
  const bootstrapUser = await prisma.user.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  })

  if (!bootstrapUser) {
    return {
      userId: null,
      songsUpdated: 0,
      playlistsUpdated: 0,
      tasksUpdated: 0,
      taskEventsUpdated: 0,
    }
  }

  const userId = bootstrapUser.id

  const [songs, playlists, tasks] = await Promise.all([
    prisma.song.updateMany({
      where: { userId: null },
      data: { userId },
    }),
    prisma.playlist.updateMany({
      where: { userId: null },
      data: { userId },
    }),
    prisma.downloadTask.updateMany({
      where: { userId: null },
      data: { userId },
    }),
  ])

  const fromTaskUsers = await prisma.$executeRawUnsafe(`
    UPDATE "DownloadTaskEvent"
    SET "userId" = (
      SELECT "userId"
      FROM "DownloadTask"
      WHERE "DownloadTask"."id" = "DownloadTaskEvent"."taskId"
    )
    WHERE "DownloadTaskEvent"."userId" IS NULL
      AND EXISTS (
        SELECT 1
        FROM "DownloadTask"
        WHERE "DownloadTask"."id" = "DownloadTaskEvent"."taskId"
          AND "DownloadTask"."userId" IS NOT NULL
      )
  `)

  const fallbackTaskEvents = await prisma.downloadTaskEvent.updateMany({
    where: { userId: null },
    data: { userId },
  })

  return {
    userId,
    songsUpdated: songs.count,
    playlistsUpdated: playlists.count,
    tasksUpdated: tasks.count,
    taskEventsUpdated: Number(fromTaskUsers) + fallbackTaskEvents.count,
  }
}
