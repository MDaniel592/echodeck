import path from "path"
import fs from "fs/promises"
import prisma from "./prisma"
import { extractAudioMetadataFromFile } from "./audioMetadata"
import { normalizeSongTitle } from "./songTitle"
import { getVideoInfo } from "./ytdlp"
import { downloadSongArtwork, getSpotifyThumbnail } from "./artwork"
import { ensureArtistAlbumRefs } from "./artistAlbumRefs"
import {
  drainQueuedTaskWorkers,
  enqueueDownloadTask,
  normalizeFormat,
  normalizeQuality,
  startDownloadTaskWorker,
} from "./downloadTasks"

export type MaintenanceAction =
  | "attach_library"
  | "backfill_metadata"
  | "dedupe_library_imports"
  | "normalize_titles"
  | "fill_missing_covers"
  | "refresh_file_metadata"
  | "queue_redownload_candidates"
  | "refresh_origin_metadata"

export type MaintenanceAudit = {
  songsTotal: number
  songsWithoutLibrary: number
  songsWithoutArtistRef: number
  songsWithoutAlbumRef: number
  songsWithoutCover: number
  importSongs: number
  malformedTitles: number
  duplicateImportCandidates: number
  malformedSamples: Array<{ id: number; title: string; filePath: string }>
  importDuplicateSamples: Array<{ id: number; title: string; filePath: string }>
}

export type MaintenanceResult = {
  action: MaintenanceAction
  dryRun: boolean
  details: Record<string, number | string | boolean>
}

const MALFORMED_PREFIX = /^[0-9]{10,}[\s-]+/

function normalizeImportBasename(filePath: string): string {
  return path.basename(filePath).replace(/^[0-9]{10,}-/, "").toLowerCase()
}

function sanitizeTitleFromFilename(filePath: string, title: string): string {
  const fromPath = path.basename(filePath).replace(/\.[^.]+$/, "")
  const candidate = normalizeSongTitle((fromPath || title).replace(MALFORMED_PREFIX, "").trim(), title)
  return candidate || title
}

async function getDuplicateImportSongs(userId: number) {
  const [imports, originals] = await Promise.all([
    prisma.song.findMany({
      where: { userId, filePath: { contains: "/library-imports/" } },
      select: { id: true, title: true, filePath: true, coverPath: true, artist: true },
      orderBy: { id: "asc" },
    }),
    prisma.song.findMany({
      where: { userId, NOT: { filePath: { contains: "/library-imports/" } } },
      select: { id: true, filePath: true, coverPath: true, title: true, artist: true },
    }),
  ])

  const originalByBase = new Map<string, (typeof originals)[number]>()
  for (const row of originals) {
    const key = normalizeImportBasename(row.filePath)
    if (!originalByBase.has(key)) {
      originalByBase.set(key, row)
    }
  }

  return imports
    .map((importSong) => ({
      importSong,
      originalSong: originalByBase.get(normalizeImportBasename(importSong.filePath)) || null,
    }))
    .filter((entry) => entry.originalSong !== null)
}

export async function getMaintenanceAudit(userId: number): Promise<MaintenanceAudit> {
  const [songs, songsWithoutLibrary, songsWithoutArtistRef, songsWithoutAlbumRef, songsWithoutCover, importSongs] =
    await Promise.all([
      prisma.song.findMany({
        where: { userId },
        select: { id: true, title: true, filePath: true },
        orderBy: { id: "asc" },
      }),
      prisma.song.count({ where: { userId, libraryId: null } }),
      prisma.song.count({
        where: {
          userId,
          artistId: null,
          artist: { not: null },
        },
      }),
      prisma.song.count({
        where: {
          userId,
          albumId: null,
        },
      }),
      prisma.song.count({ where: { userId, coverPath: null } }),
      prisma.song.count({ where: { userId, filePath: { contains: "/library-imports/" } } }),
    ])

  const malformed = songs.filter((song) => MALFORMED_PREFIX.test(song.title))
  const duplicates = await getDuplicateImportSongs(userId)

  return {
    songsTotal: songs.length,
    songsWithoutLibrary,
    songsWithoutArtistRef,
    songsWithoutAlbumRef,
    songsWithoutCover,
    importSongs,
    malformedTitles: malformed.length,
    duplicateImportCandidates: duplicates.length,
    malformedSamples: malformed.slice(0, 20).map((song) => ({
      id: song.id,
      title: song.title,
      filePath: song.filePath,
    })),
    importDuplicateSamples: duplicates.slice(0, 20).map((entry) => ({
      id: entry.importSong.id,
      title: entry.importSong.title,
      filePath: entry.importSong.filePath,
    })),
  }
}

