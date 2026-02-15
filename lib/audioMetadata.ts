import path from "path"
import { promisify } from "util"
import { execFile as execFileCallback } from "child_process"
import { getFfmpegDir } from "./binaries"

const execFile = promisify(execFileCallback)

export type ExtractedAudioMetadata = {
  title: string | null
  artist: string | null
  album: string | null
  albumArtist: string | null
  genre: string | null
  year: number | null
  trackNumber: number | null
  discNumber: number | null
  duration: number | null
  bitrate: number | null
  sampleRate: number | null
  channels: number | null
  isrc: string | null
  lyrics: string | null
}

function parseNumericTag(raw: string | undefined): number | null {
  if (!raw) return null
  const token = raw.split("/")[0]?.trim()
  if (!token) return null
  const parsed = Number.parseInt(token, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function parseYear(raw: string | undefined): number | null {
  if (!raw) return null
  const match = raw.match(/\b(19\d{2}|20\d{2}|2100)\b/)
  if (!match?.[1]) return null
  const parsed = Number.parseInt(match[1], 10)
  return Number.isInteger(parsed) ? parsed : null
}

function cleanText(raw: string | null | undefined, max = 500): string | null {
  if (!raw) return null
  const cleaned = raw.trim()
  if (!cleaned) return null
  return cleaned.slice(0, max)
}

export async function extractAudioMetadataFromFile(filePath: string): Promise<ExtractedAudioMetadata> {
  try {
    const ffprobePath = path.join(getFfmpegDir(), "ffprobe")
    const { stdout } = await execFile(
      ffprobePath,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration,bit_rate:format_tags=title,artist,album,album_artist,albumartist,date,genre,track,disc,isrc,lyrics:stream=index,codec_type,sample_rate,channels",
        "-of",
        "json",
        filePath,
      ],
      { maxBuffer: 2 * 1024 * 1024 }
    )

    const parsed = JSON.parse(stdout) as {
      format?: { duration?: string; bit_rate?: string; tags?: Record<string, string> }
      streams?: Array<{
        codec_type?: string
        sample_rate?: string
        channels?: number
        tags?: Record<string, string>
      }>
    }
    const formatTags = parsed.format?.tags || {}
    const audioStream = parsed.streams?.find((stream) => stream.codec_type === "audio")
    const streamTags = audioStream?.tags || {}

    const title = cleanText(formatTags.title || streamTags.title)
    const artist = cleanText(formatTags.artist || streamTags.artist)
    const album = cleanText(formatTags.album || streamTags.album)
    const albumArtist = cleanText(
      formatTags.album_artist ||
        formatTags.albumartist ||
        streamTags.album_artist ||
        streamTags.albumartist
    )
    const genre = cleanText(formatTags.genre || streamTags.genre, 200)
    const year = parseYear(formatTags.date || streamTags.date)
    const trackNumber = parseNumericTag(formatTags.track || streamTags.track)
    const discNumber = parseNumericTag(formatTags.disc || streamTags.disc)
    const durationRaw = Number(parsed.format?.duration)
    const duration =
      Number.isFinite(durationRaw) && durationRaw > 0 ? Math.round(durationRaw) : null
    const bitRateRaw = Number(parsed.format?.bit_rate)
    const bitrate =
      Number.isFinite(bitRateRaw) && bitRateRaw > 0 ? Math.round(bitRateRaw) : null
    const sampleRateRaw = Number(audioStream?.sample_rate)
    const sampleRate =
      Number.isFinite(sampleRateRaw) && sampleRateRaw > 0 ? Math.round(sampleRateRaw) : null
    const channels =
      typeof audioStream?.channels === "number" && audioStream.channels > 0
        ? audioStream.channels
        : null
    const isrc = cleanText(formatTags.isrc || streamTags.isrc, 64)
    const lyrics = cleanText(formatTags.lyrics || streamTags.lyrics, 10_000)

    return {
      title,
      artist,
      album,
      albumArtist,
      genre,
      year,
      trackNumber,
      discNumber,
      duration,
      bitrate,
      sampleRate,
      channels,
      isrc,
      lyrics,
    }
  } catch {
    return {
      title: null,
      artist: null,
      album: null,
      albumArtist: null,
      genre: null,
      year: null,
      trackNumber: null,
      discNumber: null,
      duration: null,
      bitrate: null,
      sampleRate: null,
      channels: null,
      isrc: null,
      lyrics: null,
    }
  }
}
