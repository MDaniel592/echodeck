import path from "path"
import fs from "fs"

const FFMPEG_DIR = path.join(process.cwd(), "bin", "ffmpeg-dir")

export function getYtdlpPath(): string {
  return path.join(process.cwd(), "bin", "yt-dlp")
}

export function getSpotdlPath(): string {
  return path.join(process.cwd(), "bin", "spotdl")
}

/**
 * Returns a directory containing both ffmpeg and ffprobe symlinks.
 * yt-dlp's --ffmpeg-location expects a directory with both binaries.
 */
export function getFfmpegDir(): string {
  if (!fs.existsSync(FFMPEG_DIR)) {
    fs.mkdirSync(FFMPEG_DIR, { recursive: true })
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ffmpegBin: string = require("ffmpeg-static")
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ffprobeBin: string = require("ffprobe-static").path

  const ffmpegLink = path.join(FFMPEG_DIR, "ffmpeg")
  const ffprobeLink = path.join(FFMPEG_DIR, "ffprobe")

  if (!fs.existsSync(ffmpegLink)) {
    fs.symlinkSync(ffmpegBin, ffmpegLink)
  }
  if (!fs.existsSync(ffprobeLink)) {
    fs.symlinkSync(ffprobeBin, ffprobeLink)
  }

  return FFMPEG_DIR
}
