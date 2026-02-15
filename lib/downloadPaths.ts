import fs from "fs"
import path from "path"

function isPathWithinRoot(candidatePath: string, rootPath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath)
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  )
}

function getDownloadsRoots(): { resolved: string; real: string } {
  const resolved = path.resolve(process.cwd(), "downloads")
  try {
    return { resolved, real: fs.realpathSync.native(resolved) }
  } catch {
    return { resolved, real: resolved }
  }
}

export function resolveSafeDownloadPathForRead(inputPath: string): string | null {
  const { resolved: downloadsRoot, real: downloadsRealRoot } = getDownloadsRoots()
  const resolvedPath = path.resolve(inputPath)

  if (!isPathWithinRoot(resolvedPath, downloadsRoot)) {
    return null
  }

  if (!fs.existsSync(resolvedPath)) {
    return resolvedPath
  }

  const realPath = fs.realpathSync.native(resolvedPath)
  if (!isPathWithinRoot(realPath, downloadsRealRoot)) {
    return null
  }

  return realPath
}

export function resolveSafeDownloadPathForDelete(inputPath: string): string | null {
  const { resolved: downloadsRoot, real: downloadsRealRoot } = getDownloadsRoots()
  const resolvedPath = path.resolve(inputPath)

  if (!isPathWithinRoot(resolvedPath, downloadsRoot)) {
    return null
  }

  if (!fs.existsSync(resolvedPath)) {
    return resolvedPath
  }

  const realPath = fs.realpathSync.native(resolvedPath)
  if (!isPathWithinRoot(realPath, downloadsRealRoot)) {
    return null
  }

  return resolvedPath
}
