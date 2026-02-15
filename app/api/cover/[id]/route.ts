import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import fsPromises from "fs/promises"
import path from "path"
import prisma from "../../../../lib/prisma"
import { AuthError, requireAuth } from "../../../../lib/requireAuth"
import { resolveSafeDownloadPathForRead } from "../../../../lib/downloadPaths"
import { nodeReadableToWebStream } from "../../../../lib/nodeReadableToWebStream"

const MIME_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request)
    const { id } = await params
    const songId = Number.parseInt(id, 10)
    if (!Number.isInteger(songId) || songId <= 0) {
      return NextResponse.json({ error: "Invalid ID" }, { status: 400 })
    }

    const song = await prisma.song.findFirst({
      where: { id: songId, userId: auth.userId },
      select: { coverPath: true },
    })

    if (!song || !song.coverPath) {
      return NextResponse.json({ error: "Cover not found" }, { status: 404 })
    }

    const resolvedPath = resolveSafeDownloadPathForRead(song.coverPath)
    if (!resolvedPath) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }

    let stat: Awaited<ReturnType<typeof fsPromises.stat>>
    try {
      stat = await fsPromises.stat(resolvedPath)
    } catch {
      return NextResponse.json({ error: "Cover not found" }, { status: 404 })
    }

    const ext = path.extname(resolvedPath).slice(1).toLowerCase()
    const contentType = MIME_TYPES[ext] || "application/octet-stream"

    const fileStream = fs.createReadStream(resolvedPath)
    const webStream = nodeReadableToWebStream(fileStream)

    return new Response(webStream, {
      headers: {
        "Content-Length": String(stat.size),
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      },
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Error streaming cover:", error)
    return NextResponse.json(
      { error: "Failed to load cover" },
      { status: 500 }
    )
  }
}
