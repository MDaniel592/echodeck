import path from "path"
import fs from "fs"

const BIN_DIR = path.join(process.cwd(), "bin")

export function getYtdlpPath(): string {
  return path.join(process.cwd(), "bin", "yt-dlp")
}

export function getSpotdlPath(): string {
  return path.join(process.cwd(), "bin", "spotdl")
}

/**
 * Returns the bin directory containing ffmpeg and ffprobe binaries.
 * yt-dlp's --ffmpeg-location expects a directory with both binaries.
 */
export function getFfmpegDir(): string {
  const ffmpegPath = path.join(BIN_DIR, "ffmpeg")
  const ffprobePath = path.join(BIN_DIR, "ffprobe")
  if (!fs.existsSync(ffmpegPath) || !fs.existsSync(ffprobePath)) {
    throw new Error("ffmpeg/ffprobe not found in ./bin. Run: npm run setup")
  }
  return BIN_DIR
}