async function runAttachLibrary(userId: number, dryRun: boolean): Promise<MaintenanceResult> {
  let library = await prisma.library.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  })

  if (!library && !dryRun) {
    library = await prisma.library.create({
      data: { userId, name: "Main Library" },
      select: { id: true, name: true },
    })
  }

  const targetLibraryId = library?.id || 0
  const downloadsRoot = path.resolve(process.cwd(), "downloads")
  const songsToAttach = await prisma.song.findMany({
    where: { userId, libraryId: null },
    select: { id: true, filePath: true },
  })

  let relativePathUpdated = 0
  if (!dryRun && targetLibraryId > 0) {
    await prisma.libraryPath.upsert({
      where: {
        libraryId_path: {
          libraryId: targetLibraryId,
          path: downloadsRoot,
        },
      },
      update: { enabled: true },
      create: {
        libraryId: targetLibraryId,
        path: downloadsRoot,
        enabled: true,
      },
    })

    if (songsToAttach.length > 0) {
      await prisma.song.updateMany({
        where: { userId, id: { in: songsToAttach.map((song) => song.id) } },
        data: { libraryId: targetLibraryId },
      })

      for (const song of songsToAttach) {
        const rel =
          song.filePath.startsWith(`${downloadsRoot}${path.sep}`)
            ? song.filePath.slice(downloadsRoot.length + 1)
            : null
        await prisma.song.update({
          where: { id: song.id },
          data: { relativePath: rel },
        })
        relativePathUpdated += 1
      }
    }
  }

  return {
    action: "attach_library",
    dryRun,
    details: {
      libraryCreated: !library ? 1 : 0,
      targetLibraryId,
      songsAttached: songsToAttach.length,
      relativePathUpdated,
    },
  }
}

async function runBackfillMetadata(userId: number, dryRun: boolean): Promise<MaintenanceResult> {
  const songs = await prisma.song.findMany({
    where: {
      userId,
      artist: { not: null },
    },
    select: {
      id: true,
      artist: true,
      album: true,
      albumArtist: true,
      artistId: true,
      albumId: true,
      year: true,
    },
  })

  const normalized = songs
    .map((song) => ({
      ...song,
      artistName: song.artist?.trim() || "",
    }))
    .filter((song) => song.artistName.length > 0)

  const existingArtists = await prisma.artist.findMany({
    where: { userId },
    select: { id: true, name: true },
  })
  const artistByName = new Map(existingArtists.map((artist) => [artist.name, artist.id]))
  let createdArtists = 0
  let createdAlbums = 0
  let updatedSongs = 0

  for (const song of normalized) {
    let artistId = artistByName.get(song.artistName) || null
    if (!artistId && !dryRun) {
      const created = await prisma.artist.create({
        data: { userId, name: song.artistName },
        select: { id: true },
      }).catch(async () => {
        const found = await prisma.artist.findFirst({
          where: { userId, name: song.artistName },
          select: { id: true },
        })
        return found || { id: 0 }
      })
      artistId = created.id || null
      if (artistId) {
        artistByName.set(song.artistName, artistId)
        createdArtists += 1
      }
    }

    const albumTitle = song.album?.trim() || "Singles"
    const albumArtist = song.albumArtist?.trim() || song.artistName

    let album = await prisma.album.findFirst({
      where: { userId, title: albumTitle, albumArtist },
      select: { id: true },
    })
    if (!album && !dryRun) {
      album = await prisma.album.create({
        data: {
          userId,
          title: albumTitle,
          albumArtist,
          artistId,
          year: song.year ?? null,
        },
        select: { id: true },
      }).catch(async () => {
        const found = await prisma.album.findFirst({
          where: { userId, title: albumTitle, albumArtist },
          select: { id: true },
        })
        return found
      })
      if (album) {
        createdAlbums += 1
      }
    }

    if (!dryRun && (song.artistId !== artistId || song.albumId !== album?.id || song.album !== albumTitle || song.albumArtist !== albumArtist)) {
      await prisma.song.update({
        where: { id: song.id },
        data: {
          artistId,
          albumId: album?.id || null,
          album: albumTitle,
          albumArtist,
        },
      })
      updatedSongs += 1
    }
  }

  return {
    action: "backfill_metadata",
    dryRun,
    details: {
      candidateSongs: normalized.length,
      createdArtists,
      createdAlbums,
      updatedSongs: dryRun ? normalized.length : updatedSongs,
    },
  }
}

