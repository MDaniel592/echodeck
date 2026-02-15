"use client"

import { useState } from "react"

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

function TrashIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M6 6l1 14h10l1-14" />
    </svg>
  )
}

function XIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  )
}

interface DesktopQueuePanelProps {
  songs: QueueSong[]
  currentSongId: number | null
  queuePosition: string
  onClose: () => void
  onSelectSong: (song: QueueSong) => void
  onRemove: (songId: number, index: number) => void
  onClear: () => void
}

export default function DesktopQueuePanel({
  songs,
  currentSongId,
  queuePosition,
  onClose,
  onSelectSong,
  onRemove,
  onClear,
}: DesktopQueuePanelProps) {
  const [showQueueClearConfirm, setShowQueueClearConfirm] = useState(false)

  return (
    <div className="absolute right-3 bottom-full z-[75] h-[min(34rem,60vh)] w-[min(32rem,94vw)]">
      <section className="relative h-full overflow-hidden rounded-tl-2xl rounded-tr-2xl border border-zinc-700/85 border-b-0 bg-[linear-gradient(180deg,rgba(39,39,42,0.90)_0%,rgba(24,24,27,0.88)_100%)] backdrop-blur-xl shadow-none">
        <div className="flex items-center justify-between border-b border-zinc-700/75 bg-[linear-gradient(180deg,rgba(43,50,66,0.82)_0%,rgba(34,39,52,0.80)_100%)] px-4 py-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-zinc-100">Queue</h3>
              <span className="text-sm font-medium tabular-nums text-zinc-300">{queuePosition}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowQueueClearConfirm(true)}
              disabled={songs.length === 0}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-red-500/35 text-red-300 hover:bg-red-500/15 disabled:opacity-40"
              aria-label="Clear queue"
              title="Clear queue"
            >
              <TrashIcon />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="h-7 rounded-md border border-zinc-700 px-2.5 text-xs text-zinc-300 hover:border-zinc-500 hover:text-white"
            >
              Close
            </button>
          </div>
        </div>
        {songs.length === 0 ? (
          <div className="px-4 py-5 text-sm text-zinc-500">Queue is empty.</div>
        ) : (
          <div className="custom-scrollbar h-[calc(100%-3.25rem)] overflow-y-auto px-2 py-2">
            {songs.map((queueSong, index) => {
              const isCurrent = queueSong.id === currentSongId
              const queueCoverSrc = queueSong.coverPath ? `/api/cover/${queueSong.id}` : queueSong.thumbnail
              return (
                <div
                  key={`${queueSong.id}-${index}`}
                  className={`mb-1 flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors ${
                    isCurrent
                      ? "border-sky-400/45 bg-sky-500/15"
                      : "border-zinc-800 bg-zinc-900 hover:bg-zinc-800"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectSong(queueSong)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="h-9 w-9 shrink-0 overflow-hidden rounded bg-zinc-800">
                        {queueCoverSrc ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={queueCoverSrc}
                            alt={`${queueSong.title} cover`}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[11px] text-zinc-500">♪</div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className={`truncate text-base ${isCurrent ? "text-sky-200" : "text-zinc-100"}`}>
                          {index + 1}. {queueSong.title}
                        </p>
                        <p className="truncate text-sm text-zinc-400">{queueSong.artist || "Unknown Artist"}</p>
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(queueSong.id, index)}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-white"
                    aria-label={`Remove ${queueSong.title} from queue`}
                    title="Remove from queue"
                  >
                    <XIcon />
                  </button>
                </div>
              )
            })}
          </div>
        )}
        {showQueueClearConfirm && (
          <div className="absolute right-3 top-12 z-[77] w-[18rem] rounded-xl border border-zinc-700/80 bg-zinc-950 p-3 shadow-xl">
            <p className="text-sm font-medium text-zinc-100">Clear entire queue?</p>
            <p className="mt-1 text-xs text-zinc-500">
              This removes all queued tracks from the current playback session.
            </p>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowQueueClearConfirm(false)}
                className="h-7 rounded-md border border-zinc-700 px-2.5 text-xs text-zinc-300 hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onClear()
                  setShowQueueClearConfirm(false)
                  onClose()
                }}
                className="h-7 rounded-md border border-red-500/40 bg-red-500/15 px-2.5 text-xs text-red-200 hover:bg-red-500/25"
              >
                Clear
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
