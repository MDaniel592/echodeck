import { NextRequest, NextResponse } from "next/server"
import prisma from "../../../../lib/prisma"
import { resolveSafeDownloadPathForRead } from "../../../../lib/downloadPaths"
import { nodeReadableToWebStream } from "../../../../lib/nodeReadableToWebStream"
import fs from "fs"
import fsPromises from "fs/promises"
import path from "path"

const AUDIO_MIME_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  flac: "audio/flac",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/opus",
  aac: "audio/aac",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  webm: "audio/webm",
  weba: "audio/webm",
}

function parseByteRange(
  rangeHeader: string,
  fileSize: number
): { start: number; end: number } | null {
  if (fileSize <= 0) return null

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
  if (!match) return null

  const [, startPart, endPart] = match
  if (!startPart && !endPart) return null

  // Suffix-byte-range-spec: "bytes=-500" means last 500 bytes.
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

function resolveAudioContentType(filePath: string, formatHint: string | null): string {
  const ext = path.extname(filePath).slice(1).toLowerCase()
  const normalizedFormat = (formatHint || "").toLowerCase()
  return (
    AUDIO_MIME_TYPES[ext] ||
    AUDIO_MIME_TYPES[normalizedFormat] ||
    "application/octet-stream"
  )
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const songId = Number.parseInt(id, 10)
    if (!Number.isInteger(songId) || songId <= 0) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400 })
    }

    const song = await prisma.song.findUnique({ where: { id: songId } })
    if (!song) {
      return NextResponse.json({ error: "Song not found" }, { status: 404 })
    }

    const resolvedPath = resolveSafeDownloadPathForRead(song.filePath)
    if (!resolvedPath) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }

    let stat: Awaited<ReturnType<typeof fsPromises.stat>>
    try {
      stat = await fsPromises.stat(resolvedPath)
    } catch {
      return NextResponse.json({ error: "File not found" }, { status: 404 })
    }

    const fileSize = stat.size
    const contentType = resolveAudioContentType(resolvedPath, song.format)

    const range = request.headers.get("range")

    if (range) {
      const parsedRange = parseByteRange(range, fileSize)
      if (!parsedRange) {
        return new Response(null, {
          status: 416,
          headers: {
            "Content-Range": `bytes */${fileSize}`,
            "Accept-Ranges": "bytes",
            "Content-Type": contentType,
          },
        })
      }

      const { start, end } = parsedRange
      const chunkSize = end - start + 1

      const fileStream = fs.createReadStream(resolvedPath, { start, end })
      const webStream = nodeReadableToWebStream(fileStream)

      return new Response(webStream, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunkSize),
          "Content-Type": contentType,
        },
      })
    }

    const fileStream = fs.createReadStream(resolvedPath)
    const webStream = nodeReadableToWebStream(fileStream)

    return new Response(webStream, {
      headers: {
        "Content-Length": String(fileSize),
        "Content-Type": contentType,
        "Accept-Ranges": "bytes",
      },
    })
  } catch (error) {
    console.error("Error streaming:", error)
    return NextResponse.json(
      { error: "Failed to stream audio" },
      { status: 500 }
    )
  }
}
