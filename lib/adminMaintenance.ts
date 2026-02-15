import path from "path"
import prisma from "./prisma"

export type MaintenanceAction =
  | "attach_library"
  | "backfill_metadata"
  | "dedupe_library_imports"
  | "normalize_titles"
  | "fill_missing_covers"

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
  const candidate = (fromPath || title).replace(MALFORMED_PREFIX, "").trim()
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
  throw new Error(`Unsupported action: ${action}`)
}
