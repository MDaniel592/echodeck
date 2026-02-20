export interface PlayerSong {
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
  lyrics?: string | null
  playlistId: number | null
  createdAt: string
}

export type RepeatMode = "off" | "all" | "one"

export interface PlaybackStateSnapshot {
  positionSec: number
  isPlaying: boolean
  repeatMode: RepeatMode
  shuffle: boolean
}

export interface PlayerProps {
  song: PlayerSong | null
  songs: PlayerSong[]
  onSongChange: (song: PlayerSong) => void
  onQueueReorder?: (fromIndex: number, toIndex: number) => void
  onQueueRemove?: (songId: number, index: number) => void
  onQueueClear?: () => void
  onPlaybackStateChange?: (state: PlaybackStateSnapshot) => void
}
