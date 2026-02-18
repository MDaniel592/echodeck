import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const prisma = {
    library: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    libraryPath: {
      upsert: vi.fn(),
    },
    song: {
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    playlistSong: {
      updateMany: vi.fn(),
    },
    playbackQueueItem: {
      updateMany: vi.fn(),
    },
    playbackSession: {
      updateMany: vi.fn(),
    },
    bookmark: {
      updateMany: vi.fn(),
    },
    shareEntry: {
      updateMany: vi.fn(),
    },
    songTagAssignment: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  }

  return {
    prisma,
    extractAudioMetadataFromFile: vi.fn(),
    getVideoInfo: vi.fn(),
    getSpotifyThumbnail: vi.fn(),
    downloadSongArtwork: vi.fn(),
    ensureArtistAlbumRefs: vi.fn(),
    lookupLyrics: vi.fn(),
    enqueueDownloadTask: vi.fn(),
    drainQueuedTaskWorkers: vi.fn(),
    normalizeFormat: vi.fn((value: unknown) => value),
    normalizeQuality: vi.fn((value: unknown) => value),
    startDownloadTaskWorker: vi.fn(),
  }
})

vi.mock("../lib/prisma", () => ({
  default: mocks.prisma,
}))

vi.mock("../lib/audioMetadata", () => ({
  extractAudioMetadataFromFile: mocks.extractAudioMetadataFromFile,
}))

vi.mock("../lib/ytdlp", () => ({
  getVideoInfo: mocks.getVideoInfo,
}))

vi.mock("../lib/artwork", () => ({
  downloadSongArtwork: mocks.downloadSongArtwork,
  getSpotifyThumbnail: mocks.getSpotifyThumbnail,
}))

vi.mock("../lib/artistAlbumRefs", () => ({
  ensureArtistAlbumRefs: mocks.ensureArtistAlbumRefs,
}))

vi.mock("../lib/lyricsProvider", () => ({
  lookupLyrics: mocks.lookupLyrics,
}))

vi.mock("../lib/downloadTasks", () => ({
  enqueueDownloadTask: mocks.enqueueDownloadTask,
  drainQueuedTaskWorkers: mocks.drainQueuedTaskWorkers,
  normalizeFormat: mocks.normalizeFormat,
  normalizeQuality: mocks.normalizeQuality,
  startDownloadTaskWorker: mocks.startDownloadTaskWorker,
}))

import { runMaintenanceAction, type MaintenanceProgress } from "../lib/adminMaintenance"

describe("adminMaintenance attach_library", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prisma.library.findFirst.mockResolvedValue(null)
    mocks.prisma.library.create.mockResolvedValue({ id: 7, name: "Main Library" })
    mocks.prisma.song.findMany.mockResolvedValue([{ id: 1, filePath: "/tmp/song.mp3" }])
    mocks.prisma.song.updateMany.mockResolvedValue({ count: 1 })
    mocks.prisma.song.update.mockResolvedValue({})
    mocks.prisma.libraryPath.upsert.mockResolvedValue({})
  })

  it("reports libraryCreated when creating the default library", async () => {
    const result = await runMaintenanceAction(1, "attach_library", false)
    expect(result.action).toBe("attach_library")
    expect(result.details.libraryCreated).toBe(1)
    expect(mocks.prisma.library.create).toHaveBeenCalledTimes(1)
  })

  it("does not report libraryCreated during dry-run", async () => {
    const result = await runMaintenanceAction(1, "attach_library", true)
    expect(result.action).toBe("attach_library")
    expect(result.details.libraryCreated).toBe(0)
    expect(mocks.prisma.library.create).not.toHaveBeenCalled()
  })
})