async function runDedupeLibraryImports(userId: number, dryRun: boolean): Promise<MaintenanceResult> {
  const duplicates = await getDuplicateImportSongs(userId)

  let deletedSongs = 0
  let reassignedPlaylistEntries = 0
  let reassignedQueueEntries = 0
  let reassignedCurrentSong = 0
  let copiedCovers = 0

  if (!dryRun) {
    for (const entry of duplicates) {
      const importSong = entry.importSong
      const originalSong = entry.originalSong
      if (!originalSong) continue

      if (!originalSong.coverPath && importSong.coverPath) {
        await prisma.song.update({
          where: { id: originalSong.id },
          data: { coverPath: importSong.coverPath },
        })
        copiedCovers += 1
      }

      const playlistResult = await prisma.playlistSong.updateMany({
        where: { songId: importSong.id },
        data: { songId: originalSong.id },
      })
      reassignedPlaylistEntries += playlistResult.count

      const queueResult = await prisma.playbackQueueItem.updateMany({
        where: { songId: importSong.id },
        data: { songId: originalSong.id },
      })
      reassignedQueueEntries += queueResult.count

      const currentResult = await prisma.playbackSession.updateMany({
        where: { userId, currentSongId: importSong.id },
        data: { currentSongId: originalSong.id },
      })
      reassignedCurrentSong += currentResult.count

      await prisma.song.delete({ where: { id: importSong.id } })
      deletedSongs += 1
    }
  }

  return {
    action: "dedupe_library_imports",
    dryRun,
    details: {
      duplicateCandidates: duplicates.length,
      deletedSongs,
      reassignedPlaylistEntries,
      reassignedQueueEntries,
      reassignedCurrentSong,
      copiedCovers,
    },
  }
}

async function runNormalizeTitles(userId: number, dryRun: boolean): Promise<MaintenanceResult> {
  const songs = await prisma.song.findMany({
    where: { userId },
    select: { id: true, title: true, filePath: true },
  })

  const candidates = songs
    .map((song) => ({
      ...song,
      cleaned: sanitizeTitleFromFilename(song.filePath, song.title),
    }))
    .filter((song) => song.cleaned !== song.title)

  if (!dryRun) {
    for (const song of candidates) {
      await prisma.song.update({
        where: { id: song.id },
        data: { title: song.cleaned.slice(0, 500) },
      })
    }
  }

  return {
    action: "normalize_titles",
    dryRun,
    details: {
      candidateSongs: candidates.length,
      updatedSongs: dryRun ? candidates.length : candidates.length,
    },
  }
}

