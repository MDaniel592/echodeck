import fs from "fs/promises"
import path from "path"
import { safeFetchBuffer } from "./safeFetch"

const COVERS_DIR = path.join(process.cwd(), "downloads", "covers")
const MAX_ARTWORK_BYTES = 10 * 1024 * 1024 // 10 MB
const ARTWORK_TIMEOUT_MS = 10_000

function extensionFromContentType(contentType: string | null): string | null {
  if (!contentType) return null
  const normalized = contentType.toLowerCase()
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg"
  if (normalized.includes("png")) return "png"
  if (normalized.includes("webp")) return "webp"
  if (normalized.includes("gif")) return "gif"
  return null
}

function extensionFromUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname
    const ext = path.extname(pathname).replace(/^\./, "").toLowerCase()
    return ext || null
  } catch {
    return null
  }
}

export async function downloadSongArtwork(songId: number, thumbnailUrl: string | null): Promise<string | null> {
  if (!thumbnailUrl) {
    return null
  }

  try {
    await fs.mkdir(COVERS_DIR, { recursive: true })

    const { buffer, contentType } = await safeFetchBuffer(thumbnailUrl, undefined, {
      maxBytes: MAX_ARTWORK_BYTES,
      timeoutMs: ARTWORK_TIMEOUT_MS,
      allowedContentTypes: ["image/"],
    })

    if (!buffer.length) {
      return null
    }

    const ext =
      extensionFromContentType(contentType) ??
      extensionFromUrl(thumbnailUrl) ??
      "jpg"

    const coverPath = path.join(COVERS_DIR, `${songId}.${ext}`)
    await fs.writeFile(coverPath, buffer)
    return coverPath
  } catch {
    return null
  }
}

export async function getSpotifyThumbnail(sourceUrl: string): Promise<string | null> {
  try {
    const endpoint = `https://open.spotify.com/oembed?url=${encodeURIComponent(sourceUrl)}`
    const { buffer } = await safeFetchBuffer(endpoint, undefined, {
      maxBytes: 64 * 1024, // 64 KB for JSON
      timeoutMs: 5_000,
      allowedContentTypes: ["application/json", "text/json"],
    })

    const data = JSON.parse(buffer.toString("utf-8")) as { thumbnail_url?: string }
    if (typeof data.thumbnail_url === "string" && data.thumbnail_url.trim()) {
      return data.thumbnail_url
    }
    return null
  } catch {
    return null
  }
}