describe("adminMaintenance refresh_origin_metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getVideoInfo.mockResolvedValue({
      title: "New Title",
      artist: "New Artist",
      album: "New Album",
      albumArtist: "New Artist",
      year: 2020,
      duration: 200,
      thumbnail: "https://i.ytimg.com/new.jpg",
      formats: ["mp3"],
    })
    mocks.getSpotifyThumbnail.mockResolvedValue("https://i.scdn.co/new.jpg")
    mocks.downloadSongArtwork.mockResolvedValue("/covers/1.jpg")
    mocks.ensureArtistAlbumRefs.mockResolvedValue({
      artistId: 10,
      albumId: 20,
      artist: "New Artist",
      album: "Singles",
      albumArtist: "New Artist",
    })
    mocks.lookupLyrics.mockResolvedValue(null)
  })

  it("dry-run does not write song or artist/album refs", async () => {
    mocks.prisma.song.findMany.mockResolvedValue([
      {
        id: 1,
        source: "youtube",
        sourceUrl: "https://youtube.com/watch?v=abc",
        title: "Old Title",
        artist: "Old Artist",
        album: null,
        albumArtist: null,
        year: 2024,
        duration: null,
        thumbnail: null,
        coverPath: null,
      },
    ])

    const progressEvents: MaintenanceProgress[] = []
    const result = await runMaintenanceAction(1, "refresh_origin_metadata", true, (event) => {
      progressEvents.push(event)
    })

    expect(result.action).toBe("refresh_origin_metadata")
    expect(result.dryRun).toBe(true)
    expect(result.details.checkedSongs).toBe(1)
    expect(result.details.updatedSongs).toBe(1)
    expect(mocks.ensureArtistAlbumRefs).not.toHaveBeenCalled()
    expect(mocks.prisma.song.update).not.toHaveBeenCalled()
    expect(mocks.downloadSongArtwork).not.toHaveBeenCalled()

    const perItemProgress = progressEvents
      .filter((event) => event.action === "refresh_origin_metadata")
      .filter((event) => event.total === 1 && typeof event.processed === "number")
      .map((event) => event.processed)
    expect(perItemProgress).toContain(1)
  })

  it("reports per-item progress for small runs", async () => {
    mocks.prisma.song.findMany.mockResolvedValue([
      {
        id: 1,
        source: "youtube",
        sourceUrl: "https://youtube.com/watch?v=one",
        title: "One",
        artist: "Artist",
        album: null,
        albumArtist: null,
        year: 2024,
        duration: null,
        thumbnail: null,
        coverPath: null,
      },
      {
        id: 2,
        source: "youtube",
        sourceUrl: "https://youtube.com/watch?v=two",
        title: "Two",
        artist: "Artist",
        album: null,
        albumArtist: null,
        year: 2024,
        duration: null,
        thumbnail: null,
        coverPath: null,
      },
      {
        id: 3,
        source: "spotify",
        sourceUrl: "https://open.spotify.com/track/xyz",
        title: "Three",
        artist: "Artist",
        album: null,
        albumArtist: null,
        year: 2024,
        duration: null,
        thumbnail: null,
        coverPath: null,
      },
    ])

    const progressEvents: MaintenanceProgress[] = []
    await runMaintenanceAction(1, "refresh_origin_metadata", true, (event) => {
      progressEvents.push(event)
    })

    const perItemProgress = progressEvents
      .filter((event) => event.action === "refresh_origin_metadata")
      .filter((event) => event.total === 3 && typeof event.processed === "number")
      .map((event) => event.processed)

    expect(perItemProgress).toEqual([0, 1, 2, 3])
    expect(progressEvents.some((event) => event.phase === "complete")).toBe(true)
  })

  it("non-dry-run updates songs and reports configured concurrency", async () => {
    const previousConcurrency = process.env.ORIGIN_METADATA_CONCURRENCY
    process.env.ORIGIN_METADATA_CONCURRENCY = "3"
    vi.resetModules()

    const runWithEnv = (await import("../lib/adminMaintenance")).runMaintenanceAction
    const sourceSongs = [
      {
        id: 1,
        source: "youtube",
        sourceUrl: "https://youtube.com/watch?v=one",
        title: "One",
        artist: "Artist",
        album: null,
        albumArtist: null,
        year: 2024,
        duration: null,
        thumbnail: null,
        coverPath: null,
      },
      {
        id: 2,
        source: "spotify",
        sourceUrl: "https://open.spotify.com/track/xyz",
        title: "Two",
        artist: "Artist",
        album: null,
        albumArtist: null,
        year: 2024,
        duration: null,
        thumbnail: null,
        coverPath: null,
      },
    ]
    mocks.prisma.song.findMany.mockResolvedValue(sourceSongs)
    mocks.ensureArtistAlbumRefs.mockResolvedValue({
      artistId: 10,
      albumId: 20,
      artist: "New Artist",
      album: "Singles",
      albumArtist: "New Artist",
    })

    await runWithEnv(1, "refresh_origin_metadata", false)

    const calls = mocks.prisma.song.update.mock.calls.map((args) => args[0] as { data: Record<string, unknown> })
    expect(calls.some((call) => Object.prototype.hasOwnProperty.call(call.data, "title"))).toBe(true)
    expect(calls.some((call) => call.data.year === 2020)).toBe(true)
    expect(calls.some((call) => Object.prototype.hasOwnProperty.call(call.data, "coverPath"))).toBe(true)
    expect(mocks.ensureArtistAlbumRefs).toHaveBeenCalledTimes(2)

    const result = await runWithEnv(1, "refresh_origin_metadata", true)
    expect(result.details.concurrency).toBe(3)

    if (previousConcurrency === undefined) delete process.env.ORIGIN_METADATA_CONCURRENCY
    else process.env.ORIGIN_METADATA_CONCURRENCY = previousConcurrency
  })
})

