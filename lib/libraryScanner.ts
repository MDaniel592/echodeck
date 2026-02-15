import fs from "fs/promises"
import path from "path"
import crypto from "crypto"
import prisma from "./prisma"

const AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".flac",
  ".wav",
  ".ogg",
  ".m4a",
  ".aac",
  ".opus",
  ".wma",
  ".aiff",
  ".alac",
])

const MAX_FILES_PER_SCAN = 10_000

function toTitleFromFileName(filePath: string): string {
  const base = path.basename(filePath, path.extname(filePath))
  return base.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() || "Unknown title"
}

function inferArtistAndAlbum(filePath: string): { artist: string | null; album: string | null } {
  const parts = filePath.split(path.sep).filter(Boolean)
  if (parts.length < 2) return { artist: null, album: null }

  const artist = parts.at(-3) || null
  const album = parts.at(-2) || null
  return { artist, album }
}

async function listAudioFiles(rootPath: string): Promise<string[]> {
  const result: string[] = []
  const stack: string[] = [rootPath]

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
        continue
      }
      if (!entry.isFile()) continue
      const ext = path.extname(entry.name).toLowerCase()
      if (AUDIO_EXTENSIONS.has(ext)) {
        result.push(fullPath)
        if (result.length >= MAX_FILES_PER_SCAN) return result
      }
    }
  }

  return result
}

function getImportRoot(userId: number, libraryId: number): string {
  return path.join(process.cwd(), "downloads", "library-imports", String(userId), String(libraryId))
}

async function ensureFileCopied(
  sourcePath: string,
  relativePath: string,
  userId: number,
  libraryId: number
): Promise<string> {
  const importRoot = getImportRoot(userId, libraryId)
  const destination = path.join(importRoot, relativePath)
  await fs.mkdir(path.dirname(destination), { recursive: true })
  await fs.copyFile(sourcePath, destination)
  return destination
}

export type LibraryScanStats = {
  scannedFiles: number
  createdSongs: number
  updatedSongs: number
  skippedSongs: number
  errors: number
}

export async function runLibraryScan(userId: number, libraryId: number): Promise<LibraryScanStats> {
  const library = await prisma.library.findFirst({
    where: { id: libraryId, userId },
    include: { paths: { where: { enabled: true } } },
  })
  if (!library) {
    throw new Error("Library not found")
  }

  const scanRun = await prisma.libraryScanRun.create({
    data: {
      libraryId: library.id,
      status: "running",
    },
  })

  const stats: LibraryScanStats = {
    scannedFiles: 0,
    createdSongs: 0,
    updatedSongs: 0,
    skippedSongs: 0,
    errors: 0,
  }

  const artistCache = new Map<string, number>()
  const albumCache = new Map<string, number>()

  try {
    for (const libraryPath of library.paths) {
      let files: string[] = []
      try {
        files = await listAudioFiles(libraryPath.path)
      } catch {
        stats.errors += 1
        continue
      }

      for (const file of files) {
        stats.scannedFiles += 1
        try {
          const relativePath = path.relative(libraryPath.path, file)
          if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
            stats.skippedSongs += 1
            continue
          }

          const sourceUrl = `library:${library.id}:${relativePath}`
          const existing = await prisma.song.findFirst({
            where: {
              userId,
              source: "library",
              sourceUrl,
            },
          })

          const fileStat = await fs.stat(file)
          const destination = await ensureFileCopied(file, relativePath, userId, library.id)
          const inferred = inferArtistAndAlbum(relativePath)
          const title = toTitleFromFileName(relativePath)
          const format = path.extname(file).slice(1).toLowerCase() || "unknown"

          let artistId: number | null = null
          if (inferred.artist) {
            const normalized = inferred.artist.toLowerCase()
            if (artistCache.has(normalized)) {
              artistId = artistCache.get(normalized) ?? null
            } else {
              const artist = await prisma.artist.upsert({
                where: {
                  userId_name: { userId, name: inferred.artist },
                },
                update: {},
                create: {
                  userId,
                  name: inferred.artist,
                },
                select: { id: true },
              })
              artistId = artist.id
              artistCache.set(normalized, artist.id)
            }
          }

          let albumId: number | null = null
          if (inferred.album) {
            const normalized = `${inferred.album.toLowerCase()}::${(inferred.artist || "").toLowerCase()}`
            if (albumCache.has(normalized)) {
              albumId = albumCache.get(normalized) ?? null
            } else {
              const album = await prisma.album.upsert({
                where: {
                  userId_title_albumArtist: {
                    userId,
                    title: inferred.album,
                    albumArtist: inferred.artist || "",
                  },
                },
                update: {
                  artistId,
                },
                create: {
                  userId,
                  title: inferred.album,
                  albumArtist: inferred.artist,
                  artistId,
                },
                select: { id: true },
              })
              albumId = album.id
              albumCache.set(normalized, album.id)
            }
          }

          if (existing) {
            await prisma.song.update({
              where: { id: existing.id },
              data: {
                title,
                artist: inferred.artist,
                album: inferred.album,
                albumArtist: inferred.artist,
                artistId,
                albumId,
                filePath: destination,
                relativePath,
                fileMtime: fileStat.mtime,
                fileSize: fileStat.size,
                format,
                libraryId: library.id,
              },
            })
            stats.updatedSongs += 1
          } else {
            await prisma.song.create({
              data: {
                userId,
                title,
                artist: inferred.artist,
                album: inferred.album,
                albumArtist: inferred.artist,
                artistId,
                albumId,
                source: "library",
                sourceUrl,
                format,
                filePath: destination,
                relativePath,
                fileMtime: fileStat.mtime,
                fileSize: fileStat.size,
                quality: null,
                thumbnail: null,
                coverPath: null,
                libraryId: library.id,
                fileHash: crypto
                  .createHash("sha1")
                  .update(`${fileStat.size}:${fileStat.mtimeMs}:${relativePath}`)
                  .digest("hex"),
              },
            })
            stats.createdSongs += 1
          }
        } catch {
          stats.errors += 1
        }
      }

      await prisma.libraryPath.update({
        where: { id: libraryPath.id },
        data: { lastScannedAt: new Date() },
      })
    }

    await prisma.libraryScanRun.update({
      where: { id: scanRun.id },
      data: {
        status: "completed",
        finishedAt: new Date(),
        statsJson: JSON.stringify(stats),
      },
    })
  } catch (error) {
    await prisma.libraryScanRun.update({
      where: { id: scanRun.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        error: error instanceof Error ? error.message : "Scan failed",
        statsJson: JSON.stringify(stats),
      },
    })
    throw error
  }

  return stats
}
