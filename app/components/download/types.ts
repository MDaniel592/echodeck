export interface DownloadTaskEvent {
  id: number
  level: string
  message: string
  payload?: string | null
  createdAt: string
}

export interface DownloadTaskSummary {
  id: number
  source: string
  sourceUrl: string
  status: string
  format: string
  quality: string | null
  bestAudioPreference: string | null
  playlistTitle: string | null
  isPlaylist: boolean
  totalItems: number | null
  processedItems: number
  successfulItems: number
  failedItems: number
  errorMessage: string | null
  playlistId: number | null
  playlist: { id: number; name: string } | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  updatedAt: string
  lastEvent: DownloadTaskEvent | null
  previewImageUrl?: string | null
  previewTitle?: string | null
}

export interface DownloadTaskDetail extends DownloadTaskSummary {
  events: DownloadTaskEvent[]
  songs: Array<{
    id: number
    title: string
    artist: string | null
    createdAt: string
  }>
}

export interface PlaylistOption {
  id: number
  name: string
}

export interface TaskListPayload {
  tasks: DownloadTaskSummary[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export type ProgressPayload = {
  kind?: string
  percent?: number | null
  speed?: string | null
  eta?: string | null
  attempt?: number
  maxAttempts?: number
}

export function isTerminalTaskStatus(status: string): boolean {
  return status === "completed" || status === "completed_with_errors" || status === "failed"
}

export function statusLabel(status: string): string {
  if (status === "completed_with_errors") return "Completed (with errors)"
  if (status === "queued") return "Queued"
  if (status === "running") return "Running"
  if (status === "completed") return "Completed"
  if (status === "failed") return "Failed"
  return status
}

export function statusClassName(status: string): string {
  if (status === "completed") return "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
  if (status === "completed_with_errors") return "bg-amber-500/15 text-amber-300 border border-amber-500/30"
  if (status === "failed") return "bg-red-500/15 text-red-300 border border-red-500/30"
  if (status === "running") return "bg-blue-500/15 text-blue-300 border border-blue-500/30"
  return "bg-zinc-700/30 text-zinc-300 border border-zinc-600/60"
}

export function parseEventPayload(payload: string | null | undefined): ProgressPayload | null {
  if (!payload) return null
  try {
    const parsed = JSON.parse(payload) as ProgressPayload
    return parsed && typeof parsed === "object" ? parsed : null
  } catch {
    return null
  }
}

export function sourceLabel(source: string): string {
  if (source === "spotify") return "Spotify"
  if (source === "soundcloud") return "SoundCloud"
  if (source === "youtube") return "YouTube"
  return "Download"
}

export function taskProgressPercent(task: DownloadTaskSummary): number | null {
  const total = task.totalItems ?? 0
  if (total > 0) {
    return Math.max(0, Math.min(100, Math.round((task.processedItems / total) * 1000) / 10))
  }
  const payload = parseEventPayload(task.lastEvent?.payload)
  if (payload?.kind === "ytdlp_progress" && typeof payload.percent === "number") {
    return Math.max(0, Math.min(100, Math.round(payload.percent * 10) / 10))
  }
  return null
}

export function taskDisplayName(task: DownloadTaskSummary): string {
  const playlistName = task.playlistTitle?.trim()
  if (playlistName) return playlistName
  const trackName = task.previewTitle?.trim()
  if (trackName) return trackName
  return `${sourceLabel(task.source)} download`
}
