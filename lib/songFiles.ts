import prisma from "./prisma"
import { resolveSafeDownloadPathForDelete } from "./downloadPaths"

export type DeletedSongFileRefs = {
  filePath: string
  coverPath: string | null
}

async function collectUnreferencedPaths(pathValues: string[], field: "filePath" | "coverPath"): Promise<string[]> {
  const uniquePaths = Array.from(new Set(pathValues.filter((value) => value.trim().length > 0)))
  if (uniquePaths.length === 0) return []

  const counts = await Promise.all(
    uniquePaths.map(async (value) => ({
      value,
      count: await prisma.song.count({
        where: field === "filePath" ? { filePath: value } : { coverPath: value },
      }),
    }))
  )

  return counts.filter((entry) => entry.count === 0).map((entry) => entry.value)
}

export async function getSafeDeletePathsForRemovedSongs(songs: DeletedSongFileRefs[]): Promise<string[]> {
  const missingFileRefs = await collectUnreferencedPaths(
    songs.map((song) => song.filePath),
    "filePath"
  )
  const missingCoverRefs = await collectUnreferencedPaths(
    songs.map((song) => song.coverPath || ""),
    "coverPath"
  )

  const safeDeletionPaths = new Set<string>()
  for (const filePath of [...missingFileRefs, ...missingCoverRefs]) {
    const safePath = resolveSafeDownloadPathForDelete(filePath)
    if (safePath) safeDeletionPaths.add(safePath)
  }

  return Array.from(safeDeletionPaths)
}
