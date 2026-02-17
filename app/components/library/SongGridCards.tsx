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
  cardScale: number
}

export default function SongGridCards({
  songs,
  currentSongId,
  onPlay,
  onPlayNext,
  onAddToQueue,
  cardScale,
}: SongGridCardsProps) {
  const minCardWidth = Math.round(145 + (cardScale - 100) * 1.6)

  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(108, Math.min(320, minCardWidth))}px, 1fr))` }}
    >
      {songs.map((song) => {
        const coverSrc = song.coverPath ? `/api/cover/${song.id}` : song.thumbnail
        const isPlaying = currentSongId === song.id
        return (
          <article
            key={song.id}
            className={`group overflow-hidden rounded-xl border transition-colors ${
              isPlaying
                ? "border-sky-300/50 bg-sky-500/10"
                : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]"
            }`}
            style={{ contentVisibility: "auto", containIntrinsicSize: "auto 180px" }}
          >
            <button type="button" onClick={() => onPlay(song)} className="relative block w-full text-left">
              <div className="aspect-square overflow-hidden bg-zinc-900">
                {coverSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={coverSrc}
                    alt={`${song.title} cover`}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-zinc-600">♪</div>
                )}
              </div>
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/70 to-transparent px-2 py-2">
                <p className={`truncate text-xs font-medium lg:text-base ${isPlaying ? "text-sky-200" : "text-zinc-100"}`}>{song.title}</p>
                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <p className="truncate text-[11px] text-zinc-300/90 lg:text-sm">{song.artist || "Unknown Artist"}</p>
                  <p className="shrink-0 text-[10px] text-zinc-400">{formatDuration(song.duration)}</p>
                </div>
              </div>
            </button>
            <div className="grid grid-cols-2 border-t border-white/10 bg-black/20">
              <button
                type="button"
                onClick={() => onPlayNext(song)}
                className="h-7 text-[10px] text-zinc-200 transition-colors hover:bg-white/10"
              >
                Next
              </button>
              <button
                type="button"
                onClick={() => onAddToQueue(song)}
                className="h-7 border-l border-white/10 text-[10px] text-zinc-200 transition-colors hover:bg-white/10"
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
