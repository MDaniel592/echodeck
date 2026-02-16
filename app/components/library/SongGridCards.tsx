"use client"

interface GridSong {
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
  libraryId?: number | null
  playlistId: number | null
  createdAt: string
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "--:--"
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

interface SongGridCardsProps {
  songs: GridSong[]
  currentSongId: number | null
  onPlay: (song: GridSong) => void
  onPlayNext: (song: GridSong) => void
  onAddToQueue: (song: GridSong) => void
}

export default function SongGridCards({
  songs,
  currentSongId,
  onPlay,
  onPlayNext,
  onAddToQueue,
}: SongGridCardsProps) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
      {songs.map((song) => {
        const coverSrc = song.coverPath ? `/api/cover/${song.id}` : song.thumbnail
        const isPlaying = currentSongId === song.id
        return (
          <article
            key={song.id}
            className={`rounded-lg border p-2 transition-colors ${
              isPlaying
                ? "border-sky-300/40 bg-sky-400/10"
                : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
            }`}
          >
            <button
              type="button"
              onClick={() => onPlay(song)}
              className="w-full text-left"
            >
              <div className="aspect-square overflow-hidden rounded-lg bg-zinc-900">
                {coverSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={coverSrc} alt={`${song.title} cover`} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-zinc-600">♪</div>
                )}
              </div>
              <p className={`mt-1.5 truncate text-xs font-medium ${isPlaying ? "text-sky-200" : "text-zinc-100"}`}>{song.title}</p>
              <p className="truncate text-[11px] text-zinc-400">{song.artist || "Unknown Artist"}</p>
              <p className="mt-0.5 text-[10px] text-zinc-500">{formatDuration(song.duration)}</p>
            </button>
            <div className="mt-1.5 flex items-center gap-1">
              <button
                type="button"
                onClick={() => onPlayNext(song)}
                className="h-6 flex-1 rounded border border-white/10 text-[10px] text-zinc-200 hover:bg-white/10"
              >
                Next
              </button>
              <button
                type="button"
                onClick={() => onAddToQueue(song)}
                className="h-6 flex-1 rounded border border-white/10 text-[10px] text-zinc-200 hover:bg-white/10"
              >
                Queue
              </button>
            </div>
          </article>
        )
      })}
    </div>
  )
}
