import { describe, it, expect } from "vitest"
import { sanitizeSong } from "../lib/sanitize"

describe("sanitizeSong", () => {
  it("removes filePath and coverPath from song objects", () => {
    const song = {
      id: 1,
      title: "Test Song",
      artist: "Test Artist",
      filePath: "/downloads/secret/path.mp3",
      coverPath: "/downloads/covers/1.jpg",
      source: "youtube",
    }

    const result = sanitizeSong(song)

    expect(result).toEqual({
      id: 1,
      title: "Test Song",
      artist: "Test Artist",
      source: "youtube",
    })
    expect("filePath" in result).toBe(false)
    expect("coverPath" in result).toBe(false)
  })

  it("handles songs without coverPath", () => {
    const song = {
      id: 2,
      title: "No Cover",
      filePath: "/downloads/file.mp3",
      coverPath: null,
    }

    const result = sanitizeSong(song)
    expect("filePath" in result).toBe(false)
    expect("coverPath" in result).toBe(false)
  })
})
