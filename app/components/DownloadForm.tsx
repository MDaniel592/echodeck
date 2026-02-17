"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

interface DownloadFormProps {
  onDownloadStart: () => void
  onDownloadComplete: () => void
}

interface DownloadTaskEvent {
  id: number
  level: string
  message: string
  payload?: string | null
  createdAt: string
}

interface DownloadTaskSummary {
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

interface DownloadTaskDetail extends DownloadTaskSummary {
  events: DownloadTaskEvent[]
  songs: Array<{
    id: number
    title: string
    artist: string | null
    createdAt: string
  }>
}

interface PlaylistOption {
  id: number
  name: string
}

interface TaskListPayload {
  tasks: DownloadTaskSummary[]
  total: number
  page: number
  limit: number
  totalPages: number
}

function isTerminalTaskStatus(status: string): boolean {
  return status === "completed" || status === "completed_with_errors" || status === "failed"
}

function statusLabel(status: string): string {
  if (status === "completed_with_errors") return "Completed (with errors)"
  if (status === "queued") return "Queued"
  if (status === "running") return "Running"
  if (status === "completed") return "Completed"
  if (status === "failed") return "Failed"
  return status
}

function statusClassName(status: string): string {
  if (status === "completed") return "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
  if (status === "completed_with_errors") return "bg-amber-500/15 text-amber-300 border border-amber-500/30"
  if (status === "failed") return "bg-red-500/15 text-red-300 border border-red-500/30"
  if (status === "running") return "bg-blue-500/15 text-blue-300 border border-blue-500/30"
  return "bg-zinc-700/30 text-zinc-300 border border-zinc-600/60"
}

type ProgressPayload = {
  kind?: string
  percent?: number | null
  speed?: string | null
  eta?: string | null
  attempt?: number
  maxAttempts?: number
}

function parseEventPayload(payload: string | null | undefined): ProgressPayload | null {
  if (!payload) return null
  try {
    const parsed = JSON.parse(payload) as ProgressPayload
    return parsed && typeof parsed === "object" ? parsed : null
  } catch {
    return null
  }
}

function sourceLabel(source: string): string {
  if (source === "spotify") return "Spotify"
  if (source === "soundcloud") return "SoundCloud"
  if (source === "youtube") return "YouTube"
  return "Download"
}

function taskProgressPercent(task: DownloadTaskSummary): number | null {
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

function taskDisplayName(task: DownloadTaskSummary): string {
  const playlistName = task.playlistTitle?.trim()
  if (playlistName) return playlistName
  const trackName = task.previewTitle?.trim()
  if (trackName) return trackName
  return `${sourceLabel(task.source)} download`
}

function MusicIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[18px] w-[18px]"
      aria-hidden="true"
    >
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  )
}

function SpotifyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden="true">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
    </svg>
  )
}

function YouTubeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden="true">
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  )
}

function SoundCloudIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden="true">
      <path d="M1.175 12.225c-.051 0-.094.046-.101.1l-.233 2.154.233 2.105c.007.058.05.098.101.098.05 0 .09-.04.099-.098l.255-2.105-.27-2.154c0-.057-.045-.1-.09-.1m-.899.828c-.051 0-.09.04-.099.099l-.135 1.326.135 1.303c.009.058.048.099.099.099.05 0 .09-.04.099-.099l.15-1.303-.15-1.326c-.009-.059-.05-.099-.1-.099m1.799-.783c-.06 0-.107.047-.114.107l-.234 2.107.234 2.025c.007.06.054.107.114.107.06 0 .106-.046.114-.107l.257-2.025-.257-2.107c-.008-.06-.054-.107-.114-.107m.901-.04c-.063 0-.114.052-.122.114l-.216 2.147.216 2.074c.008.063.06.114.122.114.06 0 .112-.051.12-.114l.244-2.074-.244-2.147c-.008-.063-.06-.115-.12-.115m.899.015c-.068 0-.122.055-.129.123l-.209 2.132.209 2.077c.007.067.061.122.129.122.065 0 .12-.055.127-.122l.227-2.077-.227-2.132c-.007-.068-.062-.123-.127-.123m.964-.057c-.07 0-.127.058-.135.128l-.189 2.174.189 2.053c.008.07.065.127.135.127.072 0 .127-.057.135-.127l.211-2.053-.211-2.174c-.008-.07-.063-.128-.135-.128m.862.002c-.073 0-.132.06-.14.134l-.187 2.172.187 2.052c.008.073.067.133.14.133.074 0 .133-.06.14-.133l.21-2.052-.21-2.172c-.007-.074-.066-.134-.14-.134m.895-.002c-.077 0-.138.062-.146.139l-.178 2.17.178 2.042c.008.076.069.138.146.138.076 0 .137-.062.144-.138l.191-2.042-.191-2.17c-.007-.077-.068-.139-.144-.139m.959.002c-.08 0-.144.065-.151.144l-.171 2.163.171 2.053c.007.08.071.145.151.145.078 0 .144-.065.15-.145l.187-2.053-.187-2.163c-.006-.079-.072-.144-.15-.144m4.132.411c-.161 0-.313.033-.456.09v3.401c.006.075.068.134.144.134h4.735c.672 0 1.218-.546 1.218-1.218 0-.672-.546-1.217-1.218-1.217-.157 0-.307.038-.44.105-.15-.806-.85-1.418-1.693-1.418-.22 0-.428.044-.621.12-.253-.738-.96-1.268-1.788-1.268-.18 0-.353.025-.517.072v2.399c.007.077.068.138.145.138h.491v-3.338z" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  )
}

function InfoIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  )
}

export default function DownloadForm({ onDownloadStart, onDownloadComplete }: DownloadFormProps) {
  const TASKS_PAGE_SIZE = 3
  const [url, setUrl] = useState("")
  const [format, setFormat] = useState("mp3")
  const [quality, setQuality] = useState("best")
  const [bestAudioPreference, setBestAudioPreference] = useState<"auto" | "opus" | "aac">("opus")
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [queueMessage, setQueueMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [tasks, setTasks] = useState<DownloadTaskSummary[]>([])
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)
  const [selectedTask, setSelectedTask] = useState<DownloadTaskDetail | null>(null)
  const [taskPage, setTaskPage] = useState(1)
  const [taskTotalPages, setTaskTotalPages] = useState(1)
  const [taskTotal, setTaskTotal] = useState(0)
  const [mobileTaskView, setMobileTaskView] = useState<"history" | "detail">("history")
  const [showLogs, setShowLogs] = useState(false)
  const [playlists, setPlaylists] = useState<PlaylistOption[]>([])
  const [playlistChoice, setPlaylistChoice] = useState("__none__")
  const [newPlaylistName, setNewPlaylistName] = useState("")
  const seenStatusesRef = useRef<Map<number, string>>(new Map())
  const hasFetchedTasksRef = useRef(false)

  const normalizedUrl = url.trim().toLowerCase()
  const isSpotify = normalizedUrl.includes("spotify.com")
  const isYouTube = normalizedUrl.includes("youtube.com") || normalizedUrl.includes("youtu.be")
  const isSoundCloud =
    normalizedUrl.includes("soundcloud.com") || normalizedUrl.includes("on.soundcloud.com")
  const hasPlaylistParam = (() => {
    if (!isYouTube) return false
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return false
      }
      return parsed.searchParams.has("list")
    } catch {
      return false
    }
  })()

  const detectedPlatform = isSpotify
    ? "Spotify"
    : isYouTube
    ? "YouTube"
    : isSoundCloud
    ? "SoundCloud"
    : null
  const creatingPlaylist = playlistChoice === "__new__"
  const hasActiveTasks = useMemo(
    () => tasks.some((task) => !isTerminalTaskStatus(task.status)),
    [tasks]
  )
  const featuredTask = useMemo(() => {
    return tasks.find((task) => !isTerminalTaskStatus(task.status)) ?? null
  }, [tasks])
  const featuredTaskPercent = useMemo(
    () => (featuredTask ? taskProgressPercent(featuredTask) : null),
    [featuredTask]
  )
  const selectedTaskInsights = useMemo(() => {
    if (!selectedTask) return null

    let retryCount = 0
    let transientErrorCount = 0
    let latestProgress: ProgressPayload | null = null

    for (let i = selectedTask.events.length - 1; i >= 0; i -= 1) {
      const payload = parseEventPayload(selectedTask.events[i]?.payload)
      if (!payload) continue

      if (payload.kind === "retry") retryCount += 1
      if (payload.kind === "transient_error") transientErrorCount += 1

      if (!latestProgress && payload.kind === "ytdlp_progress") {
        latestProgress = payload
      }
    }

    return { retryCount, transientErrorCount, latestProgress }
  }, [selectedTask])

  const applyTaskSnapshot = useCallback((nextTasks: DownloadTaskSummary[]) => {
    setTasks(nextTasks)
    const hadFetchedTasks = hasFetchedTasksRef.current
    const nextStatuses = new Map<number, string>()
    for (const task of nextTasks) {
      const previousStatus = seenStatusesRef.current.get(task.id)
      const transitionedToTerminal =
        typeof previousStatus === "string" &&
        !isTerminalTaskStatus(previousStatus) &&
        previousStatus !== task.status &&
        isTerminalTaskStatus(task.status)
      const firstSeenTerminalAfterInitialFetch =
        typeof previousStatus !== "string" && hadFetchedTasks && isTerminalTaskStatus(task.status)
      if (transitionedToTerminal || firstSeenTerminalAfterInitialFetch) {
        onDownloadComplete()
      }
      nextStatuses.set(task.id, task.status)
    }
    seenStatusesRef.current = nextStatuses
    hasFetchedTasksRef.current = true

    setSelectedTaskId((currentId) => {
      if (nextTasks.length === 0) return null
      if (currentId === null) return nextTasks[0].id
      return nextTasks.some((task) => task.id === currentId) ? currentId : nextTasks[0].id
    })
  }, [onDownloadComplete])

  function validateUrl(input: string): boolean {
    if (!input.trim()) return false
    try {
      const urlObj = new URL(input)
      return urlObj.protocol === "http:" || urlObj.protocol === "https:"
    } catch {
      return false
    }
  }

  const isValidUrl = validateUrl(url)
  const canSubmit = isValidUrl && !submitting && detectedPlatform !== null

  const fetchPlaylists = useCallback(async () => {
    try {
      const res = await fetch("/api/playlists", { cache: "no-store" })
      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        return
      }

      const next = Array.isArray(payload) ? payload : []
      const options = next
        .filter((playlist): playlist is PlaylistOption =>
          playlist && typeof playlist.id === "number" && typeof playlist.name === "string"
        )
        .map((playlist) => ({ id: playlist.id, name: playlist.name }))

      setPlaylists(options)
      setPlaylistChoice((current) => {
        if (current === "__none__" || current === "__new__") {
          return current
        }
        const parsed = Number.parseInt(current, 10)
        return options.some((playlist) => playlist.id === parsed) ? current : "__none__"
      })
    } catch {
      // ignore playlist fetch failures
    }
  }, [])

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks?page=${taskPage}&limit=${TASKS_PAGE_SIZE}`, { cache: "no-store" })
      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        const message =
          payload && typeof payload.error === "string"
            ? payload.error
            : "Failed to fetch task history"
        throw new Error(message)
      }

      const nextPayload: TaskListPayload = Array.isArray(payload)
        ? {
            tasks: payload as DownloadTaskSummary[],
            total: (payload as DownloadTaskSummary[]).length,
            page: 1,
            limit: TASKS_PAGE_SIZE,
            totalPages: 1,
          }
        : {
            tasks: Array.isArray(payload?.tasks) ? (payload.tasks as DownloadTaskSummary[]) : [],
            total: typeof payload?.total === "number" ? payload.total : 0,
            page: typeof payload?.page === "number" ? payload.page : taskPage,
            limit: typeof payload?.limit === "number" ? payload.limit : TASKS_PAGE_SIZE,
            totalPages: typeof payload?.totalPages === "number" ? Math.max(1, payload.totalPages) : 1,
          }
      applyTaskSnapshot(nextPayload.tasks)
      setTaskTotal(nextPayload.total)
      setTaskTotalPages(nextPayload.totalPages)
      setHistoryError(null)
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "Failed to fetch task history")
    }
  }, [applyTaskSnapshot, taskPage])

  const fetchTaskDetail = useCallback(async (taskId: number) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}?eventLimit=350&songLimit=200`, {
        cache: "no-store",
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        const message =
          payload && typeof payload.error === "string"
            ? payload.error
            : "Failed to fetch task details"
        throw new Error(message)
      }
      setSelectedTask(payload as DownloadTaskDetail)
      setHistoryError(null)
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "Failed to fetch task details")
    }
  }, [])

  useEffect(() => {
    void fetchTasks()
  }, [fetchTasks])

  useEffect(() => {
    const streamUrl = `/api/tasks/stream?page=${taskPage}&limit=${TASKS_PAGE_SIZE}`
    let cancelled = false
    let source: EventSource | null = null

    try {
      source = new EventSource(streamUrl)
    } catch {
      return
    }

    source.addEventListener("tasks", (event) => {
      if (cancelled) return
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as TaskListPayload
        applyTaskSnapshot(Array.isArray(payload.tasks) ? payload.tasks : [])
        setTaskTotal(typeof payload.total === "number" ? payload.total : 0)
        setTaskTotalPages(
          typeof payload.totalPages === "number" ? Math.max(1, payload.totalPages) : 1
        )
        setHistoryError(null)
      } catch {
        // Ignore malformed SSE payloads.
      }
    })

    source.addEventListener("error", () => {
      if (cancelled) return
      void fetchTasks()
    })

    return () => {
      cancelled = true
      source?.close()
    }
  }, [applyTaskSnapshot, fetchTasks, taskPage])

  useEffect(() => {
    void fetchPlaylists()
  }, [fetchPlaylists])

  useEffect(() => {
    setTaskPage((prev) => Math.min(prev, taskTotalPages))
  }, [taskTotalPages])

  useEffect(() => {
    if (selectedTaskId === null) {
      setSelectedTask(null)
      return
    }

    void fetchTaskDetail(selectedTaskId)
  }, [selectedTaskId, fetchTaskDetail])

  useEffect(() => {
    if (selectedTaskId === null && mobileTaskView === "detail") {
      setMobileTaskView("history")
    }
  }, [mobileTaskView, selectedTaskId])

  useEffect(() => {
    if (selectedTaskId === null) return

    const streamUrl = `/api/tasks/${selectedTaskId}/stream?eventLimit=350&songLimit=200`
    let cancelled = false
    let source: EventSource | null = null

    try {
      source = new EventSource(streamUrl)
    } catch {
      return
    }

    source.addEventListener("task", (event) => {
      if (cancelled) return
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as DownloadTaskDetail
        setSelectedTask(payload)
        setHistoryError(null)
      } catch {
        // Ignore malformed SSE payloads.
      }
    })

    source.addEventListener("error", () => {
      if (cancelled) return
      void fetchTaskDetail(selectedTaskId)
    })

    return () => {
      cancelled = true
      source?.close()
    }
  }, [selectedTaskId, fetchTaskDetail])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    const trimmedPlaylistName = newPlaylistName.trim()
    if (creatingPlaylist && !trimmedPlaylistName) {
      setError("Playlist name is required.")
      return
    }

    let playlistPayload: { playlistId?: number; playlistName?: string } = {}
    if (creatingPlaylist) {
      playlistPayload = { playlistName: trimmedPlaylistName }
    } else if (playlistChoice !== "__none__") {
      const parsedPlaylistId = Number.parseInt(playlistChoice, 10)
      if (!Number.isInteger(parsedPlaylistId) || parsedPlaylistId <= 0) {
        setError("Please choose a valid playlist.")
        return
      }
      playlistPayload = { playlistId: parsedPlaylistId }
    }

    setSubmitting(true)
    setQueueMessage(null)
    setError(null)
    onDownloadStart()

    const endpoint = isSpotify
      ? "/api/download/spotify"
      : "/api/download/youtube"

    const payload = isSpotify
      ? { url, format, ...playlistPayload }
      : {
          url,
          quality,
          bestAudioPreference,
          format: quality === "best" ? undefined : format,
          ...playlistPayload,
        }

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      const payloadJson = await res.json().catch(() => null)
      if (!res.ok) {
        const message =
          payloadJson && typeof payloadJson.error === "string"
            ? payloadJson.error
            : "Failed to queue background task"
        throw new Error(message)
      }

      const task = payloadJson?.task as DownloadTaskSummary | undefined
      if (!task || typeof task.id !== "number") {
        throw new Error("Task queued but server response was invalid")
      }

      seenStatusesRef.current.set(task.id, task.status)
      if (isTerminalTaskStatus(task.status)) {
        onDownloadComplete()
      }

      setQueueMessage(`Queued task #${task.id}. It will continue in background even if you close the tab.`)
      setTaskPage(1)
      setSelectedTaskId(task.id)
      setUrl("")
      if (creatingPlaylist) {
        setNewPlaylistName("")
      }
      if (task.playlist?.id) {
        setPlaylistChoice(String(task.playlist.id))
      }
      await fetchTasks()
      await fetchTaskDetail(task.id)
      await fetchPlaylists()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="rounded-none border-0 bg-transparent p-0 md:rounded-xl md:border md:border-zinc-800/60 md:bg-zinc-900/50 md:p-4">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600/20 text-blue-400 lg:h-10 lg:w-10">
          <MusicIcon />
        </div>
        <div>
          <h2 className="text-xs font-semibold text-zinc-100 lg:text-lg">Download Music</h2>
          <p className="text-[10px] text-zinc-500">YouTube, SoundCloud, or Spotify</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-2.5">
        {/* URL Input */}
        <div>
          <label htmlFor="download-url" className="mb-1.5 block text-xs text-zinc-400">
            Music URL
          </label>
          <div className="relative">
            <input
              id="download-url"
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
              className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-[13px] text-white placeholder-zinc-500 transition-shadow focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={submitting}
              aria-invalid={url.trim() !== "" && !isValidUrl}
              aria-describedby={url.trim() !== "" && !isValidUrl ? "url-error" : undefined}
            />
            {url.trim() !== "" && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                {detectedPlatform && (
                  <div className="flex items-center gap-1.5 rounded-md bg-zinc-700/50 px-2 py-0.5 text-[11px] font-medium text-zinc-300">
                    {isSpotify && <SpotifyIcon />}
                    {isYouTube && <YouTubeIcon />}
                    {isSoundCloud && <SoundCloudIcon />}
                    <span>{detectedPlatform}</span>
                  </div>
                )}
              </div>
            )}
          </div>
          {url.trim() !== "" && !isValidUrl && (
            <p id="url-error" className="mt-1.5 flex items-center gap-1 text-xs text-red-400">
              <InfoIcon />
              Please enter a valid URL
            </p>
          )}
          {url.trim() !== "" && isValidUrl && !detectedPlatform && (
            <p className="mt-1.5 flex items-center gap-1 text-xs text-amber-400">
              <InfoIcon />
              Unsupported platform. Use YouTube, SoundCloud, or Spotify.
            </p>
          )}
          {url.trim() !== "" && isValidUrl && isYouTube && hasPlaylistParam && (
            <p className="mt-1.5 flex items-center gap-1 text-xs text-blue-400">
              <InfoIcon />
              Playlist detected. Queue download will include all tracks in that playlist.
            </p>
          )}
        </div>

        <div className="pt-0.5">
          <button
            type="button"
            onClick={() => setShowAdvancedOptions((current) => !current)}
            className="text-xs text-zinc-400 underline decoration-zinc-600 underline-offset-2 transition-colors hover:text-zinc-200"
          >
            {showAdvancedOptions ? "Hide advanced options" : "Show advanced options"}
          </button>
        </div>

        {showAdvancedOptions && (
          <>
            {/* Format & Quality Settings */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <label htmlFor="download-format" className="mb-1.5 block text-xs text-zinc-400">
                  Format
                </label>
                <select
                  id="download-format"
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-[13px] text-white transition-shadow focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={submitting || (!isSpotify && quality === "best")}
                  aria-label="Audio format"
                >
                  <option value="mp3">MP3</option>
                  <option value="flac">FLAC (lossless)</option>
                  <option value="wav">WAV (lossless)</option>
                  <option value="ogg">OGG Vorbis</option>
                </select>
              </div>

              {!isSpotify && (
                <div>
                  <label htmlFor="download-quality" className="mb-1.5 block text-xs text-zinc-400">
                    Quality
                  </label>
                  <select
                    id="download-quality"
                    value={quality}
                    onChange={(e) => setQuality(e.target.value)}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-[13px] text-white transition-shadow focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                    disabled={submitting}
                    aria-label="Audio quality"
                  >
                    <option value="best">Best Available</option>
                    <option value="320">320 kbps</option>
                    <option value="256">256 kbps</option>
                    <option value="192">192 kbps</option>
                    <option value="128">128 kbps</option>
                  </select>
                </div>
              )}
            </div>

            {/* Best Audio Preference (YouTube/SoundCloud only) */}
            {!isSpotify && quality === "best" && (
              <div className="rounded-lg border border-zinc-700/50 bg-zinc-800/50 p-2">
                <label htmlFor="best-audio-pref" className="mb-1.5 block text-xs text-zinc-400">
                  Best Audio Preference
                </label>
                <select
                  id="best-audio-pref"
                  value={bestAudioPreference}
                  onChange={(e) => setBestAudioPreference(e.target.value as "auto" | "opus" | "aac")}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-[13px] text-white transition-shadow focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={submitting}
                  aria-label="Preferred audio codec for best quality"
                >
                  <option value="opus">Prefer Opus (recommended)</option>
                  <option value="auto">Auto (highest quality)</option>
                  <option value="aac">Prefer AAC/M4A</option>
                </select>
                <p className="mt-1.5 flex items-start gap-1.5 text-xs text-zinc-500">
                  <InfoIcon />
                  <span>
                    Opus is prioritized. If unavailable, audio is converted to Opus at 48 kHz.
                  </span>
                </p>
              </div>
            )}

            <div>
              <div className="rounded-lg border border-zinc-700/50 bg-zinc-800/50 p-2">
                <label htmlFor="download-playlist" className="mb-1.5 block text-xs text-zinc-400">
                  Save To Playlist
                </label>
                <select
                  id="download-playlist"
                  value={playlistChoice}
                  onChange={(e) => setPlaylistChoice(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-[13px] text-white transition-shadow focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={submitting}
                >
                  <option value="__none__">No playlist</option>
                  {playlists.map((playlist) => (
                    <option key={playlist.id} value={playlist.id}>
                      {playlist.name}
                    </option>
                  ))}
                  <option value="__new__">+ Create new playlist</option>
                </select>

                {creatingPlaylist && (
                  <div className="mt-2">
                    <label htmlFor="download-playlist-new" className="mb-1.5 block text-xs text-zinc-400">
                      New Playlist Name
                    </label>
                    <input
                      id="download-playlist-new"
                      type="text"
                      value={newPlaylistName}
                      onChange={(e) => setNewPlaylistName(e.target.value)}
                      placeholder="My playlist"
                      maxLength={80}
                      className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-[13px] text-white placeholder-zinc-500 transition-shadow focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
                      disabled={submitting}
                    />
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {!showAdvancedOptions && (
          <p className="text-xs text-zinc-500">
            Default mode queues the link with best quality, prioritizing Opus.
          </p>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2">
          {!submitting ? (
            <button
              type="submit"
              disabled={!canSubmit}
              className="flex-1 rounded-lg bg-blue-600 py-2 text-[13px] font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-500"
              aria-label="Queue download task"
            >
              Queue Download
            </button>
          ) : (
            <button
              type="button"
              disabled
              className="flex flex-1 cursor-wait items-center justify-center gap-2 rounded-lg bg-blue-600/50 py-2 text-[13px] font-medium text-white"
              aria-label="Queuing task"
            >
              <svg
                className="h-4 w-4 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" opacity="0.25" />
                <path d="M12 2a10 10 0 0 1 10 10" opacity="0.75" />
              </svg>
              Queuing task...
            </button>
          )}
        </div>
      </form>

      {queueMessage && (
        <div className="mt-3 rounded-lg border border-blue-800/60 bg-blue-900/20 p-2 text-xs text-blue-200">
          {queueMessage}
        </div>
      )}

      {featuredTask && (
        <div className="mt-2 rounded-md bg-zinc-900/40 p-2 md:hidden">
          <div className="flex items-start gap-2.5">
            {featuredTask.previewImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={featuredTask.previewImageUrl}
                alt={taskDisplayName(featuredTask)}
                className="h-10 w-10 shrink-0 rounded-lg object-cover"
              />
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-cyan-300">
                {featuredTask.source === "spotify" && <SpotifyIcon />}
                {featuredTask.source === "youtube" && <YouTubeIcon />}
                {featuredTask.source === "soundcloud" && <SoundCloudIcon />}
                {featuredTask.source !== "spotify" &&
                  featuredTask.source !== "youtube" &&
                  featuredTask.source !== "soundcloud" && <MusicIcon />}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-wide text-cyan-300/90">Downloading</p>
              <p className="truncate text-sm font-semibold text-zinc-100">
                {taskDisplayName(featuredTask)}
              </p>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all"
                  style={{ width: `${featuredTaskPercent ?? 0}%` }}
                />
              </div>
            </div>
            <div className="text-right text-[10px] text-zinc-400">
              {featuredTask.processedItems}
              {featuredTask.totalItems ? `/${featuredTask.totalItems}` : ""} · {featuredTaskPercent ?? 0}%
            </div>
          </div>
          {featuredTask.lastEvent?.message && (
            <p className="mt-1 truncate text-[11px] text-zinc-500">{featuredTask.lastEvent.message}</p>
          )}
        </div>
      )}

      <div className="mt-2 md:hidden">
        <div className="px-0.5 py-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-zinc-300">Tasks</span>
              <span className="text-[10px] text-zinc-500">{taskTotal} total</span>
              {hasActiveTasks && (
                <span className="rounded-full border border-blue-500/40 bg-blue-500/20 px-1.5 py-0.5 text-[10px] text-blue-300">
                  Live
                </span>
              )}
            </div>
            <div className="rounded-md bg-zinc-900/50 p-0.5">
              <button
                type="button"
                onClick={() => setMobileTaskView("history")}
                className={`rounded px-2 py-1 text-[10px] ${
                  mobileTaskView === "history" ? "bg-zinc-700 text-zinc-100" : "text-zinc-400"
                }`}
              >
                History
              </button>
              <button
                type="button"
                onClick={() => setMobileTaskView("detail")}
                className={`rounded px-2 py-1 text-[10px] ${
                  mobileTaskView === "detail" ? "bg-zinc-700 text-zinc-100" : "text-zinc-400"
                }`}
              >
                Detail
              </button>
            </div>
          </div>
        </div>

        {mobileTaskView === "history" ? (
          <>
            <div className="px-0.5 py-1">
              <div className="flex items-center justify-end gap-1">
                <button
                  type="button"
                  onClick={() => setTaskPage((prev) => Math.max(1, prev - 1))}
                  disabled={taskPage <= 1}
                  className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Prev
                </button>
                <span className="text-[10px] text-zinc-500">
                  {taskPage}/{taskTotalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setTaskPage((prev) => Math.min(taskTotalPages, prev + 1))}
                  disabled={taskPage >= taskTotalPages}
                  className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
            {tasks.length === 0 ? (
              <div className="py-2 text-xs text-zinc-500">No tasks yet.</div>
            ) : (
              <div className="divide-y divide-zinc-900/80">
                {tasks.map((task) => {
                  const selected = task.id === selectedTaskId
                  const total = task.totalItems ?? 0
                  const progressPercent = taskProgressPercent(task)
                  return (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => {
                        setSelectedTaskId(task.id)
                        setMobileTaskView("detail")
                      }}
                      className={`w-full px-1 py-2 text-left transition-colors ${
                        selected ? "bg-zinc-900/60" : "hover:bg-zinc-900/40"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="flex items-center gap-1.5 text-xs font-medium text-zinc-200">
                          {task.source === "spotify" && <SpotifyIcon />}
                          {task.source === "youtube" && <YouTubeIcon />}
                          {task.source === "soundcloud" && <SoundCloudIcon />}
                          {taskDisplayName(task)}
                        </p>
                        <span className={`rounded-md px-1.5 py-0.5 text-[10px] ${statusClassName(task.status)}`}>
                          {statusLabel(task.status)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[10px] text-zinc-500">
                        {task.processedItems}
                        {total > 0 ? `/${total}` : ""} processed
                      </p>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all"
                          style={{ width: `${progressPercent ?? 0}%` }}
                        />
                      </div>
                      {progressPercent !== null && (
                        <p className="mt-0.5 text-[11px] text-blue-300">
                          {progressPercent}%
                        </p>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </>
        ) : selectedTask ? (
          <>
            <div className="flex items-center justify-between px-0.5 py-1.5">
              <span className="text-xs font-medium text-zinc-300">Task detail</span>
              <span className={`rounded-md px-1.5 py-0.5 text-[10px] ${statusClassName(selectedTask.status)}`}>
                {statusLabel(selectedTask.status)}
              </span>
            </div>
            {selectedTaskInsights && (
              <div className="flex flex-wrap items-center gap-1.5 px-0.5 py-1.5 text-[10px] text-zinc-300">
                <span className="rounded border border-zinc-700 bg-zinc-800/70 px-1.5 py-0.5">
                  Retries: {selectedTaskInsights.retryCount}
                </span>
                <span className="rounded border border-zinc-700 bg-zinc-800/70 px-1.5 py-0.5">
                  Success: {selectedTask.successfulItems}
                </span>
                <span className="rounded border border-zinc-700 bg-zinc-800/70 px-1.5 py-0.5">
                  Failed: {selectedTask.failedItems}
                </span>
                {selectedTaskInsights.latestProgress &&
                  typeof selectedTaskInsights.latestProgress.percent === "number" && (
                    <span className="rounded border border-blue-700/70 bg-blue-900/20 px-1.5 py-0.5 text-blue-300">
                      {Math.round(selectedTaskInsights.latestProgress.percent * 10) / 10}%
                    </span>
                  )}
              </div>
            )}
            <div className="px-0.5 py-1.5">
              <button
                type="button"
                onClick={() => setShowLogs(true)}
                className="w-full rounded-md bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800"
              >
                Open logs
              </button>
            </div>
          </>
        ) : (
          <div className="py-2 text-xs text-zinc-500">Select a task from history to view detail.</div>
        )}
      </div>

      <div className="mt-3 hidden gap-3 md:grid md:grid-cols-12">
        <div className="col-span-8 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/50">
          <div className="border-b border-zinc-800/60 bg-zinc-900/50 px-2.5 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-zinc-400 lg:text-sm">Task History</span>
                <span className="text-[10px] text-zinc-500 lg:text-xs">{taskTotal} total</span>
                {hasActiveTasks && (
                  <span className="rounded-full border border-blue-500/40 bg-blue-500/20 px-1.5 py-0.5 text-[10px] text-blue-300">
                    Live
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setTaskPage((prev) => Math.max(1, prev - 1))}
                  disabled={taskPage <= 1}
                  className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Prev
                </button>
                <span className="text-[10px] text-zinc-500">
                  {taskPage}/{taskTotalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setTaskPage((prev) => Math.min(taskTotalPages, prev + 1))}
                  disabled={taskPage >= taskTotalPages}
                  className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
          {tasks.length === 0 ? (
            <div className="p-2 text-xs text-zinc-500 lg:text-base">No tasks yet.</div>
          ) : (
            <div>
              {tasks.map((task) => {
                const selected = task.id === selectedTaskId
                const total = task.totalItems ?? 0
                const lastPayload = parseEventPayload(task.lastEvent?.payload)
                const progressPercent = taskProgressPercent(task)
                return (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => setSelectedTaskId(task.id)}
                    className={`w-full border-b border-zinc-900 px-2.5 py-1.5 text-left transition-colors last:border-b-0 ${
                      selected ? "bg-zinc-800/70" : "hover:bg-zinc-900/70"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-200 lg:text-base">
                        {task.source === "spotify" && <SpotifyIcon />}
                        {task.source === "youtube" && <YouTubeIcon />}
                        {task.source === "soundcloud" && <SoundCloudIcon />}
                        {taskDisplayName(task)}
                      </p>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-md lg:text-sm ${statusClassName(task.status)}`}>
                        {statusLabel(task.status)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[10px] text-zinc-400 lg:text-sm">
                      {task.processedItems}
                      {total > 0 ? `/${total}` : ""} processed, {task.successfulItems} success, {task.failedItems} failed
                    </p>
                    {task.playlist?.name && (
                      <p className="mt-0.5 text-[10px] text-zinc-500 lg:text-sm">Playlist: {task.playlist.name}</p>
                    )}
                    {task.lastEvent?.message && (
                      <p className="mt-0.5 truncate text-sm text-zinc-500">{task.lastEvent.message}</p>
                    )}
                    {progressPercent !== null && (
                      <p className="mt-0.5 text-sm text-blue-300">
                        Progress: {progressPercent}%
                        {lastPayload?.speed ? ` @ ${lastPayload.speed}` : ""}
                        {lastPayload?.eta ? ` ETA ${lastPayload.eta}` : ""}
                      </p>
                    )}
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all"
                        style={{ width: `${progressPercent ?? 0}%` }}
                      />
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="col-span-4 space-y-3">
          {featuredTask && (
            <div className="overflow-hidden rounded-xl border border-cyan-700/40 bg-gradient-to-br from-cyan-900/25 to-zinc-900/80">
              <div className="flex items-start gap-3 p-3">
                {featuredTask.previewImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={featuredTask.previewImageUrl}
                    alt={taskDisplayName(featuredTask)}
                    className="h-14 w-14 shrink-0 rounded-xl object-cover shadow-[0_0_24px_rgba(34,211,238,0.15)]"
                  />
                ) : (
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-cyan-500/30 bg-zinc-900 text-cyan-300 shadow-[0_0_24px_rgba(34,211,238,0.15)]">
                    {featuredTask.source === "spotify" && <SpotifyIcon />}
                    {featuredTask.source === "youtube" && <YouTubeIcon />}
                    {featuredTask.source === "soundcloud" && <SoundCloudIcon />}
                    {featuredTask.source !== "spotify" &&
                      featuredTask.source !== "youtube" &&
                      featuredTask.source !== "soundcloud" && <MusicIcon />}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] uppercase tracking-wide text-cyan-300/90">Now Downloading</p>
                  <p className="mt-0.5 truncate text-sm font-semibold text-zinc-100">
                    {taskDisplayName(featuredTask)}
                  </p>
                </div>
              </div>
              <div className="px-3 pb-3">
                <div className="mb-1 flex items-center justify-between text-[11px] text-zinc-400">
                  <span>
                    {featuredTask.processedItems}
                    {featuredTask.totalItems ? `/${featuredTask.totalItems}` : ""} processed
                  </span>
                  <span>{featuredTaskPercent !== null ? `${featuredTaskPercent}%` : statusLabel(featuredTask.status)}</span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all"
                    style={{ width: `${featuredTaskPercent ?? 0}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/50">
            <div className="flex items-center justify-between border-b border-zinc-800/60 bg-zinc-900/50 px-2.5 py-1.5">
              <span className="text-xs font-medium text-zinc-300">Selection</span>
              {selectedTask && (
                <span className={`rounded-md px-1.5 py-0.5 text-[10px] ${statusClassName(selectedTask.status)}`}>
                  {statusLabel(selectedTask.status)}
                </span>
              )}
            </div>
            {!selectedTask ? (
              <div className="p-3 text-xs text-zinc-500">Select a task from history to inspect it.</div>
            ) : (
              <div className="space-y-2 p-3">
                <p className="flex items-center gap-1.5 truncate text-sm font-medium text-zinc-200">
                  {selectedTask.source === "spotify" && <SpotifyIcon />}
                  {selectedTask.source === "youtube" && <YouTubeIcon />}
                  {selectedTask.source === "soundcloud" && <SoundCloudIcon />}
                  {taskDisplayName(selectedTask)}
                </p>
                <div className="flex flex-wrap gap-1.5 text-[10px] text-zinc-300">
                  <span className="rounded border border-zinc-700 bg-zinc-800/70 px-1.5 py-0.5">
                    Success: {selectedTask.successfulItems}
                  </span>
                  <span className="rounded border border-zinc-700 bg-zinc-800/70 px-1.5 py-0.5">
                    Failed: {selectedTask.failedItems}
                  </span>
                  {selectedTaskInsights && (
                    <span className="rounded border border-zinc-700 bg-zinc-800/70 px-1.5 py-0.5">
                      Retries: {selectedTaskInsights.retryCount}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setShowLogs(true)}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800"
                >
                  Open logs
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 border-t border-zinc-800/60 pt-2 md:overflow-hidden md:rounded-lg md:border md:bg-zinc-950/60 md:pt-0">
        <button
          type="button"
          onClick={() => setShowLogs((prev) => !prev)}
          className="flex w-full items-center justify-between px-0.5 py-1.5 text-left md:border-b md:border-zinc-800/60 md:bg-zinc-900/50 md:px-2.5"
        >
          <span className="text-xs font-medium text-zinc-300 lg:text-sm">
            Logs {selectedTask ? `(Task #${selectedTask.id})` : ""}
          </span>
          <span className="text-[10px] text-zinc-500">{showLogs ? "Hide" : "Show"}</span>
        </button>
        {showLogs && (
          <div className="max-h-52 space-y-1 overflow-y-auto px-0.5 pb-4 pt-1 font-mono text-xs text-zinc-300 md:max-h-72 md:p-2.5 md:pb-4 md:text-sm">
            {!selectedTask ? (
              <div className="text-zinc-500">Select a task to view logs.</div>
            ) : selectedTask.events.length === 0 ? (
              <div className="text-zinc-500">No events yet.</div>
            ) : (
              selectedTask.events.map((event) => (
                <div key={event.id} className="leading-relaxed">
                  {event.message}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {historyError && (
        <div className="mt-3 rounded-lg border border-amber-800/60 bg-amber-900/20 p-2.5 text-xs text-amber-300">
          {historyError}
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="mt-3 rounded-lg border border-red-800/60 bg-red-900/20 p-3">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 mt-0.5">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4 text-red-400"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4" />
                <path d="M12 16h.01" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="mb-1 text-xs font-medium text-red-400">Download Failed</h3>
              <p className="text-xs text-red-300/90">{error}</p>
            </div>
            <button
              type="button"
              onClick={() => setError(null)}
              className="flex-shrink-0 text-red-400/60 hover:text-red-300 transition-colors"
              aria-label="Dismiss error"
            >
              <CloseIcon />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
