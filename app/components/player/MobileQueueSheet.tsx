"use client"

import type { TouchEvent } from "react"

interface QueueSong {
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

interface MobileQueueSheetProps {
  isVisible: boolean
  songs: QueueSong[]
  currentSongId: number | null
  queuePosition: string
  queueDragOffset: number
  isQueueDragging: boolean
  transitionEase: string
  onClose: () => void
  onTouchStart: (e: TouchEvent<HTMLDivElement>) => void
  onTouchMove: (e: TouchEvent<HTMLDivElement>) => void
  onTouchEnd: () => void
  onSelectSong: (song: QueueSong) => void
  onMoveItem: (fromIndex: number, toIndex: number) => void
  onRemoveItem: (songId: number, index: number) => void
  onClear: () => void
}

export default function MobileQueueSheet({
  isVisible,
  songs,
  currentSongId,
  queuePosition,
  queueDragOffset,
  isQueueDragging,
  transitionEase,
  onClose,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onSelectSong,
  onMoveItem,
  onRemoveItem,
  onClear,
}: MobileQueueSheetProps) {
  if (!isVisible) return null

  return (
    <>
      <div
        className="fixed inset-0 z-[70] bg-black/45 transition-opacity duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      <section
        className="fixed inset-x-0 bottom-0 z-[75] mx-2 sm:mx-4 max-h-[58vh] sm:max-h-[66vh] rounded-t-2xl border border-zinc-800 bg-zinc-950 shadow-[0_-18px_48px_rgba(0,0,0,0.6)] overflow-hidden animate-[queue-sheet-in_260ms_cubic-bezier(0.22,1,0.36,1)]"
        aria-label="Queue"
      >
        <div
          style={{
            transform: `translate3d(0, ${queueDragOffset}px, 0)`,
            transition: isQueueDragging
              ? "none"
              : `transform 220ms ${transitionEase}`,
          }}
        >
          <div
            className="px-4 pt-3 pb-2 border-b border-zinc-800"
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onTouchCancel={onTouchEnd}
          >
            <div className="flex justify-center pb-2">
              <div className="h-1 w-8 rounded-full bg-zinc-700" />
            </div>
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-zinc-100">Queue</h3>
                  <span className="text-xs font-medium tabular-nums text-zinc-400">{queuePosition}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={onClear}
                disabled={songs.length === 0}
                className="h-7 rounded-md border border-zinc-700 px-2.5 text-xs text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Clear
              </button>
            </div>
          </div>

          {songs.length === 0 ? (
            <div className="px-4 py-5 text-sm text-zinc-500">
              Queue is empty.
            </div>
          ) : (
            <div className="max-h-[calc(58vh-4.6rem)] sm:max-h-[calc(66vh-4.6rem)] overflow-y-auto px-2 py-2">
              {songs.map((queueSong, index) => {
                const isCurrent = queueSong.id === currentSongId
                return (
                  <div
                    key={`${queueSong.id}-${index}`}
                    className={`mb-1 rounded-lg border px-2 py-2 ${
                      isCurrent
                        ? "bg-blue-600/20 border-blue-500/40"
                        : "bg-zinc-900 border-zinc-800"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectSong(queueSong)}
                      className="w-full text-left"
                    >
                      <p className={`text-sm truncate ${isCurrent ? "text-blue-300" : "text-white"}`}>
                        {index + 1}. {queueSong.title}
                      </p>
                      <p className="text-xs text-zinc-500 truncate">
                        {queueSong.artist || "Unknown Artist"}
                      </p>
                    </button>
                    <div className="mt-2 flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => onMoveItem(index, index - 1)}
                        disabled={index === 0}
                        className="h-6 rounded border border-zinc-700 px-2 text-[11px] text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white disabled:opacity-40"
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        onClick={() => onMoveItem(index, index + 1)}
                        disabled={index >= songs.length - 1}
                        className="h-6 rounded border border-zinc-700 px-2 text-[11px] text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white disabled:opacity-40"
                      >
                        Down
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveItem(queueSong.id, index)}
                        className="h-6 rounded border border-red-500/35 px-2 text-[11px] text-red-300 transition-colors hover:bg-red-500/20"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>
    </>
  )
}
