import fs from "fs/promises"
import path from "path"

function getDefaultLibraryRoot(): string {
  return path.resolve(process.cwd(), "downloads")
}

function splitConfiguredRoots(value: string): string[] {
  return value
    .split(path.delimiter)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

async function canonicalizePath(input: string): Promise<string> {
  const resolved = path.resolve(input)
  try {
    return await fs.realpath(resolved)
  } catch {
    return resolved
  }
}

function isWithinRoot(candidate: string, root: string): boolean {
  if (candidate === root) return true
  return candidate.startsWith(`${root}${path.sep}`)
}

export async function getAllowedLibraryRoots(): Promise<string[]> {
  const configured = process.env.LIBRARY_ALLOWED_ROOTS ? splitConfiguredRoots(process.env.LIBRARY_ALLOWED_ROOTS) : []
  const roots = [getDefaultLibraryRoot(), ...configured]

  const normalizedRoots = await Promise.all(roots.map((entry) => canonicalizePath(entry)))
  return Array.from(new Set(normalizedRoots))
}

export type ValidatedLibraryPathResult =
  | { ok: true; normalizedPath: string }
  | { ok: false; error: string }

export async function validateLibraryPath(inputPath: string): Promise<ValidatedLibraryPathResult> {
  const trimmed = inputPath.trim()
  if (!trimmed) {
    return { ok: false, error: "Path is required" }
  }

  const resolvedPath = path.resolve(trimmed)

  let pathStats: Awaited<ReturnType<typeof fs.stat>>
  try {
    pathStats = await fs.stat(resolvedPath)
  } catch {
    return { ok: false, error: "Path does not exist" }
  }

  if (!pathStats.isDirectory()) {
    return { ok: false, error: "Path must be a directory" }
  }

  const normalizedPath = await canonicalizePath(resolvedPath)
  const allowedRoots = await getAllowedLibraryRoots()
  const allowed = allowedRoots.some((root) => isWithinRoot(normalizedPath, root))
  if (!allowed) {
    return {
      ok: false,
      error: "Path is outside allowed library roots",
    }
  }

  return { ok: true, normalizedPath }
}
