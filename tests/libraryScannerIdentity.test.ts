import { describe, expect, it } from "vitest"
import { buildLibrarySourceUrl } from "../lib/libraryScanner"

describe("library scanner identity", () => {
  it("includes libraryPath id in source URL identity", () => {
    const sourceUrl = buildLibrarySourceUrl(3, 17, "Disc 1/track01.mp3")
    expect(sourceUrl).toBe("library:3:17:Disc 1/track01.mp3")
  })
})
