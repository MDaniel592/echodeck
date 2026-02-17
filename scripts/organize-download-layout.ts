import "dotenv/config"
import fs from "fs"
import path from "path"
import prisma from "../lib/prisma"

const DOWNLOADS_ROOT = path.resolve(process.cwd(), "downloads")
const LEGACY_DOWNLOADS_ROOTS = ["/app/downloads"]
const DEFAULT_ASCII_FILENAMES = /^1|true|yes|on$/i.test(process.env.DOWNLOAD_ASCII_FILENAMES || "")

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

function sanitizePathSegment(
  value: string | null | undefined,
  fallback: string,
  options?: { ascii?: boolean }
): string {
  const raw = (value || "").trim()
  if (!raw) return fallback
  let normalized = raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
  if (options?.ascii) {
    normalized = normalized.replace(/[^\x20-\x7E]/g, " ")
  }
  normalized = normalized
    .replace(/\s+/g, " ")
    .trim()
  return normalized.length > 0 ? normalized.slice(0, 120) : fallback
}

function parsePositiveInt(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  const parsed = Math.trunc(value)
  return parsed > 0 ? parsed : null
}

function buildTargetRelativePath(input: {
  artist: string | null
  album: string | null
  year: number | null
  discNumber: number | null
  trackNumber: number | null
  title: string
  ext: string
  asciiFilenames: boolean
}): string {
  const artistDir = sanitizePathSegment(input.artist, "Unknown Artist", { ascii: input.asciiFilenames })
  const yearPart = input.year && Number.isFinite(input.year) ? String(input.year) : "0000"
  const albumDir = `${yearPart} - ${sanitizePathSegment(input.album, "Singles", { ascii: input.asciiFilenames })}`
  const discPrefix = input.discNumber ? `${String(input.discNumber).padStart(2, "0")}-` : ""
  const trackPrefix = input.trackNumber ? `${String(input.trackNumber).padStart(2, "0")} - ` : ""
  const titlePart = sanitizePathSegment(input.title, "Unknown title", { ascii: input.asciiFilenames })
  return path.join("music", artistDir, albumDir, `${discPrefix}${trackPrefix}${titlePart}.${input.ext}`)
}

function ensureUniquePath(targetPath: string): string {
  if (!fs.existsSync(targetPath)) return targetPath
  const parsed = path.parse(targetPath)
  for (let i = 2; i <= 999; i += 1) {
    const candidate = path.join(parsed.dir, `${parsed.name} (${i})${parsed.ext}`)
    if (!fs.existsSync(candidate)) return candidate
  }
  return path.join(parsed.dir, `${parsed.name}-${Date.now()}${parsed.ext}`)
}

function buildCoverTargetAbsolutePath(audioAbsolutePath: string, coverAbsolutePath: string): string {
  const coverExt = path.extname(coverAbsolutePath).replace(/^\./, "").toLowerCase() || "jpg"
  const audioParsed = path.parse(audioAbsolutePath)
  return path.join(audioParsed.dir, `${audioParsed.name}.cover.${coverExt}`)
}

function moveFile(sourcePath: string, targetPath: string): string {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  const uniqueTarget = ensureUniquePath(targetPath)
  try {
    fs.renameSync(sourcePath, uniqueTarget)
    return uniqueTarget
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err.code !== "EXDEV") throw error
    fs.copyFileSync(sourcePath, uniqueTarget)
    fs.unlinkSync(sourcePath)
    return uniqueTarget
  }
}

