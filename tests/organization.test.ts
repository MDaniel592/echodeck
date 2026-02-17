import { describe, expect, it } from "vitest"
import { groupDuplicateSongs, parseSmartPlaylistRule, parseSmartPlaylistRuleJson } from "../lib/organization"

describe("organization helpers", () => {
  it("parses smart playlist rules and clamps limit", () => {
    const { rule, errors } = parseSmartPlaylistRule({
      artistContains: "  Daft Punk  ",
      limit: 50000,
      sortBy: "playCount",
      sortOrder: "asc",
    })

    expect(errors).toEqual(["limit must be <= 1000"])
    expect(rule.artistContains).toBe("Daft Punk")
    expect(rule.limit).toBe(1000)
    expect(rule.sortBy).toBe("playCount")
    expect(rule.sortOrder).toBe("asc")
  })

  it("groups likely duplicates by normalized title/artist/duration bucket", () => {
    const now = new Date("2026-02-17T00:00:00.000Z")
    const groups = groupDuplicateSongs(
      [
        {
          id: 1,
          title: "Nightcall",
          artist: "Kavinsky",
          duration: 245,
          filePath: "/a/nightcall.flac",
          source: "library",
          bitrate: 900,
          fileSize: 50_000_000,
          createdAt: now,
        },
        {
          id: 2,
          title: "Nightcall (Official Video)",
          artist: "Kavinsky",
          duration: 244,
          filePath: "/b/nightcall.mp3",
          source: "youtube",
          bitrate: 320,
          fileSize: 8_000_000,
          createdAt: now,
        },
        {
          id: 3,
          title: "Something Else",
          artist: "Another",
          duration: 200,
          filePath: "/c/other.mp3",
          source: "youtube",
          bitrate: 320,
          fileSize: 7_000_000,
          createdAt: now,
        },
      ],
      2
    )

    expect(groups).toHaveLength(1)
    expect(groups[0]?.songs).toHaveLength(2)
    expect(groups[0]?.songs[0]?.id).toBe(1)
  })

  it("parses stored smart playlist rule JSON safely", () => {
    const parsed = parseSmartPlaylistRuleJson("{bad json")
    expect(parsed.invalidJson).toBe(true)
    expect(parsed.errors).toContain("Stored rule JSON is invalid")
    expect(parsed.rule).toEqual({})
  })
})
