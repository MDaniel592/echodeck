import { describe, it, expect } from "vitest"
import prisma from "../lib/prisma"
import { lookupLyrics } from "../lib/lyricsProvider"

describe("lyrics diagnostic (integration)", () => {
  it("finds lyrics for songs that have known lyrics in the DB", async () => {
    const songsWithLyrics = await prisma.song.findMany({
      where: { lyrics: { not: null }, title: { not: "" } },
      select: { id: true, title: true, artist: true, album: true, duration: true },
      take: 5,
      orderBy: { id: "asc" },
    })

    if (songsWithLyrics.length === 0) {
      console.log("Skipping: no songs with lyrics found in DB")
      return
    }

    for (const song of songsWithLyrics) {
      const result = await lookupLyrics({
        title: song.title,
        artist: song.artist,
        album: song.album,
        duration: song.duration,
        timeoutMs: 10_000,
      })
      expect(result, `Expected lyrics for "${song.title}" by "${song.artist}"`).not.toBeNull()
    }
  }, 60_000)

  it("handles songs without lyrics gracefully (no exceptions)", async () => {
    const songsWithoutLyrics = await prisma.song.findMany({
      where: { lyrics: null, title: { not: "" } },
      select: { id: true, title: true, artist: true, album: true, duration: true },
      take: 5,
      orderBy: { id: "asc" },
    })

    if (songsWithoutLyrics.length === 0) {
      console.log("Skipping: no songs without lyrics found in DB")
      return
    }

    for (const song of songsWithoutLyrics) {
      // Should not throw — result can be null or a string
      await expect(
        lookupLyrics({
          title: song.title,
          artist: song.artist,
          album: song.album,
          duration: song.duration,
          timeoutMs: 10_000,
        })
      ).resolves.not.toThrow()
    }
  }, 60_000)
})
