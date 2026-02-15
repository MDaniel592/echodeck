import prisma from "./prisma"

export async function getPlaylistSongsForUser(userId: number, playlistId: number) {
  const entries = await prisma.playlistSong.findMany({
    where: {
      playlistId,
      playlist: { userId },
    },
    orderBy: { position: "asc" },
    include: { song: true },
  })

  return entries
    .map((entry) => entry.song)
    .filter((song) => song.userId === userId)
}

export async function replacePlaylistEntriesForUser(userId: number, playlistId: number, songIds: number[]) {
  const uniqueSongIds = Array.from(new Set(songIds))
  if (uniqueSongIds.length > 0) {
    const found = await prisma.song.findMany({
      where: { userId, id: { in: uniqueSongIds } },
      select: { id: true },
    })
    if (found.length !== uniqueSongIds.length) {
      throw new Error("One or more songs were not found for this user")
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.playlistSong.deleteMany({
      where: { playlistId },
    })

    if (songIds.length > 0) {
      await tx.playlistSong.deleteMany({
        where: {
          songId: { in: uniqueSongIds },
        },
      })

      await tx.playlistSong.createMany({
        data: songIds.map((songId, index) => ({
          playlistId,
          songId,
          position: index,
        })),
      })
    }

    if (uniqueSongIds.length === 0) {
      await tx.song.updateMany({
        where: { userId, playlistId },
        data: { playlistId: null },
      })
    } else {
      await tx.song.updateMany({
        where: { userId, playlistId, id: { notIn: uniqueSongIds } },
        data: { playlistId: null },
      })
      await tx.song.updateMany({
        where: { userId, id: { in: uniqueSongIds } },
        data: { playlistId },
      })
    }
  })
}

export async function assignSongToPlaylistForUser(userId: number, songId: number, playlistId: number | null) {
  await prisma.$transaction(async (tx) => {
    const updated = await tx.song.updateMany({
      where: { id: songId, userId },
      data: { playlistId },
    })
    if (updated.count === 0) {
      throw new Error("Song not found")
    }

    await tx.playlistSong.deleteMany({
      where: { songId },
    })

    if (playlistId === null) return

    const playlist = await tx.playlist.findFirst({
      where: { id: playlistId, userId },
      select: { id: true },
    })
    if (!playlist) {
      throw new Error("Playlist not found")
    }

    const positionAggregate = await tx.playlistSong.aggregate({
      where: { playlistId },
      _max: { position: true },
    })
    const nextPosition = (positionAggregate._max.position ?? -1) + 1

    await tx.playlistSong.create({
      data: {
        playlistId,
        songId,
        position: nextPosition,
      },
    })
  })
}

export async function backfillPlaylistEntriesFromSongAssignments() {
  const playlists = await prisma.playlist.findMany({
    select: { id: true, userId: true },
    orderBy: { id: "asc" },
  })

  let created = 0

  for (const playlist of playlists) {
    const [existingEntries, assignedSongs] = await Promise.all([
      prisma.playlistSong.findMany({
        where: { playlistId: playlist.id },
        select: { songId: true, position: true },
        orderBy: { position: "asc" },
      }),
      prisma.song.findMany({
        where: { userId: playlist.userId, playlistId: playlist.id },
        select: { id: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }),
    ])

    const existingSongIds = new Set(existingEntries.map((entry) => entry.songId))
    let nextPosition = existingEntries.reduce((max, entry) => Math.max(max, entry.position), -1) + 1

    const missing = assignedSongs
      .filter((song) => !existingSongIds.has(song.id))
      .map((song) => ({
        playlistId: playlist.id,
        songId: song.id,
        position: nextPosition++,
      }))

    if (missing.length > 0) {
      await prisma.playlistSong.createMany({
        data: missing,
      })
      created += missing.length
    }
  }

  return { created }
}
