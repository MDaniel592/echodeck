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
  replayGainTrackDb?: number | null
  replayGainAlbumDb?: number | null
  replayGainTrackPeak?: number | null
  replayGainAlbumPeak?: number | null
  libraryId?: number | null
  lyrics?: string | null
  playlistId: number | null
  createdAt: string
}

export interface Playlist {
  id: number
  name: string
  createdAt: string
  _count: { songs: number }
}

export interface SongTag {
  id: number
  name: string
  color?: string | null
  _count?: { songs: number }
}

export type RepeatMode = "off" | "all" | "one"
export type ScopeMode = "all" | "playlists" | "libraries"
export type ViewMode = "list" | "grid"
export type HomeTab = "player" | "download" | "manage" | "organize" | "maintenance"

export interface LibrarySummary {
  id: number
  name: string
}
