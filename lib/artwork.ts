import fs from "fs/promises"
import path from "path"
import { safeFetchBuffer } from "./safeFetch"

const COVERS_DIR = path.join(process.cwd(), "downloads", "covers")
const DOWNLOADS_ROOT = path.resolve(process.cwd(), "downloads")
const LEGACY_DOWNLOADS_ROOTS = ["/app/downloads"]
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

function stripPrefix(input: string, prefix: string): string | null {
  if (input === prefix) return ""
  if (input.startsWith(`${prefix}/`) || input.startsWith(`${prefix}${path.sep}`)) {
    return input.slice(prefix.length + 1)
  }
  return null
}

function resolveFsPathFromDbPath(filePath: string): { fsPath: string; dbRoot: string } | null {
  const absolute = path.resolve(filePath)
  const localRel = stripPrefix(absolute, DOWNLOADS_ROOT)
  if (localRel !== null) {
    return { fsPath: path.join(DOWNLOADS_ROOT, localRel), dbRoot: DOWNLOADS_ROOT }
  }

  for (const legacyRoot of LEGACY_DOWNLOADS_ROOTS) {
    const rel = stripPrefix(absolute, legacyRoot)
    if (rel !== null) {
      return { fsPath: path.join(DOWNLOADS_ROOT, rel), dbRoot: legacyRoot }
    }
  }

  return null
}

function toDbPath(fsPath: string, dbRoot: string): string {
  const rel = path.relative(DOWNLOADS_ROOT, fsPath)
  return path.join(dbRoot, rel)
}

function resolveArtworkTarget(
  songId: number,
  ext: string,
  songFilePath?: string | null
): { fsPath: string; dbPath: string } {
  if (songFilePath) {
    const resolvedSongPath = resolveFsPathFromDbPath(songFilePath)
    if (resolvedSongPath) {
      const parsed = path.parse(resolvedSongPath.fsPath)
      const sidecarFsPath = path.join(parsed.dir, `${parsed.name}.cover.${ext}`)
      return {
        fsPath: sidecarFsPath,
        dbPath: toDbPath(sidecarFsPath, resolvedSongPath.dbRoot),
      }
    }
  }

  const fsPath = path.join(COVERS_DIR, `${songId}.${ext}`)
  return { fsPath, dbPath: fsPath }
}

export async function downloadSongArtwork(
  songId: number,
  thumbnailUrl: string | null,
  songFilePath?: string | null
): Promise<string | null> {
  if (!thumbnailUrl) {
    return null
  }

  try {
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

    const target = resolveArtworkTarget(songId, ext, songFilePath)
    await fs.mkdir(path.dirname(target.fsPath), { recursive: true })
    await fs.writeFile(target.fsPath, buffer)
    return target.dbPath
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
