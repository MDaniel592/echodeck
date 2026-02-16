export type GroupScope = "all" | "playlists" | "libraries"

export interface GroupableSong {
  playlistId: number | null
  libraryId?: number | null
}

export interface SongGroup<TSong> {
  key: string
  label: string
  songs: TSong[]
}

export function groupSongsByScope<TSong extends GroupableSong>(
  songs: TSong[],
  scope: GroupScope,
  playlistNameById: Map<number, string>,
  libraryNameById: Map<number, string>,
): SongGroup<TSong>[] {
  if (scope === "all") {
    return [{ key: "all", label: "All Songs", songs }]
  }

  const groups = new Map<string, SongGroup<TSong>>()

  for (const song of songs) {
    if (scope === "playlists") {
      const key = song.playlistId === null ? "playlist-none" : `playlist-${song.playlistId}`
      const label = song.playlistId === null
        ? "Unassigned Playlist"
        : (playlistNameById.get(song.playlistId) ?? `Playlist #${song.playlistId}`)
      if (!groups.has(key)) groups.set(key, { key, label, songs: [] })
      groups.get(key)!.songs.push(song)
      continue
    }

    const key = song.libraryId == null ? "library-none" : `library-${song.libraryId}`
    const label = song.libraryId == null
      ? "Unassigned Library"
      : (libraryNameById.get(song.libraryId) ?? `Library #${song.libraryId}`)
    if (!groups.has(key)) groups.set(key, { key, label, songs: [] })
    groups.get(key)!.songs.push(song)
  }

  return Array.from(groups.values()).sort((a, b) => {
    if (a.label === "Unassigned Playlist" || a.label === "Unassigned Library") return 1
    if (b.label === "Unassigned Playlist" || b.label === "Unassigned Library") return -1
    return a.label.localeCompare(b.label)
  })
}
