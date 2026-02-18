import { MusicIcon, SoundCloudIcon, SpotifyIcon, YouTubeIcon } from "./icons"
import { statusClassName, statusLabel } from "./types"

interface SourceIconProps {
  source: string
  showFallback?: boolean
}

export function SourceIcon({ source, showFallback = false }: SourceIconProps) {
  if (source === "spotify") return <SpotifyIcon />
  if (source === "youtube") return <YouTubeIcon />
  if (source === "soundcloud") return <SoundCloudIcon />
  return showFallback ? <MusicIcon /> : null
}

interface TaskStatusBadgeProps {
  status: string
  className?: string
}

export function TaskStatusBadge({ status, className = "" }: TaskStatusBadgeProps) {
  return (
    <span className={`${statusClassName(status)} ${className}`.trim()}>
      {statusLabel(status)}
    </span>
  )
}

interface TaskPagerProps {
  page: number
  totalPages: number
  onPageChange: (nextPage: number) => void
  sizeClassName?: string
}

export function TaskPager({ page, totalPages, onPageChange, sizeClassName = "text-[10px]" }: TaskPagerProps) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        className={`rounded border border-zinc-700 px-1.5 py-0.5 text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 ${sizeClassName}`}
      >
        Prev
      </button>
      <span className={`${sizeClassName} text-zinc-500`}>
        {page}/{totalPages}
      </span>
      <button
        type="button"
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        className={`rounded border border-zinc-700 px-1.5 py-0.5 text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 ${sizeClassName}`}
      >
        Next
      </button>
    </div>
  )
}
