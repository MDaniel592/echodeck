import { describe, expect, it } from "vitest"
import { NextRequest } from "next/server"
import {
  mapSubsonicSong,
  mapSubsonicUser,
  parseByteRange,
  parseIntParam,
  parseNumericId,
  resolveMediaMimeType,
  subsonicResponse,
} from "../lib/subsonicAdapter"

describe("subsonicAdapter", () => {
  it("maps songs to subsonic shape", () => {
    const createdAt = new Date("2020-01-02T03:04:05.000Z")
    const mapped = mapSubsonicSong({
      id: 42,
      title: "Track",
      artist: "Artist",
      album: "Album",
      artistId: 9,
      duration: 100,
      trackNumber: 3,
      year: 2024,
      genre: "Rock",
      albumId: 7,
      createdAt,
      playCount: 2,
    })

    expect(mapped.id).toBe("42")
    expect(mapped.isDir).toBe(false)
    expect(mapped.type).toBe("music")
    expect(mapped.albumId).toBe("7")
    expect(mapped.artistId).toBe("9")
    expect(mapped.coverArt).toBe("al-7")
    expect(mapped.track).toBe(3)
    expect(mapped.created).toBe(createdAt.toISOString())
  })

  it("maps users to subsonic permission shape", () => {
    const mapped = mapSubsonicUser({ username: "admin", role: "admin" })
    expect(mapped.username).toBe("admin")
    expect(mapped.adminRole).toBe(true)
    expect(mapped.streamRole).toBe(true)
  })

  it("parses numeric helpers", () => {
    expect(parseIntParam("5", 1)).toBe(5)
    expect(parseIntParam("-1", 1)).toBe(1)
    expect(parseNumericId("7")).toBe(7)
    expect(parseNumericId("0")).toBeNull()
  })

  it("parses byte ranges", () => {
    expect(parseByteRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 })
    expect(parseByteRange("bytes=10-", 100)).toEqual({ start: 10, end: 99 })
    expect(parseByteRange("bytes=-5", 100)).toEqual({ start: 95, end: 99 })
    expect(parseByteRange("bytes=100-120", 100)).toBeNull()
  })

  it("resolves media mime type", () => {
    expect(resolveMediaMimeType("/tmp/song.mp3")).toBe("audio/mpeg")
    expect(resolveMediaMimeType("/tmp/song.flac")).toBe("audio/flac")
    expect(resolveMediaMimeType("/tmp/cover.png")).toBe("image/png")
  })

  it("renders json and xml responses", async () => {
    const reqJson = new NextRequest("http://localhost/api/subsonic/rest?f=json")
    const resJson = subsonicResponse(reqJson, { ping: true })
    const jsonBody = await resJson.json()
    expect(jsonBody["subsonic-response"].openSubsonic).toBe(true)
    expect(jsonBody["subsonic-response"].ping).toBe(true)

    const reqXml = new NextRequest("http://localhost/api/subsonic/rest?f=xml")
    const resXml = subsonicResponse(reqXml, { ping: true })
    const xml = await resXml.text()
    expect(xml).toContain("<subsonic-response")
    expect(xml).toContain("openSubsonic=\"true\"")
    expect(xml).toContain("<ping")
  })
})
