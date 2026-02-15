import "dotenv/config"
import path from "path"
import Database from "better-sqlite3"

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

function countNullOwnership(db: Database.Database, tableName: string): number {
  if (!hasColumn(db, tableName, "userId")) return 0
  const row = db.prepare(`SELECT COUNT(*) as count FROM "${tableName}" WHERE userId IS NULL`).get() as { count: number }
  return row.count
}

function main() {
  const dbPath = resolveDatabasePath(process.env.DATABASE_URL)
  const db = new Database(dbPath)

  try {
    const songs = countNullOwnership(db, "Song")
    const playlists = countNullOwnership(db, "Playlist")
    const tasks = countNullOwnership(db, "DownloadTask")
    const taskEvents = countNullOwnership(db, "DownloadTaskEvent")
    const artists = countNullOwnership(db, "Artist")
    const albums = countNullOwnership(db, "Album")
    const libraries = countNullOwnership(db, "Library")

    const total = songs + playlists + tasks + taskEvents + artists + albums + libraries
    if (total > 0) {
      console.error(
        "Ownership verification failed: " +
          `songs=${songs}, playlists=${playlists}, tasks=${tasks}, taskEvents=${taskEvents}, ` +
          `artists=${artists}, albums=${albums}, libraries=${libraries}`
      )
      process.exitCode = 1
      return
    }

    console.log("Ownership verification passed.")
  } finally {
    db.close()
  }
}

try {
  main()
} catch (error) {
  console.error("Ownership verification failed:", error)
  process.exit(1)
}
