import prisma from "./prisma"

export class PlaylistServiceError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = "PlaylistServiceError"
    this.status = status
  }
}

export function parsePlaylistId(input: unknown): number | null {
  if (input === null || input === undefined || input === "") return null
  const parsed = Number.parseInt(String(input), 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new PlaylistServiceError("Invalid playlist ID", 400)
  }
  return parsed
}

export async function listPlaylistsForUser(userId: number) {
  return prisma.playlist.findMany({
    where: { userId },
    orderBy: { name: "asc" },
    include: { _count: { select: { songs: true } } },
  })
}

export async function createPlaylistForUser(userId: number, rawName: unknown) {
  const name = typeof rawName === "string" ? rawName.trim() : ""
  if (!name) {
    throw new PlaylistServiceError("Playlist name is required", 400)
  }
  if (name.length > 80) {
    throw new PlaylistServiceError("Playlist name is too long", 400)
  }

  return prisma.playlist.create({
    data: { userId, name },
    include: { _count: { select: { songs: true } } },
  })
}

export async function getPlaylistForUser(userId: number, playlistId: number) {
  return prisma.playlist.findFirst({
    where: { id: playlistId, userId },
    include: { _count: { select: { songs: true } } },
  })
}

export async function renamePlaylistForUser(userId: number, playlistId: number, rawName: unknown) {
  const name = typeof rawName === "string" ? rawName.trim() : ""
  if (!name) {
    throw new PlaylistServiceError("Playlist name is required", 400)
  }
  if (name.length > 80) {
    throw new PlaylistServiceError("Playlist name is too long", 400)
  }

  const existing = await prisma.playlist.findFirst({
    where: { id: playlistId, userId },
    select: { id: true },
  })
  if (!existing) {
    throw new PlaylistServiceError("Playlist not found", 404)
  }

  return prisma.playlist.update({
    where: { id: playlistId },
    data: { name },
    include: { _count: { select: { songs: true } } },
  })
}

export async function deletePlaylistForUser(userId: number, playlistId: number) {
  const existing = await prisma.playlist.findFirst({
    where: { id: playlistId, userId },
    select: { id: true },
  })
  if (!existing) {
    throw new PlaylistServiceError("Playlist not found", 404)
  }

  await prisma.playlist.delete({ where: { id: playlistId } })
}

export async function assignSongsToPlaylistForUser(userId: number, songIds: number[], playlistId: number | null) {
  const uniqueIds = Array.from(
    new Set(
      songIds
        .map((value) => Number.parseInt(String(value), 10))
        .filter((id): id is number => Number.isInteger(id) && id > 0)
    )
  )

  if (uniqueIds.length === 0) {
    throw new PlaylistServiceError("ids must be a non-empty array of song IDs", 400)
  }

  const songs = await prisma.song.findMany({
    where: { userId, id: { in: uniqueIds } },
    select: { id: true },
  })
  if (songs.length !== uniqueIds.length) {
    throw new PlaylistServiceError("One or more songs were not found", 404)
  }

  await prisma.$transaction(async (tx) => {
    if (playlistId !== null) {
      const playlist = await tx.playlist.findFirst({
        where: { id: playlistId, userId },
        select: { id: true },
      })
      if (!playlist) {
        throw new PlaylistServiceError("Playlist not found", 404)
      }
    }

    await tx.song.updateMany({
      where: { userId, id: { in: uniqueIds } },
      data: { playlistId },
    })

    await tx.playlistSong.deleteMany({
      where: { songId: { in: uniqueIds } },
    })

    if (playlistId === null) return

    const maxPosition = await tx.playlistSong.aggregate({
      where: { playlistId },
      _max: { position: true },
    })
    const start = (maxPosition._max.position ?? -1) + 1

    await tx.playlistSong.createMany({
      data: uniqueIds.map((songId, index) => ({
        playlistId,
        songId,
        position: start + index,
      })),
    })
  })

  return {
    updatedIds: uniqueIds,
    playlistId,
  }
}
