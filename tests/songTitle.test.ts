import { describe, expect, it } from "vitest"
import {
  toAscii,
  stripYouTubeNoise,
  extractTitleFromArtistDash,
  cleanYouTubeTitle,
  stripAllTags,
} from "../lib/songTitle"

describe("toAscii", () => {
  it("converts Ø to O", () => {
    expect(toAscii("Øneheart")).toBe("Oneheart")
    expect(toAscii("VØJ")).toBe("VOJ")
  })

  it("strips accented characters", () => {
    expect(toAscii("théos")).toBe("theos")
    expect(toAscii("café")).toBe("cafe")
  })

  it("drops non-ASCII characters like CJK", () => {
    expect(toAscii("Ashura 痛み")).toBe("Ashura")
  })

  it("preserves plain ASCII", () => {
    expect(toAscii("Narvent")).toBe("Narvent")
    expect(toAscii("skeler.")).toBe("skeler.")
  })

  it("handles æ and ß ligatures", () => {
    expect(toAscii("Ænema")).toBe("AEnema")
    expect(toAscii("Straße")).toBe("Strasse")
  })
})

describe("stripYouTubeNoise", () => {
  it("strips (Official Video) and similar", () => {
    expect(stripYouTubeNoise("Song (Official Video)")).toBe("Song")
    expect(stripYouTubeNoise("Song (Official Audio)")).toBe("Song")
    expect(stripYouTubeNoise("Song (Official Music Video)")).toBe("Song")
    expect(stripYouTubeNoise("Song (Official Lyric Video)")).toBe("Song")
  })

  it("strips (4K ...) and resolution tags", () => {
    expect(stripYouTubeNoise("Song (4K Music Video)")).toBe("Song")
    expect(stripYouTubeNoise("Song [HD]")).toBe("Song")
    expect(stripYouTubeNoise("Song (4K Official Music Video)")).toBe("Song")
  })

  it("strips 'visual by ...' suffixes", () => {
    expect(stripYouTubeNoise("EXCUSED visual by clmfctry")).toBe("EXCUSED")
  })

  it("keeps musical variant tags", () => {
    expect(stripYouTubeNoise("Goth (Slowed + Reverb)")).toBe("Goth (Slowed + Reverb)")
    expect(stripYouTubeNoise("Song (Remix)")).toBe("Song (Remix)")
    expect(stripYouTubeNoise("Song (Acoustic)")).toBe("Song (Acoustic)")
    expect(stripYouTubeNoise("Song (Live)")).toBe("Song (Live)")
    expect(stripYouTubeNoise("SNOWFALL VIP")).toBe("SNOWFALL VIP")
  })

  it("strips noise but keeps non-noise in the same title", () => {
    expect(stripYouTubeNoise("On My Own (Skeler Remix) (Official)")).toBe("On My Own (Skeler Remix)")
    expect(stripYouTubeNoise("SNOWFALL VIP (OFFICIAL VIDEO)")).toBe("SNOWFALL VIP")
  })

  it("keeps non-noise parentheticals", () => {
    expect(stripYouTubeNoise("Fainted (You're Wonderful)")).toBe("Fainted (You're Wonderful)")
    expect(stripYouTubeNoise("SOMETHING FOR YOU (Wave)")).toBe("SOMETHING FOR YOU (Wave)")
  })
})

describe("extractTitleFromArtistDash", () => {
  it("extracts title when artist matches before the dash", () => {
    expect(extractTitleFromArtistDash("LOWX - DANCE ON THE MOON", "Lowx")).toBe("DANCE ON THE MOON")
    expect(extractTitleFromArtistDash("CYREX - SNOWFALL VIP", "CYREX")).toBe("SNOWFALL VIP")
  })

  it("extracts title when multi-artist matches", () => {
    expect(extractTitleFromArtistDash("SAY3AM, GERXMVP - Amnesia", "SAY3AM")).toBe("Amnesia")
    expect(extractTitleFromArtistDash("Navjaxx, VXLLAIN - Distant Memories", "Navjaxx")).toBe("Distant Memories")
  })

  it("returns null when artist does not match", () => {
    expect(extractTitleFromArtistDash("Sultan + Shepard - Assassin", "This Never Happened")).toBeNull()
  })

  it("returns null when there is no dash separator", () => {
    expect(extractTitleFromArtistDash("Goth (Slowed + Reverb)", "Sidewalks and Skeletons")).toBeNull()
  })

  it("returns null when artist is empty", () => {
    expect(extractTitleFromArtistDash("LOWX - SONG", "")).toBeNull()
  })
})

describe("cleanYouTubeTitle", () => {
  it("combines extraction + noise stripping", () => {
    expect(cleanYouTubeTitle("SAY3AM, GERXMVP - Amnesia (Official Audio)", "SAY3AM")).toBe("Amnesia")
    expect(cleanYouTubeTitle("Navjaxx - Cyberverse (4K Official Music Video)", "Navjaxx")).toBe("Cyberverse")
  })

  it("keeps musical variant tags while stripping noise", () => {
    expect(cleanYouTubeTitle("CYREX - SNOWFALL VIP (OFFICIAL VIDEO)", "CYREX")).toBe("SNOWFALL VIP")
    expect(cleanYouTubeTitle("Darci - On My Own (Skeler Remix) (Official)", "skeler."))
      .toBe("Darci - On My Own (Skeler Remix)")
  })

  it("does not modify titles without noise or artist-dash", () => {
    expect(cleanYouTubeTitle("Goth (Slowed + Reverb)", "Sidewalks and Skeletons")).toBe("Goth (Slowed + Reverb)")
    expect(cleanYouTubeTitle("Fainted (You're Wonderful)", "Narvent")).toBe("Fainted (You're Wonderful)")
  })
})

describe("stripAllTags", () => {
  it("strips ALL parenthetical/bracket tags for search", () => {
    expect(stripAllTags("Goth (Slowed + Reverb)")).toBe("Goth")
    expect(stripAllTags("Song (Remix) [Deluxe]")).toBe("Song")
    expect(stripAllTags("Fainted (You're Wonderful)")).toBe("Fainted")
  })

  it("strips feat/ft", () => {
    expect(stripAllTags("Song feat. Artist")).toBe("Song")
    expect(stripAllTags("Song ft. Someone")).toBe("Song")
  })
})
