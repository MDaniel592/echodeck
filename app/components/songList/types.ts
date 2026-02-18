export interface Song {
  id: number
  title: string
  artist: string | null
  duration: number | null
  format: string
  quality: string | null
  source: string
  sourceUrl: string | null
  filePath: string
  coverPath: string | null
  thumbnail: string | null
  fileSize: number | null
  playlistId: number | null
  createdAt: string
}

export interface Playlist {
  id: number
  name: string
}

export interface SongListProps {
  songs: Song[]
  playlists: Playlist[]
  currentSongId: number | null
  onPlay: (song: Song) => void
  onAddToQueue: (song: Song) => void
  onPlayNext: (song: Song) => void
  onDelete: (id: number) => void
  onDeleteMany?: (ids: number[]) => Promise<void> | void
  onAssignPlaylist: (songId: number, playlistId: number | null) => Promise<void> | void
  onAssignPlaylistMany?: (songIds: number[], playlistId: number | null) => Promise<void> | void
  onCreatePlaylist: (name: string) => Promise<Playlist>
}