describe("adminMaintenance dedupe_library_imports", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("reassigns dependent records before deleting duplicate import songs", async () => {
    mocks.prisma.song.findMany
      .mockResolvedValueOnce([
        {
          id: 91,
          title: "Track One",
          filePath: "/downloads/library-imports/1/9/1712345678-track-one.mp3",
          coverPath: "/downloads/library-imports/1/9/1712345678-track-one.cover.jpg",
          artist: "Artist",
          duration: 181,
          fileSize: 4_000_000,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 12,
          title: "Track One",
          filePath: "/downloads/Artist/Album/track-one.mp3",
          coverPath: null,
          artist: "Artist",
          duration: 181,
          fileSize: 4_000_000,
        },
      ])

    const tx = {
      song: {
        update: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue({}),
      },
      playlistSong: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
      playbackQueueItem: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      playbackSession: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      bookmark: { updateMany: vi.fn().mockResolvedValue({ count: 3 }) },
      shareEntry: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      songTagAssignment: {
        findMany: vi.fn().mockResolvedValue([{ tagId: 1 }]),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        updateMany: vi.fn().mockResolvedValue({ count: 4 }),
      },
    }
    mocks.prisma.$transaction.mockImplementation(async (callback: (transaction: unknown) => Promise<unknown>) =>
      callback(tx)
    )

    const result = await runMaintenanceAction(1, "dedupe_library_imports", false)

    expect(result.details.duplicateCandidates).toBe(1)
    expect(result.details.deletedSongs).toBe(1)
    expect(result.details.reassignedPlaylistEntries).toBe(2)
    expect(result.details.reassignedQueueEntries).toBe(1)
    expect(result.details.reassignedCurrentSong).toBe(1)
    expect(result.details.reassignedBookmarks).toBe(3)
    expect(result.details.reassignedShareEntries).toBe(1)
    expect(result.details.reassignedTagAssignments).toBe(4)
    expect(result.details.copiedCovers).toBe(1)
    expect(tx.songTagAssignment.deleteMany).toHaveBeenCalledWith({
      where: { songId: 91, tagId: { in: [1] } },
    })
    expect(tx.song.delete).toHaveBeenCalledWith({ where: { id: 91 } })
  })

  it("avoids basename-only merges without corroborating metadata", async () => {
    mocks.prisma.song.findMany
      .mockResolvedValueOnce([
        {
          id: 91,
          title: "Track One (Live)",
          filePath: "/downloads/library-imports/1/9/1712345678-track-one.mp3",
          coverPath: null,
          artist: "Artist",
          duration: null,
          fileSize: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 12,
          title: "Track One",
          filePath: "/downloads/Artist/Album/track-one.mp3",
          coverPath: null,
          artist: "Artist",
          duration: null,
          fileSize: null,
        },
      ])

    const result = await runMaintenanceAction(1, "dedupe_library_imports", true)

    expect(result.details.duplicateCandidates).toBe(0)
    expect(result.details.deletedSongs).toBe(0)
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled()
  })
})

