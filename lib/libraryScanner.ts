import fs from "fs/promises"
import path from "path"
import crypto from "crypto"
import prisma from "./prisma"
import { extractAudioMetadataFromFile } from "./audioMetadata"
import { normalizeSongTitle } from "./songTitle"

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
const DOWNLOADS_ROOT = path.join(process.cwd(), "downloads")

function toTitleFromFileName(filePath: string): string {
  const base = path.basename(filePath, path.extname(filePath))
  return normalizeSongTitle(base)
}

function inferArtistAndAlbum(filePath: string): { artist: string | null; album: string | null } {
  const parts = filePath.split(path.sep).filter(Boolean)
  if (parts.length < 2) return { artist: null, album: null }

  const artist = parts.at(-3) || null
  const album = parts.at(-2) || null
  return { artist, album }
}

function inferTrackAndTitle(relativePath: string): { trackNumber: number | null; title: string } {
  const base = path.basename(relativePath, path.extname(relativePath))
  const normalized = base.replace(/[_]+/g, " ").trim()

  const patterns = [
    /^(\d{1,2})\s*[-.]\s*(.+)$/i,
    /^track\s*(\d{1,2})\s*[-.]\s*(.+)$/i,
    /^(\d{1,2})\s+(.+)$/i,
  ]

  for (const pattern of patterns) {
    const match = normalized.match(pattern)
    if (match?.[1] && match?.[2]) {
      const trackNumber = Number.parseInt(match[1], 10)
      if (Number.isInteger(trackNumber) && trackNumber > 0) {
        return {
          trackNumber,
          title: match[2].trim(),
        }
      }
    }
  }

  return {
    trackNumber: null,
    title: toTitleFromFileName(relativePath),
  }
}

function inferYear(albumName: string | null): number | null {
  if (!albumName) return null
  const match = albumName.match(/\b(19\d{2}|20\d{2}|2100)\b/)
  if (!match?.[1]) return null
  const parsed = Number.parseInt(match[1], 10)
  return Number.isInteger(parsed) ? parsed : null
}

function inferDiscNumber(relativePath: string): number | null {
  const parts = relativePath.split(path.sep).filter(Boolean)
  for (const part of parts) {
    const match = part.match(/\b(?:disc|cd)\s*(\d{1,2})\b/i)
    if (match?.[1]) {
      const discNumber = Number.parseInt(match[1], 10)
      if (Number.isInteger(discNumber) && discNumber > 0) return discNumber
    }
  }
  return null
}

async function listAudioFiles(rootPath: string): Promise<string[]> {
  const result: string[] = []
  const stack: string[] = [rootPath]
  const normalizedRoot = path.resolve(rootPath)

  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        const resolved = path.resolve(fullPath)
        const relativeFromRoot = path.relative(normalizedRoot, resolved)
        if (!relativeFromRoot.startsWith("..") && !path.isAbsolute(relativeFromRoot)) {
          const parts = relativeFromRoot.split(path.sep).filter(Boolean)
          // Avoid recursively scanning generated import artifacts.
          if (parts.includes("library-imports")) {
            continue
          }
        }
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
  const resolvedSource = path.resolve(sourcePath)
  if (resolvedSource.startsWith(`${DOWNLOADS_ROOT}${path.sep}`)) {
    return resolvedSource
  }

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

type RunLibraryScanOptions = {
  scanRunId?: number
}

export async function runLibraryScan(
  userId: number,
  libraryId: number,
  options: RunLibraryScanOptions = {}
): Promise<LibraryScanStats> {
  const library = await prisma.library.findFirst({
    where: { id: libraryId, userId },
    include: { paths: { where: { enabled: true } } },
  })
  if (!library) {
    throw new Error("Library not found")
  }

  const scanRun = options.scanRunId
    ? await prisma.libraryScanRun.update({
        where: { id: options.scanRunId },
        data: {
          status: "running",
          startedAt: new Date(),
          finishedAt: null,
          statsJson: null,
          error: null,
        },
      })
    : await prisma.libraryScanRun.create({
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
          const extracted = await extractAudioMetadataFromFile(file)
          const inferred = inferArtistAndAlbum(relativePath)
          const inferredTrack = inferTrackAndTitle(relativePath)
          const title = normalizeSongTitle(extracted.title || inferredTrack.title || "Unknown title")
          const artistName = extracted.artist || inferred.artist
          const albumName = extracted.album || inferred.album
          const albumArtist = extracted.albumArtist || artistName
          const trackNumber = extracted.trackNumber || inferredTrack.trackNumber
          const discNumber = extracted.discNumber || inferDiscNumber(relativePath)
          const year = extracted.year || inferYear(albumName)
          const format = path.extname(file).slice(1).toLowerCase() || "unknown"

          let artistId: number | null = null
          if (artistName) {
            const normalized = artistName.toLowerCase()
            if (artistCache.has(normalized)) {
              artistId = artistCache.get(normalized) ?? null
            } else {
              const artist = await prisma.artist.upsert({
                where: {
                  userId_name: { userId, name: artistName },
                },
                update: {},
                create: {
                  userId,
                  name: artistName,
                },
                select: { id: true },
              })
              artistId = artist.id
              artistCache.set(normalized, artist.id)
            }
          }

          let albumId: number | null = null
          if (albumName) {
            const normalized = `${albumName.toLowerCase()}::${(albumArtist || "").toLowerCase()}`
            if (albumCache.has(normalized)) {
              albumId = albumCache.get(normalized) ?? null
            } else {
              const album = await prisma.album.upsert({
                where: {
                  userId_title_albumArtist: {
                    userId,
                    title: albumName,
                    albumArtist: albumArtist || "",
                  },
                },
                update: {
                  artistId,
                  year,
                },
                create: {
                  userId,
                  title: albumName,
                  albumArtist,
                  artistId,
                  year,
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
                artist: artistName,
                album: albumName,
                albumArtist,
                genre: extracted.genre,
                isrc: extracted.isrc,
                lyrics: extracted.lyrics,
                duration: extracted.duration,
                bitrate: extracted.bitrate,
                sampleRate: extracted.sampleRate,
                channels: extracted.channels,
                year,
                discNumber,
                trackNumber,
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
                artist: artistName,
                album: albumName,
                albumArtist,
                genre: extracted.genre,
                isrc: extracted.isrc,
                lyrics: extracted.lyrics,
                duration: extracted.duration,
                bitrate: extracted.bitrate,
                sampleRate: extracted.sampleRate,
                channels: extracted.channels,
                year,
                discNumber,
                trackNumber,
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