async function runFillMissingCovers(userId: number, dryRun: boolean): Promise<MaintenanceResult> {
  const [withoutCover, withCover] = await Promise.all([
    prisma.song.findMany({
      where: { userId, coverPath: null },
      select: { id: true, filePath: true, title: true, artist: true },
    }),
    prisma.song.findMany({
      where: { userId, coverPath: { not: null } },
      select: { id: true, filePath: true, title: true, artist: true, coverPath: true },
    }),
  ])

  const byBase = new Map<string, string>()
  const byTitleArtist = new Map<string, string>()
  for (const song of withCover) {
    if (!song.coverPath) continue
    byBase.set(normalizeImportBasename(song.filePath), song.coverPath)
    byTitleArtist.set(`${song.title}::${song.artist || ""}`, song.coverPath)
  }

  const candidates = withoutCover
    .map((song) => ({
      id: song.id,
      coverPath:
        byBase.get(normalizeImportBasename(song.filePath)) ||
        byTitleArtist.get(`${song.title}::${song.artist || ""}`) ||
        null,
    }))
    .filter((song) => song.coverPath)

  if (!dryRun) {
    for (const song of candidates) {
      await prisma.song.update({
        where: { id: song.id },
        data: { coverPath: song.coverPath },
      })
    }
  }

  return {
    action: "fill_missing_covers",
    dryRun,
    details: {
      candidateSongs: candidates.length,
      updatedSongs: dryRun ? candidates.length : candidates.length,
    },
  }
}

async function runRefreshFileMetadata(userId: number, dryRun: boolean): Promise<MaintenanceResult> {
  const songs = await prisma.song.findMany({
    where: { userId },
    select: {
      id: true,
      filePath: true,
      title: true,
      artist: true,
      album: true,
      albumArtist: true,
      genre: true,
      year: true,
      trackNumber: true,
      discNumber: true,
      duration: true,
      bitrate: true,
      sampleRate: true,
      channels: true,
      isrc: true,
      lyrics: true,
    },
    orderBy: { id: "asc" },
  })

  let scannedSongs = 0
  let missingFiles = 0
  let noMetadataFound = 0
  let updatedSongs = 0
  let failedSongs = 0

  for (const song of songs) {
    scannedSongs += 1
    try {
      await fs.access(song.filePath)
    } catch {
      missingFiles += 1
      continue
    }

    const extracted = await extractAudioMetadataFromFile(song.filePath)
    const hasAnyExtracted =
      extracted.title !== null ||
      extracted.artist !== null ||
      extracted.album !== null ||
      extracted.albumArtist !== null ||
      extracted.genre !== null ||
      extracted.year !== null ||
      extracted.trackNumber !== null ||
      extracted.discNumber !== null ||
      extracted.duration !== null ||
      extracted.bitrate !== null ||
      extracted.sampleRate !== null ||
      extracted.channels !== null ||
      extracted.isrc !== null ||
      extracted.lyrics !== null

    if (!hasAnyExtracted) {
      noMetadataFound += 1
      continue
    }

    const nextTitle = extracted.title ?? song.title
    const nextArtist = extracted.artist ?? song.artist
    const nextAlbum = extracted.album ?? song.album
    const nextAlbumArtist = extracted.albumArtist ?? song.albumArtist
    const nextGenre = extracted.genre ?? song.genre
    const nextYear = extracted.year ?? song.year
    const nextTrack = extracted.trackNumber ?? song.trackNumber
    const nextDisc = extracted.discNumber ?? song.discNumber
    const nextDuration = extracted.duration ?? song.duration
    const nextBitrate = extracted.bitrate ?? song.bitrate
    const nextSampleRate = extracted.sampleRate ?? song.sampleRate
    const nextChannels = extracted.channels ?? song.channels
    const nextIsrc = extracted.isrc ?? song.isrc
    const nextLyrics = extracted.lyrics ?? song.lyrics

    const changed =
      nextTitle !== song.title ||
      nextArtist !== song.artist ||
      nextAlbum !== song.album ||
      nextAlbumArtist !== song.albumArtist ||
      nextGenre !== song.genre ||
      nextYear !== song.year ||
      nextTrack !== song.trackNumber ||
      nextDisc !== song.discNumber ||
      nextDuration !== song.duration ||
      nextBitrate !== song.bitrate ||
      nextSampleRate !== song.sampleRate ||
      nextChannels !== song.channels ||
      nextIsrc !== song.isrc ||
      nextLyrics !== song.lyrics

    if (!changed) continue

    if (!dryRun) {
      try {
        await prisma.song.update({
          where: { id: song.id },
          data: {
            title: nextTitle,
            artist: nextArtist,
            album: nextAlbum,
            albumArtist: nextAlbumArtist,
            genre: nextGenre,
            year: nextYear,
            trackNumber: nextTrack,
            discNumber: nextDisc,
            duration: nextDuration,
            bitrate: nextBitrate,
            sampleRate: nextSampleRate,
            channels: nextChannels,
            isrc: nextIsrc,
            lyrics: nextLyrics,
          },
        })
      } catch {
        failedSongs += 1
        continue
      }
    }

    updatedSongs += 1
  }

  return {
    action: "refresh_file_metadata",
    dryRun,
    details: {
      scannedSongs,
      updatedSongs,
      missingFiles,
      noMetadataFound,
      failedSongs,
    },
  }
}

