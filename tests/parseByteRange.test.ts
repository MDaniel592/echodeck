import { describe, it, expect } from "vitest"

// Extract parseByteRange logic for testing (it's a private function,
// so we replicate it here to test the algorithm)
function parseByteRange(
  rangeHeader: string,
  fileSize: number
): { start: number; end: number } | null {
  if (fileSize <= 0) return null

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
  if (!match) return null

  const [, startPart, endPart] = match
  if (!startPart && !endPart) return null

  if (!startPart) {
    const suffixLength = Number(endPart)
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return null
    const start = Math.max(fileSize - suffixLength, 0)
    return { start, end: fileSize - 1 }
  }

  const start = Number(startPart)
  if (!Number.isInteger(start) || start < 0 || start >= fileSize) return null

  if (!endPart) {
    return { start, end: fileSize - 1 }
  }

  const end = Number(endPart)
  if (!Number.isInteger(end) || end < start) return null

  return { start, end: Math.min(end, fileSize - 1) }
}

describe("parseByteRange", () => {
  it("parses standard range", () => {
    expect(parseByteRange("bytes=0-499", 1000)).toEqual({ start: 0, end: 499 })
  })

  it("parses open-ended range", () => {
    expect(parseByteRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999 })
  })

  it("parses suffix range", () => {
    expect(parseByteRange("bytes=-200", 1000)).toEqual({ start: 800, end: 999 })
  })

  it("clamps end to file size", () => {
    expect(parseByteRange("bytes=0-5000", 1000)).toEqual({ start: 0, end: 999 })
  })

  it("returns null for empty range", () => {
    expect(parseByteRange("bytes=-", 1000)).toBeNull()
  })

  it("returns null for zero file size", () => {
    expect(parseByteRange("bytes=0-100", 0)).toBeNull()
  })

  it("returns null for start >= fileSize", () => {
    expect(parseByteRange("bytes=1000-", 1000)).toBeNull()
  })

  it("returns null for end < start", () => {
    expect(parseByteRange("bytes=500-100", 1000)).toBeNull()
  })

  it("returns null for invalid format", () => {
    expect(parseByteRange("invalid", 1000)).toBeNull()
  })

  it("handles suffix larger than file", () => {
    expect(parseByteRange("bytes=-5000", 1000)).toEqual({ start: 0, end: 999 })
  })
})