describe("adminMaintenance fetch_missing_lyrics", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.lookupLyrics.mockResolvedValue(null)
  })

  it("dry-run evaluates candidates and reports counts", async () => {
    mocks.prisma.song.findMany.mockResolvedValue([
      { id: 1, title: "Song A", artist: "Artist A", album: "Album A", duration: 120 },
      { id: 2, title: "Song B", artist: null, album: null, duration: null },
    ])
    mocks.lookupLyrics.mockImplementation(async (input: { title: string }) => {
      if (input.title === "Song A") return "lyrics a"
      return null
    })

    const result = await runMaintenanceAction(1, "fetch_missing_lyrics", true)

    expect(result.action).toBe("fetch_missing_lyrics")
    expect(result.details.checkedSongs).toBe(2)
    expect(result.details.updatedSongs).toBe(1)
    expect(result.details.noMatch).toBe(1)
    expect(result.details.failedSongs).toBe(0)
    expect(result.details.skippedSongs).toBe(0)
    expect(mocks.prisma.song.update).not.toHaveBeenCalled()
    expect(mocks.lookupLyrics).toHaveBeenCalledTimes(2)
  })

  it("persists lyrics when not dry-run and tracks failures", async () => {
    mocks.prisma.song.findMany.mockResolvedValue([
      { id: 1, title: "Song A", artist: "Artist A", album: "Album A", duration: 180 },
      { id: 2, title: "Song B", artist: "Artist B", album: null, duration: 200 },
      { id: 3, title: "Song C", artist: null, album: null, duration: null },
    ])
    mocks.lookupLyrics.mockImplementation(async (input: { title: string }) => {
      if (input.title === "Song A") return "lyrics a"
      if (input.title === "Song B") throw new Error("provider down")
      return null
    })

    const result = await runMaintenanceAction(1, "fetch_missing_lyrics", false)

    expect(result.details.checkedSongs).toBe(3)
    expect(result.details.updatedSongs).toBe(1)
    expect(result.details.noMatch).toBe(1)
    expect(result.details.failedSongs).toBe(1)
    expect(result.details.skippedSongs).toBe(0)
    expect(mocks.prisma.song.update).toHaveBeenCalledTimes(1)
    expect(mocks.prisma.song.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { lyrics: "lyrics a" },
    })
  })

  it("honors configured lyrics lookup concurrency", async () => {
    const previousConcurrency = process.env.LYRICS_LOOKUP_CONCURRENCY
    process.env.LYRICS_LOOKUP_CONCURRENCY = "5"
    vi.resetModules()

    const runWithEnv = (await import("../lib/adminMaintenance")).runMaintenanceAction
    mocks.prisma.song.findMany.mockResolvedValue([
      { id: 1, title: "Song A", artist: "Artist A", album: null, duration: null },
    ])
    mocks.lookupLyrics.mockResolvedValue(null)

    const result = await runWithEnv(1, "fetch_missing_lyrics", true)
    expect(result.details.concurrency).toBe(5)

    if (previousConcurrency === undefined) delete process.env.LYRICS_LOOKUP_CONCURRENCY
    else process.env.LYRICS_LOOKUP_CONCURRENCY = previousConcurrency
  })
})
