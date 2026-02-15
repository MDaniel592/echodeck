import "dotenv/config"
import path from "path"
import Database from "better-sqlite3"

type BackfillResult = {
  userId: number | null
  songsUpdated: number
  playlistsUpdated: number
  tasksUpdated: number
  taskEventsUpdated: number
  artistsUpdated: number
  albumsUpdated: number
  librariesUpdated: number
}

function resolveDatabasePath(databaseUrl: string | undefined): string {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set")
  }
  if (!databaseUrl.startsWith("file:")) {
    throw new Error("Only sqlite DATABASE_URL values with file: are supported")
  }

  const rawPath = databaseUrl.slice("file:".length)
  if (!rawPath) {
    throw new Error("DATABASE_URL file path is empty")
  }

  return path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath)
}

function tableExists(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1`)
    .get(tableName)
  return Boolean(row)
}

function hasColumn(db: Database.Database, tableName: string, columnName: string): boolean {
  if (!tableExists(db, tableName)) return false
  const rows = db.prepare(`PRAGMA table_info("${tableName}")`).all() as Array<{ name: string }>
  return rows.some((row) => row.name === columnName)
}

export async function backfillOwnershipToBootstrapUser(): Promise<BackfillResult> {
  const dbPath = resolveDatabasePath(process.env.DATABASE_URL)
  const db = new Database(dbPath)

  try {
    if (!tableExists(db, "User")) {
      return {
        userId: null,
        songsUpdated: 0,
        playlistsUpdated: 0,
        tasksUpdated: 0,
        taskEventsUpdated: 0,
        artistsUpdated: 0,
        albumsUpdated: 0,
        librariesUpdated: 0,
      }
    }

    const userRow = db
      .prepare('SELECT id FROM "User" ORDER BY createdAt ASC LIMIT 1')
      .get() as { id: number } | undefined

    if (!userRow) {
      return {
        userId: null,
        songsUpdated: 0,
        playlistsUpdated: 0,
        tasksUpdated: 0,
        taskEventsUpdated: 0,
        artistsUpdated: 0,
        albumsUpdated: 0,
        librariesUpdated: 0,
      }
    }

    const userId = userRow.id
    let songsUpdated = 0
    let playlistsUpdated = 0
    let tasksUpdated = 0
    let taskEventsUpdated = 0
    let artistsUpdated = 0
    let albumsUpdated = 0
    let librariesUpdated = 0

    const tx = db.transaction(() => {
      if (hasColumn(db, "Song", "userId")) {
        songsUpdated = db.prepare('UPDATE "Song" SET userId = ? WHERE userId IS NULL').run(userId).changes
      }

      if (hasColumn(db, "Playlist", "userId")) {
        playlistsUpdated = db.prepare('UPDATE "Playlist" SET userId = ? WHERE userId IS NULL').run(userId).changes
      }

      if (hasColumn(db, "DownloadTask", "userId")) {
        tasksUpdated = db.prepare('UPDATE "DownloadTask" SET userId = ? WHERE userId IS NULL').run(userId).changes
      }

      if (hasColumn(db, "Artist", "userId")) {
        artistsUpdated = db.prepare('UPDATE "Artist" SET userId = ? WHERE userId IS NULL').run(userId).changes
      }

      if (hasColumn(db, "Album", "userId")) {
        albumsUpdated = db.prepare('UPDATE "Album" SET userId = ? WHERE userId IS NULL').run(userId).changes
      }

      if (hasColumn(db, "Library", "userId")) {
        librariesUpdated = db.prepare('UPDATE "Library" SET userId = ? WHERE userId IS NULL').run(userId).changes
      }

      if (hasColumn(db, "DownloadTaskEvent", "userId") && hasColumn(db, "DownloadTask", "userId")) {
        const byTaskOwner = db
          .prepare(`
            UPDATE "DownloadTaskEvent"
            SET userId = (
              SELECT userId
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
          .run().changes

        const fallback = db
          .prepare('UPDATE "DownloadTaskEvent" SET userId = ? WHERE userId IS NULL')
          .run(userId).changes

        taskEventsUpdated = byTaskOwner + fallback
      }
    })

    tx()

    return {
      userId,
      songsUpdated,
      playlistsUpdated,
      tasksUpdated,
      taskEventsUpdated,
      artistsUpdated,
      albumsUpdated,
      librariesUpdated,
    }
  } finally {
    db.close()
  }
}