async function runQueueRedownloadCandidates(
  userId: number,
  dryRun: boolean
): Promise<MaintenanceResult> {
  const songs = await prisma.song.findMany({
    where: {
      userId,
      sourceUrl: { not: null },
      source: { in: ["youtube", "soundcloud", "spotify"] },
    },
    select: {
      id: true,
      source: true,
      sourceUrl: true,
      format: true,
      quality: true,
      duration: true,
      bitrate: true,
      filePath: true,
    },
    orderBy: { id: "asc" },
  })

  let checkedSongs = 0
  let missingFiles = 0
  let missingMetadata = 0
  let candidates = 0
  let skippedActive = 0
  let queuedTasks = 0

  const activeTasks = await prisma.downloadTask.findMany({
    where: {
      userId,
      status: { in: ["queued", "running"] },
    },
    select: { sourceUrl: true },
  })
  const activeUrls = new Set(activeTasks.map((task) => task.sourceUrl))

  for (const song of songs) {
    checkedSongs += 1

    let hasFile = true
    try {
      await fs.access(song.filePath)
    } catch {
      hasFile = false
      missingFiles += 1
    }

    const lacksTechnicalMetadata = song.duration === null || song.bitrate === null
    if (lacksTechnicalMetadata) {
      missingMetadata += 1
    }

    if (hasFile && !lacksTechnicalMetadata) continue
    if (!song.sourceUrl) continue

    candidates += 1
    if (activeUrls.has(song.sourceUrl)) {
      skippedActive += 1
      continue
    }

    if (!dryRun) {
      await enqueueDownloadTask({
        userId,
        source: song.source as "youtube" | "soundcloud" | "spotify",
        sourceUrl: song.sourceUrl,
        format: normalizeFormat(song.format),
        quality: normalizeQuality(song.quality),
      })
      activeUrls.add(song.sourceUrl)
    }
    queuedTasks += 1
  }

  let startedWorkers = 0
  if (!dryRun && queuedTasks > 0) {
    // Try to start at least one worker immediately, then fill remaining slots.
    const oldestQueued = await prisma.downloadTask.findFirst({
      where: { userId, status: "queued", workerPid: null },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    })
    if (oldestQueued) {
      const started = await startDownloadTaskWorker(oldestQueued.id)
      if (started) startedWorkers += 1
    }
    startedWorkers += await drainQueuedTaskWorkers()
  }

  return {
    action: "queue_redownload_candidates",
    dryRun,
    details: {
      checkedSongs,
      missingFiles,
      missingMetadata,
      candidates,
      skippedActive,
      queuedTasks,
      startedWorkers,
    },
  }
}

