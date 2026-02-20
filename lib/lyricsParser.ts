export type LyricsLine = { timestamp: number; text: string } // timestamp in seconds

export function parseLrc(raw: string): LyricsLine[] | null {
  const lines = raw.split("\n")
  const result: LyricsLine[] = []
  // Matches [MM:SS.xx] or [MM:SS.xxx]
  const re = /^\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/

  for (const line of lines) {
    const m = line.trim().match(re)
    if (!m) continue
    const minutes = parseInt(m[1], 10)
    const seconds = parseInt(m[2], 10)
    const fracStr = m[3]
    const frac = fracStr.length === 3
      ? parseInt(fracStr, 10) / 1000
      : parseInt(fracStr, 10) / 100
    const timestamp = minutes * 60 + seconds + frac
    const text = m[4].trim()
    result.push({ timestamp, text })
  }

  if (result.length === 0) return null
  result.sort((a, b) => a.timestamp - b.timestamp)
  return result
}

export function isLrcFormat(text: string): boolean {
  return /^\[\d{2}:\d{2}\.\d{2}/.test(text.trimStart())
}
