import path from "path"
import fs from "fs"
import { promisify } from "util"
import { execFile as execFileCallback } from "child_process"
import { getFfmpegDir } from "./binaries"

const execFile = promisify(execFileCallback)

export type ReplayGainResult = {
  trackGainDb: number
  trackPeak: number
}

export async function analyzeReplayGain(filePath: string): Promise<ReplayGainResult | null> {
  try {
    const ffmpegPath = path.join(getFfmpegDir(), "ffmpeg")
    // replaygain filter writes results to stderr
    const { stderr } = await execFile(
      ffmpegPath,
      ["-nostdin", "-i", filePath, "-af", "replaygain", "-f", "null", "-"],
      { maxBuffer: 2 * 1024 * 1024 }
    )

    const gainMatch = stderr.match(/track_gain\s*=\s*([-\d.]+)\s*dB/i)
    const peakMatch = stderr.match(/track_peak\s*=\s*([\d.]+)/i)

    if (!gainMatch?.[1] || !peakMatch?.[1]) return null

    const trackGainDb = Number.parseFloat(gainMatch[1])
    const trackPeak = Number.parseFloat(peakMatch[1])

    if (!Number.isFinite(trackGainDb) || !Number.isFinite(trackPeak) || trackPeak <= 0) return null

    return {
      trackGainDb: Math.round(trackGainDb * 100) / 100,
      trackPeak: Math.round(trackPeak * 1_000_000) / 1_000_000,
    }
  } catch {
    return null
  }
}

export async function writeReplayGainTags(
  filePath: string,
  trackGainDb: number,
  trackPeak: number
): Promise<void> {
  const ffmpegPath = path.join(getFfmpegDir(), "ffmpeg")
  const ext = path.extname(filePath)
  const tmpPath = `${filePath}.rgtmp${ext}`

  try {
    await execFile(
      ffmpegPath,
      [
        "-nostdin",
        "-i",
        filePath,
        "-map_metadata",
        "0",
        "-metadata",
        `replaygain_track_gain=${trackGainDb.toFixed(2)} dB`,
        "-metadata",
        `replaygain_track_peak=${trackPeak.toFixed(6)}`,
        "-codec:a",
        "copy",
        "-y",
        tmpPath,
      ],
      { maxBuffer: 2 * 1024 * 1024 }
    )
    fs.renameSync(tmpPath, filePath)
  } catch (err) {
    // Clean up temp file if it exists
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
    } catch {
      // ignore cleanup errors
    }
    throw err
  }
}

export async function analyzeAndTagReplayGain(filePath: string): Promise<ReplayGainResult | null> {
  const result = await analyzeReplayGain(filePath)
  if (!result) return null

  try {
    await writeReplayGainTags(filePath, result.trackGainDb, result.trackPeak)
  } catch {
    // Tag writing failure is non-fatal — return values anyway
  }

  return result
}