async function runRefreshOriginMetadata(
  userId: number,
  dryRun: boolean
): Promise<MaintenanceResult> {
  const songs = await prisma.song.findMany({
    where: {
      userId,
      sourceUrl: { not: null },
      source: { in: ["youtube", "soundcloud", "spotify"] },
    },
    select: {
      id: true,
      source: true,
      sourceUrl: true,
      title: true,
      artist: true,
      album: true,
      albumArtist: true,
      year: true,
      duration: true,
      thumbnail: true,
      coverPath: true,
    },
    orderBy: { id: "asc" },
  })

  let checkedSongs = 0
  let updatedSongs = 0
  let artworkUpdated = 0
  let failedSongs = 0
  let skippedSongs = 0

  for (const song of songs) {
    checkedSongs += 1
    const sourceUrl = song.sourceUrl?.trim() || ""
    if (!sourceUrl) {
      skippedSongs += 1
      continue
    }

    try {
      let nextTitle = song.title
      let nextArtist = song.artist
      let nextAlbum = song.album
      let nextAlbumArtist = song.albumArtist
      let nextDuration = song.duration
      let nextThumbnail = song.thumbnail

      if (song.source === "youtube" || song.source === "soundcloud") {
        const info = await getVideoInfo(sourceUrl)
        nextTitle = normalizeSongTitle(info.title || song.title || "Unknown title")
        nextArtist = info.artist || song.artist
        nextDuration = info.duration ?? song.duration
        nextThumbnail = info.thumbnail || song.thumbnail
        if (!nextAlbum && nextArtist) nextAlbum = "Singles"
        if (!nextAlbumArtist && nextArtist) nextAlbumArtist = nextArtist
      } else if (song.source === "spotify") {
        const thumb = await getSpotifyThumbnail(sourceUrl)
        if (thumb) nextThumbnail = thumb
        if (!nextAlbum && (nextArtist || song.artist)) nextAlbum = "Singles"
        if (!nextAlbumArtist && (nextArtist || song.artist)) nextAlbumArtist = nextArtist || song.artist
      }

      const refs = await ensureArtistAlbumRefs({
        userId,
        artist: nextArtist,
        album: nextAlbum,
        albumArtist: nextAlbumArtist,
        year: song.year ?? null,
      })

      const metadataChanged =
        nextTitle !== song.title ||
        nextArtist !== song.artist ||
        refs.album !== song.album ||
        refs.albumArtist !== song.albumArtist ||
        nextDuration !== song.duration ||
        nextThumbnail !== song.thumbnail

      if (!dryRun && metadataChanged) {
        await prisma.song.update({
          where: { id: song.id },
          data: {
            title: nextTitle,
            artist: nextArtist,
            album: refs.album,
            albumArtist: refs.albumArtist,
            artistId: refs.artistId,
            albumId: refs.albumId,
            duration: nextDuration,
            thumbnail: nextThumbnail,
          },
        })
      }
      if (metadataChanged) updatedSongs += 1

      if (!dryRun && nextThumbnail) {
        const coverPath = await downloadSongArtwork(song.id, nextThumbnail)
        if (coverPath && coverPath !== song.coverPath) {
          await prisma.song.update({
            where: { id: song.id },
            data: { coverPath },
          })
          artworkUpdated += 1
        }
      }
    } catch {
      failedSongs += 1
    }
  }

  return {
    action: "refresh_origin_metadata",
    dryRun,
    details: {
      checkedSongs,
      updatedSongs,
      artworkUpdated,
      failedSongs,
      skippedSongs,
    },
  }
}

export async function runMaintenanceAction(
  userId: number,
  action: MaintenanceAction,
  dryRun: boolean
): Promise<MaintenanceResult> {
  if (action === "attach_library") return runAttachLibrary(userId, dryRun)
  if (action === "backfill_metadata") return runBackfillMetadata(userId, dryRun)
  if (action === "dedupe_library_imports") return runDedupeLibraryImports(userId, dryRun)
  if (action === "normalize_titles") return runNormalizeTitles(userId, dryRun)
  if (action === "fill_missing_covers") return runFillMissingCovers(userId, dryRun)
  if (action === "refresh_file_metadata") return runRefreshFileMetadata(userId, dryRun)
  if (action === "queue_redownload_candidates") return runQueueRedownloadCandidates(userId, dryRun)
  if (action === "refresh_origin_metadata") return runRefreshOriginMetadata(userId, dryRun)
  throw new Error(`Unsupported action: ${action}`)
}
