import { afterEach, describe, expect, it, vi } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"
import Database from "better-sqlite3"
import { backfillOwnershipToBootstrapUser } from "../lib/ownershipBackfill"

function createTempDbPath(): string {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}.db`
  return path.join(os.tmpdir(), `echodeck-backfill-${suffix}`)
}

function openDb(dbPath: string): Database.Database {
  return new Database(dbPath)
}

describe("ownershipBackfill", () => {
  const createdPaths: string[] = []

  afterEach(() => {
    for (const p of createdPaths.splice(0)) {
      try {
        fs.unlinkSync(p)
      } catch {
        // ignore cleanup failures
      }
    }
    vi.unstubAllEnvs()
  })

  it("backfills null ownership columns to bootstrap user", async () => {
    const dbPath = createTempDbPath()
    createdPaths.push(dbPath)
    const db = openDb(dbPath)

    db.exec(`
      CREATE TABLE "User" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );
      CREATE TABLE "Song" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER NULL
      );
      CREATE TABLE "Playlist" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER NULL
      );
      CREATE TABLE "DownloadTask" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER NULL
      );
      CREATE TABLE "DownloadTaskEvent" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        taskId INTEGER NOT NULL,
        userId INTEGER NULL
      );
      CREATE TABLE "Artist" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER NULL
      );
      CREATE TABLE "Album" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER NULL
      );
      CREATE TABLE "Library" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER NULL
      );
    `)

    db.prepare(`INSERT INTO "User"(username, createdAt) VALUES (?, ?)`).run("admin", new Date().toISOString())
    db.prepare(`INSERT INTO "Song"(userId) VALUES (NULL), (NULL)`).run()
    db.prepare(`INSERT INTO "Playlist"(userId) VALUES (NULL)`).run()
    db.prepare(`INSERT INTO "DownloadTask"(userId) VALUES (NULL), (NULL)`).run()
    db.prepare(`INSERT INTO "DownloadTaskEvent"(taskId, userId) VALUES (1, NULL), (2, NULL)`).run()
    db.prepare(`INSERT INTO "Artist"(userId) VALUES (NULL)`).run()
    db.prepare(`INSERT INTO "Album"(userId) VALUES (NULL)`).run()
    db.prepare(`INSERT INTO "Library"(userId) VALUES (NULL)`).run()
    db.close()

    vi.stubEnv("DATABASE_URL", `file:${dbPath}`)
    const result = await backfillOwnershipToBootstrapUser()
    expect(result.userId).toBe(1)
    expect(result.songsUpdated).toBe(2)
    expect(result.playlistsUpdated).toBe(1)
    expect(result.tasksUpdated).toBe(2)
    expect(result.taskEventsUpdated).toBe(2)
    expect(result.artistsUpdated).toBe(1)
    expect(result.albumsUpdated).toBe(1)
    expect(result.librariesUpdated).toBe(1)

    const verifyDb = openDb(dbPath)
    const nullCounts = {
      songs: verifyDb.prepare(`SELECT COUNT(*) AS c FROM "Song" WHERE userId IS NULL`).get() as { c: number },
      playlists: verifyDb.prepare(`SELECT COUNT(*) AS c FROM "Playlist" WHERE userId IS NULL`).get() as { c: number },
      tasks: verifyDb.prepare(`SELECT COUNT(*) AS c FROM "DownloadTask" WHERE userId IS NULL`).get() as { c: number },
      events: verifyDb.prepare(`SELECT COUNT(*) AS c FROM "DownloadTaskEvent" WHERE userId IS NULL`).get() as { c: number },
      artists: verifyDb.prepare(`SELECT COUNT(*) AS c FROM "Artist" WHERE userId IS NULL`).get() as { c: number },
      albums: verifyDb.prepare(`SELECT COUNT(*) AS c FROM "Album" WHERE userId IS NULL`).get() as { c: number },
      libraries: verifyDb.prepare(`SELECT COUNT(*) AS c FROM "Library" WHERE userId IS NULL`).get() as { c: number },
    }
    verifyDb.close()

    expect(nullCounts.songs.c).toBe(0)
    expect(nullCounts.playlists.c).toBe(0)
    expect(nullCounts.tasks.c).toBe(0)
    expect(nullCounts.events.c).toBe(0)
    expect(nullCounts.artists.c).toBe(0)
    expect(nullCounts.albums.c).toBe(0)
    expect(nullCounts.libraries.c).toBe(0)
  })
})
