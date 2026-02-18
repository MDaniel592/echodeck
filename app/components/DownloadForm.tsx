"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CloseIcon, InfoIcon, MusicIcon, SoundCloudIcon, SpotifyIcon, YouTubeIcon } from "./download/icons"
import FeaturedTaskCard from "./download/FeaturedTaskCard"
import TaskHistoryItem from "./download/TaskHistoryItem"
import { SourceIcon, TaskPager, TaskStatusBadge } from "./download/taskUi"
import { getDownloadUrlInfo } from "./download/url"
import {
  type DownloadTaskDetail,
  type DownloadTaskSummary,
  type PlaylistOption,
  type ProgressPayload,
  type TaskListPayload,
  isTerminalTaskStatus,
  parseEventPayload,
  taskDisplayName,
  taskProgressPercent,
} from "./download/types"

interface DownloadFormProps {
  onDownloadStart: () => void
  onDownloadComplete: () => void
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

  const { isSpotify, isYouTube, isSoundCloud, hasPlaylistParam, detectedPlatform } = useMemo(
    () => getDownloadUrlInfo(url),
    [url]
  )
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
        <FeaturedTaskCard task={featuredTask} percent={featuredTaskPercent} variant="mobile" />
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
              <div className="flex items-center justify-end">
                <TaskPager page={taskPage} totalPages={taskTotalPages} onPageChange={setTaskPage} />
              </div>
            </div>
            {tasks.length === 0 ? (
              <div className="py-2 text-xs text-zinc-500">No tasks yet.</div>
            ) : (
              <div className="divide-y divide-zinc-900/80">
                {tasks.map((task) => {
                  const selected = task.id === selectedTaskId
                  return (
                    <TaskHistoryItem
                      key={task.id}
                      task={task}
                      selected={selected}
                      variant="mobile"
                      onSelect={() => {
                        setSelectedTaskId(task.id)
                        setMobileTaskView("detail")
                      }}
                    />
                  )
                })}
              </div>
            )}
          </>
        ) : selectedTask ? (
          <>
            <div className="flex items-center justify-between px-0.5 py-1.5">
              <span className="text-xs font-medium text-zinc-300">Task detail</span>
              <TaskStatusBadge status={selectedTask.status} className="rounded-md px-1.5 py-0.5 text-[10px]" />
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
                <TaskPager page={taskPage} totalPages={taskTotalPages} onPageChange={setTaskPage} />
              </div>
            </div>
          </div>
          {tasks.length === 0 ? (
            <div className="p-2 text-xs text-zinc-500 lg:text-base">No tasks yet.</div>
          ) : (
            <div>
              {tasks.map((task) => {
                const selected = task.id === selectedTaskId
                return (
                  <TaskHistoryItem
                    key={task.id}
                    task={task}
                    selected={selected}
                    variant="desktop"
                    onSelect={() => setSelectedTaskId(task.id)}
                  />
                )
              })}
            </div>
          )}
        </div>

        <div className="col-span-4 space-y-3">
          {featuredTask && (
            <FeaturedTaskCard task={featuredTask} percent={featuredTaskPercent} variant="desktop" />
          )}

          <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/50">
            <div className="flex items-center justify-between border-b border-zinc-800/60 bg-zinc-900/50 px-2.5 py-1.5">
              <span className="text-xs font-medium text-zinc-300">Selection</span>
              {selectedTask && (
                <TaskStatusBadge status={selectedTask.status} className="rounded-md px-1.5 py-0.5 text-[10px]" />
              )}
            </div>
            {!selectedTask ? (
              <div className="p-3 text-xs text-zinc-500">Select a task from history to inspect it.</div>
            ) : (
              <div className="space-y-2 p-3">
                <p className="flex items-center gap-1.5 truncate text-sm font-medium text-zinc-200">
                  <SourceIcon source={selectedTask.source} />
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
