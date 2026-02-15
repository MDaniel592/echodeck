import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const prisma = {
    song: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  }

  return {
    prisma,
    extractAudioMetadataFromFile: vi.fn(),
    getVideoInfo: vi.fn(),
    getSpotifyThumbnail: vi.fn(),
    downloadSongArtwork: vi.fn(),
    ensureArtistAlbumRefs: vi.fn(),
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

vi.mock("../lib/downloadTasks", () => ({
  enqueueDownloadTask: mocks.enqueueDownloadTask,
  drainQueuedTaskWorkers: mocks.drainQueuedTaskWorkers,
  normalizeFormat: mocks.normalizeFormat,
  normalizeQuality: mocks.normalizeQuality,
  startDownloadTaskWorker: mocks.startDownloadTaskWorker,
}))

import { runMaintenanceAction, type MaintenanceProgress } from "../lib/adminMaintenance"

describe("adminMaintenance refresh_origin_metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getVideoInfo.mockResolvedValue({
      title: "New Title",
      artist: "New Artist",
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
})
