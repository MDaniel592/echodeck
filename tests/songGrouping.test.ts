import { describe, expect, it } from "vitest"
import { groupSongsByScope } from "../lib/songGrouping"

type FakeSong = {
  id: number
  title: string
  playlistId: number | null
  libraryId?: number | null
}

const songs: FakeSong[] = [
  { id: 1, title: "A", playlistId: 2, libraryId: 10 },
  { id: 2, title: "B", playlistId: 2, libraryId: 10 },
  { id: 3, title: "C", playlistId: null, libraryId: null },
  { id: 4, title: "D", playlistId: 7, libraryId: 13 },
]

describe("groupSongsByScope", () => {
  it("returns one all-songs group for all scope", () => {
    const groups = groupSongsByScope(songs, "all", new Map(), new Map())
    expect(groups).toHaveLength(1)
    expect(groups[0]?.key).toBe("all")
    expect(groups[0]?.songs).toHaveLength(4)
  })

  it("groups songs by playlist", () => {
    const groups = groupSongsByScope(
      songs,
      "playlists",
      new Map([[2, "Roadtrip"], [7, "Focus"]]),
      new Map(),
    )
    expect(groups.map((group) => group.label)).toEqual(["Focus", "Roadtrip", "Unassigned Playlist"])
    expect(groups.find((group) => group.label === "Roadtrip")?.songs).toHaveLength(2)
  })

  it("groups songs by library", () => {
    const groups = groupSongsByScope(
      songs,
      "libraries",
      new Map(),
      new Map([[10, "Main"], [13, "Archive"]]),
    )
    expect(groups.map((group) => group.label)).toEqual(["Archive", "Main", "Unassigned Library"])
    expect(groups.find((group) => group.label === "Main")?.songs).toHaveLength(2)
  })
})
