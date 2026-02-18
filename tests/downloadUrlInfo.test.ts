import { describe, expect, it } from "vitest"
import { getDownloadUrlInfo } from "../app/components/download/url"

describe("download url detection", () => {
  it("detects tidal and amazon music urls", () => {
    const tidal = getDownloadUrlInfo("https://listen.tidal.com/track/123")
    const amazon = getDownloadUrlInfo("https://music.amazon.com/tracks/123")

    expect(tidal.isTidal).toBe(true)
    expect(tidal.detectedPlatform).toBe("Tidal")
    expect(amazon.isAmazonMusic).toBe(true)
    expect(amazon.detectedPlatform).toBe("Amazon Music")
  })
})
