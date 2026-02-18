import fs from "fs"
import path from "path"

function isPathWithinRoot(candidatePath: string, rootPath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath)
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  )
}

interface DownloadRoot {
  resolved: string
  real: string
}

function toDownloadRoot(rootPath: string): DownloadRoot {
  const resolved = path.resolve(rootPath)
  try {
    return { resolved, real: fs.realpathSync.native(resolved) }
  } catch {
    return { resolved, real: resolved }
  }
}

function getDownloadsRoots(): DownloadRoot[] {
  const configured = (process.env.DOWNLOADS_DIR || "").trim()
  const candidates = [
    configured || null,
    path.resolve(process.cwd(), "downloads"),
    "/app/downloads",
    "/downloads",
  ].filter((value): value is string => Boolean(value))

  const deduped = new Map<string, DownloadRoot>()
  for (const candidate of candidates) {
    const root = toDownloadRoot(candidate)
    deduped.set(root.resolved, root)
  }

  return Array.from(deduped.values())
}

function candidatePathsForInput(inputPath: string, roots: DownloadRoot[]): string[] {
  const resolvedInput = path.resolve(inputPath)
  const candidates = new Set<string>([resolvedInput])

  for (const root of roots) {
    if (!isPathWithinRoot(resolvedInput, root.resolved)) {
      continue
    }
    const relative = path.relative(root.resolved, resolvedInput)
    for (const targetRoot of roots) {
      candidates.add(path.join(targetRoot.resolved, relative))
    }
  }

  // Handle legacy absolute paths persisted from older deployments (e.g. /downloads/...)
  const marker = `${path.sep}downloads${path.sep}`
  const markerIndex = resolvedInput.lastIndexOf(marker)
  if (markerIndex >= 0) {
    const relativeToDownloads = resolvedInput.slice(markerIndex + marker.length)
    if (relativeToDownloads) {
      for (const root of roots) {
        candidates.add(path.join(root.resolved, relativeToDownloads))
      }
    }
  }

  return Array.from(candidates)
}

function resolveSafeDownloadPath(inputPath: string): string | null {
  const roots = getDownloadsRoots()
  let firstSafeMissingPath: string | null = null

  for (const candidate of candidatePathsForInput(inputPath, roots)) {
    for (const root of roots) {
      if (!isPathWithinRoot(candidate, root.resolved)) {
        continue
      }

      if (!fs.existsSync(candidate)) {
        if (!firstSafeMissingPath) {
          firstSafeMissingPath = candidate
        }
        continue
      }

      const realPath = fs.realpathSync.native(candidate)
      if (!isPathWithinRoot(realPath, root.real)) {
        continue
      }

      return realPath
    }
  }

  return firstSafeMissingPath
}

export function resolveSafeDownloadPathForRead(inputPath: string): string | null {
  return resolveSafeDownloadPath(inputPath)
}

export function resolveSafeDownloadPathForDelete(inputPath: string): string | null {
  return resolveSafeDownloadPath(inputPath)
}