async function main() {
  const apply = process.argv.includes("--apply")
  const asciiFilenames = process.argv.includes("--ascii") || DEFAULT_ASCII_FILENAMES
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="))
  const limit = limitArg ? Number.parseInt(limitArg.split("=")[1] || "", 10) : null

  const songs = await prisma.song.findMany({
    where: {
      OR: [
        { filePath: { startsWith: DOWNLOADS_ROOT } },
        ...LEGACY_DOWNLOADS_ROOTS.map((root) => ({ filePath: { startsWith: root } })),
      ],
    },
    select: {
      id: true,
      title: true,
      artist: true,
      album: true,
      year: true,
      discNumber: true,
      trackNumber: true,
      filePath: true,
      relativePath: true,
      coverPath: true,
    },
    orderBy: { id: "asc" },
    take: Number.isInteger(limit) && (limit as number) > 0 ? (limit as number) : undefined,
  })

  let moved = 0
  let updatedOnly = 0
  let coverMoved = 0
  let coverUpdatedOnly = 0
  let coverMissing = 0
  let skipped = 0
  let missing = 0
  let failed = 0

  console.log(
    `${apply ? "Apply" : "Dry-run"} mode. Songs to evaluate: ${songs.length}. asciiFilenames=${asciiFilenames}`
  )

  for (const song of songs) {
    const resolved = resolveFsPathFromDbPath(song.filePath)
    if (!resolved) {
      skipped += 1
      continue
    }
    const absolute = resolved.fsPath
    if (!fs.existsSync(absolute)) {
      missing += 1
      console.log(`Missing [${song.id}] ${song.filePath}`)
      continue
    }

    const ext = path.extname(absolute).replace(/^\./, "").toLowerCase() || "mp3"
    const targetRelative = buildTargetRelativePath({
      artist: song.artist,
      album: song.album,
      year: song.year,
      discNumber: parsePositiveInt(song.discNumber),
      trackNumber: parsePositiveInt(song.trackNumber),
      title: song.title,
      ext,
      asciiFilenames,
    })
    const targetAbsolute = path.join(DOWNLOADS_ROOT, targetRelative)

    const currentRelative = song.relativePath || path.relative(DOWNLOADS_ROOT, absolute)
    const currentDbPath = toDbPath(absolute, resolved.dbRoot)
    const targetDbPath = toDbPath(targetAbsolute, resolved.dbRoot)
    const coverResolved = song.coverPath ? resolveFsPathFromDbPath(song.coverPath) : null
    const currentCoverAbsolute = coverResolved?.fsPath || null
    const targetCoverAbsolute = currentCoverAbsolute
      ? buildCoverTargetAbsolutePath(targetAbsolute, currentCoverAbsolute)
      : null
    const targetCoverDbPath = targetCoverAbsolute ? toDbPath(targetCoverAbsolute, resolved.dbRoot) : null

    const audioAlreadyOrganized = path.resolve(absolute) === path.resolve(targetAbsolute)
    const coverAlreadyOrganized =
      !currentCoverAbsolute ||
      !targetCoverAbsolute ||
      path.resolve(currentCoverAbsolute) === path.resolve(targetCoverAbsolute)

    if (audioAlreadyOrganized && coverAlreadyOrganized) {
      if ((song.relativePath !== currentRelative || song.coverPath !== targetCoverDbPath) && apply) {
        await prisma.song.update({
          where: { id: song.id },
          data: {
            relativePath: currentRelative,
            coverPath: targetCoverDbPath,
          },
        })
      }
      updatedOnly += 1
      if (song.coverPath) coverUpdatedOnly += 1
      continue
    }

    if (!apply) {
      if (!audioAlreadyOrganized) {
        moved += 1
        console.log(`Plan [${song.id}] ${currentRelative} -> ${targetRelative}`)
      }
      if (currentCoverAbsolute && targetCoverAbsolute) {
        if (fs.existsSync(currentCoverAbsolute)) {
          if (path.resolve(currentCoverAbsolute) !== path.resolve(targetCoverAbsolute)) {
            coverMoved += 1
            console.log(`Plan cover [${song.id}] ${song.coverPath} -> ${targetCoverDbPath}`)
          } else {
            coverUpdatedOnly += 1
          }
        } else {
          coverMissing += 1
          console.log(`Missing cover [${song.id}] ${song.coverPath}`)
        }
      }
      continue
    }

    try {
      const finalPath = audioAlreadyOrganized ? absolute : moveFile(absolute, targetAbsolute)
      const finalRelative = path.relative(DOWNLOADS_ROOT, finalPath)
      const data: { filePath?: string; relativePath: string; coverPath?: string | null } = {
        relativePath: finalRelative,
      }

      if (!audioAlreadyOrganized) {
        data.filePath = toDbPath(finalPath, resolved.dbRoot)
      }

      // Move sidecar lyrics together when present.
      const oldLrc = absolute.replace(/\.[^.]+$/, ".lrc")
      if (fs.existsSync(oldLrc)) {
        const newLrc = finalPath.replace(/\.[^.]+$/, ".lrc")
        moveFile(oldLrc, newLrc)
      }

      if (currentCoverAbsolute && targetCoverAbsolute && targetCoverDbPath) {
        if (fs.existsSync(currentCoverAbsolute)) {
          if (path.resolve(currentCoverAbsolute) === path.resolve(targetCoverAbsolute)) {
            coverUpdatedOnly += 1
          } else {
            moveFile(currentCoverAbsolute, targetCoverAbsolute)
            coverMoved += 1
          }
          data.coverPath = targetCoverDbPath
        } else {
          coverMissing += 1
        }
      }

      await prisma.song.update({
        where: { id: song.id },
        data,
      })
      if (audioAlreadyOrganized) {
        updatedOnly += 1
      } else {
        moved += 1
        console.log(`Moved [${song.id}] ${currentDbPath} -> ${targetDbPath}`)
      }
    } catch (error) {
      failed += 1
      const msg = error instanceof Error ? error.message : String(error)
      console.log(`Failed [${song.id}] ${song.title} (${msg})`)
    }
  }

  console.log(
    `Done. moved=${moved} updatedOnly=${updatedOnly} coverMoved=${coverMoved} coverUpdatedOnly=${coverUpdatedOnly} coverMissing=${coverMissing} skipped=${skipped} missing=${missing} failed=${failed}`
  )
}

main()
  .catch((error) => {
    console.error("organize-download-layout failed:", error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
