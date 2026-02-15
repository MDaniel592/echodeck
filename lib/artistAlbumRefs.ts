import prisma from "./prisma"

export type ResolvedArtistAlbumRefs = {
  artistId: number | null
  albumId: number | null
  artist: string | null
  album: string | null
  albumArtist: string | null
}

export async function ensureArtistAlbumRefs(input: {
  userId: number
  artist?: string | null
  album?: string | null
  albumArtist?: string | null
  year?: number | null
}): Promise<ResolvedArtistAlbumRefs> {
  const artistName = (input.artist || "").trim() || null
  const albumName = (input.album || "").trim() || null
  const albumArtistName = (input.albumArtist || artistName || "").trim() || null

  let artistId: number | null = null
  if (artistName) {
    const artist = await prisma.artist.upsert({
      where: { userId_name: { userId: input.userId, name: artistName } },
      update: {},
      create: { userId: input.userId, name: artistName },
      select: { id: true },
    })
    artistId = artist.id
  }

  let albumId: number | null = null
  let resolvedAlbum = albumName
  let resolvedAlbumArtist = albumArtistName

  // For downloaded tracks, keep albums browsable even when source lacks album tags.
  if (!resolvedAlbum && artistName) {
    resolvedAlbum = "Singles"
    if (!resolvedAlbumArtist) {
      resolvedAlbumArtist = artistName
    }
  }

  if (resolvedAlbum) {
    const album = await prisma.album.upsert({
      where: {
        userId_title_albumArtist: {
          userId: input.userId,
          title: resolvedAlbum,
          albumArtist: resolvedAlbumArtist || "",
        },
      },
      update: {
        artistId,
        year: input.year ?? null,
      },
      create: {
        userId: input.userId,
        title: resolvedAlbum,
        albumArtist: resolvedAlbumArtist,
        artistId,
        year: input.year ?? null,
      },
      select: { id: true },
    })
    albumId = album.id
  }

  return {
    artistId,
    albumId,
    artist: artistName,
    album: resolvedAlbum,
    albumArtist: resolvedAlbumArtist,
  }
}
