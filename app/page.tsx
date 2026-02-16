"use client"

import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import DownloadForm from "./components/DownloadForm"
import SongList from "./components/SongList"
import Player from "./components/Player"
import LibraryManagementPanel from "./components/library/LibraryManagementPanel"
import LibraryToolbar from "./components/library/LibraryToolbar"
import LibraryGroupFolder from "./components/library/LibraryGroupFolder"
import SongGridCards from "./components/library/SongGridCards"
import MaintenancePanel from "./components/admin/MaintenancePanel"
import { normalizeSongTitle } from "../lib/songTitle"
import { removeQueueItem, reorderQueue } from "../lib/playbackQueue"
import { groupSongsByScope } from "../lib/songGrouping"

interface Song {
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

interface Playlist {
  id: number
  name: string
  createdAt: string
  _count: { songs: number }
}

type RepeatMode = "off" | "all" | "one"
type ScopeMode = "all" | "playlists" | "libraries"
type ViewMode = "list" | "grid"

interface LibrarySummary {
  id: number
  name: string
}

const QUEUE_STORAGE_KEY = "echodeck.queue.ids"
const DEVICE_ID_STORAGE_KEY = "echodeck.device.id"

function LogoutIcon() {
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
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  )
}


export default function Home() {
  const router = useRouter()
  const [songs, setSongs] = useState<Song[]>([])
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [libraries, setLibraries] = useState<LibrarySummary[]>([])
  const [currentSongId, setCurrentSongId] = useState<number | null>(null)
  const [queueIds, setQueueIds] = useState<number[]>([])
  const [activeTab, setActiveTab] = useState<"player" | "download" | "manage" | "repair">("player")
  const [scopeMode, setScopeMode] = useState<ScopeMode>("all")
  const [viewMode, setViewMode] = useState<ViewMode>("grid")
  const [expandedGroupKey, setExpandedGroupKey] = useState<string | null>(null)
  const [selectedPlaylist, setSelectedPlaylist] = useState<string>("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const hydratedPlaybackRef = useRef(false)
  const currentSongIdRef = useRef<number | null>(null)
  const playbackStateRef = useRef<{
    positionSec: number
    isPlaying: boolean
    repeatMode: RepeatMode
    shuffle: boolean
  }>({
    positionSec: 0,
    isPlaying: false,
    repeatMode: "off",
    shuffle: false,
  })
  const sessionSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const songById = useMemo(() => new Map(songs.map((song) => [song.id, song])), [songs])

  const currentSong =
    currentSongId === null
      ? null
      : (songById.get(currentSongId) ?? null)

  const queueSongs = useMemo(
    () => queueIds
      .map((id) => songById.get(id))
      .filter((song): song is Song => Boolean(song)),
    [queueIds, songById]
  )

  useEffect(() => {
    try {
      const existing = localStorage.getItem(DEVICE_ID_STORAGE_KEY)
      if (existing && existing.trim()) {
        setDeviceId(existing)
        return
      }
      const generated = `web-${Math.random().toString(36).slice(2, 12)}`
      localStorage.setItem(DEVICE_ID_STORAGE_KEY, generated)
      setDeviceId(generated)
    } catch {
      setDeviceId("web-fallback")
    }
  }, [])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(QUEUE_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return
      const ids = parsed.filter((id): id is number => Number.isInteger(id))
      setQueueIds(ids)
    } catch {
      // ignore storage access failures
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queueIds))
    } catch {
      // ignore storage access failures
    }
  }, [queueIds])

  useEffect(() => {
    if (loading) return
    setQueueIds((prev) => {
      const filtered = prev.filter((id) => songById.has(id))
      return filtered.length === prev.length ? prev : filtered
    })
  }, [songById, loading])

  useEffect(() => {
    if (currentSongId === null) return
    if (!songById.has(currentSongId)) {
      setCurrentSongId(null)
    }
  }, [currentSongId, songById])

  useEffect(() => {
    currentSongIdRef.current = currentSongId
  }, [currentSongId])

  useEffect(() => {
    if (activeTab === "player") return
    setSearchQuery("")
  }, [activeTab])

  const fetchSongs = useCallback(async () => {
    try {
      const pageSize = 1000
      const firstRes = await fetch(`/api/songs?page=1&limit=${pageSize}`, {
        cache: "no-store",
      })
      if (!firstRes.ok) {
        throw new Error(`Song fetch failed with HTTP ${firstRes.status}`)
      }

      const firstPayload = await firstRes.json() as { songs?: Song[]; totalPages?: number } | Song[]
      const firstSongs = Array.isArray(firstPayload)
        ? firstPayload
        : (Array.isArray(firstPayload.songs) ? firstPayload.songs : [])

      let allSongs = [...firstSongs]
      const totalPages =
        Array.isArray(firstPayload) || typeof firstPayload.totalPages !== "number" || firstPayload.totalPages < 2
          ? 1
          : firstPayload.totalPages

      if (totalPages > 1) {
        const pagePromises = Array.from({ length: totalPages - 1 }, async (_, index) => {
          const page = index + 2
          const res = await fetch(`/api/songs?page=${page}&limit=${pageSize}`, { cache: "no-store" })
          if (!res.ok) {
            throw new Error(`Song fetch failed with HTTP ${res.status}`)
          }
          const payload = await res.json() as { songs?: Song[] } | Song[]
          return Array.isArray(payload) ? payload : (Array.isArray(payload.songs) ? payload.songs : [])
        })
        const pages = await Promise.all(pagePromises)
        for (const songsPage of pages) {
          allSongs.push(...songsPage)
        }
      }

      setSongs(allSongs.map((song) => ({
        ...song,
        title: normalizeSongTitle(song.title || "Unknown title"),
      })))
    } catch (err) {
      console.error("Failed to fetch songs:", err)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchPlaylists = useCallback(async () => {
    try {
      const res = await fetch("/api/playlists")
      if (res.ok) {
        const data = await res.json()
        setPlaylists(data)
      }
    } catch (err) {
      console.error("Failed to fetch playlists:", err)
    }
  }, [])

  const fetchLibraries = useCallback(async () => {
    try {
      const res = await fetch("/api/libraries", { cache: "no-store" })
      if (!res.ok) return
      const data = await res.json() as Array<{ id?: number; name?: string }>
      if (!Array.isArray(data)) return
      setLibraries(
        data
          .filter((library): library is { id: number; name: string } => Number.isInteger(library.id) && typeof library.name === "string")
          .map((library) => ({ id: library.id, name: library.name }))
      )
    } catch (err) {
      console.error("Failed to fetch libraries:", err)
    }
  }, [])

  useEffect(() => {
    fetchSongs()
    fetchPlaylists()
    fetchLibraries()
  }, [fetchSongs, fetchPlaylists, fetchLibraries])

  useEffect(() => {
    if (!deviceId || songs.length === 0 || hydratedPlaybackRef.current) return
    const resolvedDeviceId = deviceId

    async function hydratePlaybackSession() {
      try {
        const res = await fetch(`/api/playback/session?deviceId=${encodeURIComponent(resolvedDeviceId)}`, {
          cache: "no-store",
        })
        if (!res.ok) return
        const payload = await res.json() as {
          session?: {
            currentSong?: { id: number } | null
            positionSec?: number
            isPlaying?: boolean
            repeatMode?: RepeatMode
            shuffle?: boolean
          } | null
          queue?: Array<{ song?: { id: number } }>
        }
        const queued = Array.isArray(payload.queue)
          ? payload.queue
              .map((item) => (Number.isInteger(item.song?.id) ? item.song!.id : null))
              .filter((id): id is number => id !== null && songById.has(id))
          : []

        if (queued.length > 0) {
          setQueueIds(queued)
        }

        const currentId = payload.session?.currentSong?.id
        if (typeof currentId === "number" && Number.isInteger(currentId) && songById.has(currentId)) {
          setCurrentSongId(currentId)
        }
        playbackStateRef.current = {
          positionSec: typeof payload.session?.positionSec === "number" ? Math.max(0, payload.session.positionSec) : 0,
          isPlaying: Boolean(payload.session?.isPlaying),
          repeatMode:
            payload.session?.repeatMode === "all" || payload.session?.repeatMode === "one"
              ? payload.session.repeatMode
              : "off",
          shuffle: Boolean(payload.session?.shuffle),
        }
      } catch (error) {
        console.error("Failed to hydrate playback session:", error)
      } finally {
        hydratedPlaybackRef.current = true
      }
    }

    void hydratePlaybackSession()
  }, [deviceId, songs.length, songById])

  useEffect(() => {
    if (!deviceId || !hydratedPlaybackRef.current) return

    async function syncQueue() {
      try {
        await fetch("/api/playback/queue", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            deviceId,
            songIds: queueIds,
          }),
        })
      } catch (error) {
        console.error("Failed to sync playback queue:", error)
      }
    }

    void syncQueue()
  }, [deviceId, queueIds])

  const syncPlaybackSession = useCallback(async () => {
    if (!deviceId || !hydratedPlaybackRef.current) return
    const snapshot = playbackStateRef.current

    try {
      await fetch("/api/playback/session", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId,
          currentSongId: currentSongIdRef.current,
          positionSec: snapshot.positionSec,
          isPlaying: snapshot.isPlaying,
          repeatMode: snapshot.repeatMode,
          shuffle: snapshot.shuffle,
        }),
      })
    } catch (error) {
      console.error("Failed to sync playback session:", error)
    }
  }, [deviceId])

  const schedulePlaybackSessionSync = useCallback(() => {
    if (sessionSyncTimeoutRef.current) {
      clearTimeout(sessionSyncTimeoutRef.current)
    }
    sessionSyncTimeoutRef.current = setTimeout(() => {
      sessionSyncTimeoutRef.current = null
      void syncPlaybackSession()
    }, 700)
  }, [syncPlaybackSession])

  useEffect(() => {
    if (!deviceId || !hydratedPlaybackRef.current) return
    void syncPlaybackSession()
  }, [deviceId, currentSongId, syncPlaybackSession])

  useEffect(() => {
    return () => {
      if (!sessionSyncTimeoutRef.current) return
      clearTimeout(sessionSyncTimeoutRef.current)
    }
  }, [])

  async function handleDeleteMany(ids: number[]) {
    const uniqueIds = Array.from(new Set(ids))
    if (uniqueIds.length === 0) return

    try {
      const res = await fetch("/api/songs/bulk", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: uniqueIds }),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        const message = payload && typeof payload.error === "string"
          ? payload.error
          : "Failed to delete selected songs"
        throw new Error(message)
      }

      const deletedIds = Array.isArray(payload?.deletedIds)
        ? payload.deletedIds.filter((id: unknown): id is number => Number.isInteger(id))
        : []
      const deletedSet = new Set(deletedIds)
      if (deletedSet.size === 0) {
        throw new Error("Failed to delete selected songs")
      }

      setSongs((prev) => prev.filter((song) => !deletedSet.has(song.id)))
      setQueueIds((prev) => {
        const nextQueue = prev.filter((queueId) => !deletedSet.has(queueId))
        setCurrentSongId((curr) =>
          curr !== null && deletedSet.has(curr)
            ? (nextQueue[0] ?? null)
            : curr
        )
        return nextQueue
      })
      fetchPlaylists()

      if (deletedIds.length !== uniqueIds.length) {
        console.error(`Only deleted ${deletedIds.length}/${uniqueIds.length} songs`)
      }
    } catch (err) {
      console.error("Failed to delete songs:", err)
      throw err
    }
  }

  async function handleDelete(id: number) {
    try {
      await handleDeleteMany([id])
    } catch {
      // Single-item delete errors are already logged in handleDeleteMany.
    }
  }

  async function createPlaylist(name: string): Promise<Playlist> {
    const trimmedName = name.trim()
    if (!trimmedName) {
      throw new Error("Playlist name is required")
    }

    const res = await fetch("/api/playlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmedName }),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || "Failed to create playlist")
    }

    const playlist = (await res.json()) as Playlist
    setPlaylists((prev) => {
      const deduped = [...prev.filter((p) => p.id !== playlist.id), playlist]
      return deduped.sort((a, b) => a.name.localeCompare(b.name))
    })
    return playlist
  }

  async function handleAssignPlaylistMany(songIds: number[], playlistId: number | null) {
    const uniqueIds = Array.from(new Set(songIds))
    if (uniqueIds.length === 0) return

    try {
      const res = await fetch("/api/songs/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: uniqueIds, playlistId }),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        const message = payload && typeof payload.error === "string"
          ? payload.error
          : "Failed to assign playlist"
        throw new Error(message)
      }

      const updatedIds = Array.isArray(payload?.updatedIds)
        ? payload.updatedIds.filter((id: unknown): id is number => Number.isInteger(id))
        : []
      const updatedSet = new Set(updatedIds)
      if (updatedSet.size === 0) {
        throw new Error("Failed to assign playlist")
      }
      setSongs((prev) =>
        prev.map((song) =>
          updatedSet.has(song.id)
            ? { ...song, playlistId }
            : song
        )
      )
      fetchPlaylists()

      if (updatedIds.length !== uniqueIds.length) {
        console.error(`Only updated ${updatedIds.length}/${uniqueIds.length} songs`)
      }
    } catch (err) {
      console.error("Failed to assign playlist:", err)
      throw err
    }
  }

  async function handleAssignPlaylist(songId: number, playlistId: number | null) {
    try {
      await handleAssignPlaylistMany([songId], playlistId)
    } catch {
      // Single-item assign errors are already logged in handleAssignPlaylistMany.
    }
  }

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" })
      router.replace("/login")
    } catch {
      router.replace("/login")
    }
  }

  const scopedSongs = useMemo(() => {
    if (scopeMode === "libraries") return songs
    return songs.filter((song) => {
      if (selectedPlaylist === "all") return true
      if (selectedPlaylist === "none") return song.playlistId === null
      const selectedId = Number.parseInt(selectedPlaylist, 10)
      return song.playlistId === selectedId
    })
  }, [songs, selectedPlaylist, scopeMode])

  const normalizedSearch = searchQuery.trim().toLowerCase()
  const searchableSongTextById = useMemo(
    () =>
      new Map(
        songs.map((song) => [
          song.id,
          [song.title, song.artist ?? "", song.source, song.format, song.quality ?? ""]
            .join(" ")
            .toLowerCase(),
        ])
      ),
    [songs]
  )

  const visibleSongs = useMemo(() => {
    if (!normalizedSearch) return scopedSongs
    return scopedSongs.filter((song) => {
      const haystack = searchableSongTextById.get(song.id) ?? ""
      return haystack.includes(normalizedSearch)
    })
  }, [scopedSongs, normalizedSearch, searchableSongTextById])

  const playlistNameById = useMemo(
    () => new Map(playlists.map((playlist) => [playlist.id, playlist.name])),
    [playlists]
  )
  const libraryNameById = useMemo(
    () => new Map(libraries.map((library) => [library.id, library.name])),
    [libraries]
  )
  const unassignedCount = useMemo(
    () => songs.reduce((count, song) => count + (song.playlistId === null ? 1 : 0), 0),
    [songs]
  )

  const groupedVisibleSongs = useMemo(
    () => groupSongsByScope(visibleSongs, scopeMode, playlistNameById, libraryNameById),
    [scopeMode, visibleSongs, playlistNameById, libraryNameById]
  )

  useEffect(() => {
    if (scopeMode === "all") {
      setExpandedGroupKey(null)
      return
    }

    if (groupedVisibleSongs.length === 0) {
      setExpandedGroupKey(null)
      return
    }

    setExpandedGroupKey((prev) => {
      if (prev && groupedVisibleSongs.some((group) => group.key === prev)) {
        return prev
      }
      return groupedVisibleSongs[0].key
    })
  }, [scopeMode, groupedVisibleSongs])

  function handleAddToQueue(song: Song) {
    setQueueIds((prev) => (prev.includes(song.id) ? prev : [...prev, song.id]))
  }

  function handlePlaySong(song: Song) {
    setCurrentSongId(song.id)
    // Queue all visible songs starting from the clicked one so they play in order
    const clickedIndex = visibleSongs.findIndex((s) => s.id === song.id)
    const orderedIds = [
      ...visibleSongs.slice(clickedIndex).map((s) => s.id),
      ...visibleSongs.slice(0, clickedIndex).map((s) => s.id),
    ]
    setQueueIds(orderedIds)
  }

  function handlePlayNext(song: Song) {
    if (currentSongId === null) {
      setQueueIds((prev) => (prev.includes(song.id) ? prev : [song.id, ...prev]))
      setCurrentSongId(song.id)
      return
    }

    setQueueIds((prev) => {
      const withoutSong = prev.filter((id) => id !== song.id)
      const withCurrent = withoutSong.includes(currentSongId)
        ? withoutSong
        : [currentSongId, ...withoutSong]
      const currentIndex = withCurrent.indexOf(currentSongId)
      const nextQueue = [...withCurrent]
      nextQueue.splice(currentIndex + 1, 0, song.id)
      return nextQueue
    })
  }

  function handleQueueReorder(fromIndex: number, toIndex: number) {
    setQueueIds((prev) => reorderQueue(prev, fromIndex, toIndex))
  }

  function handleQueueRemove(songId: number, index: number) {
    setQueueIds((prev) => {
      const next = removeQueueItem(prev, songId, index)
      if (next === prev) return prev
      if (currentSongId !== null && !next.includes(currentSongId)) {
        setCurrentSongId(next[0] ?? null)
      }
      return next
    })
  }

  function renderGroupFolders(children: (group: { key: string; label: string; songs: Song[] }, isOpen: boolean) => ReactNode) {
    return (
      <div className="space-y-3">
        {groupedVisibleSongs.map((group) => {
          const isOpen = expandedGroupKey === group.key
          return (
            <LibraryGroupFolder
              key={group.key}
              label={group.label}
              count={group.songs.length}
              isOpen={isOpen}
              onToggle={() => setExpandedGroupKey((prev) => (prev === group.key ? null : group.key))}
            >
              {children(group, isOpen)}
            </LibraryGroupFolder>
          )
        })}
      </div>
    )
  }

  function renderGroupedGrid() {
    if (scopeMode !== "all") {
      return renderGroupFolders((group) => (
        <SongGridCards
          songs={group.songs}
          currentSongId={currentSongId}
          onPlay={handlePlaySong}
          onPlayNext={handlePlayNext}
          onAddToQueue={handleAddToQueue}
        />
      ))
    }

    return (
      <div className="space-y-5">
        {groupedVisibleSongs.map((group) => (
          <section key={group.key} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 sm:p-4">
            {scopeMode !== "all" && (
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold tracking-wide text-zinc-100">{group.label}</h3>
                <span className="text-xs text-zinc-400 tabular-nums">{group.songs.length} tracks</span>
              </div>
            )}
            <SongGridCards
              songs={group.songs}
              currentSongId={currentSongId}
              onPlay={handlePlaySong}
              onPlayNext={handlePlayNext}
              onAddToQueue={handleAddToQueue}
            />
          </section>
        ))}
      </div>
    )
  }

  return (
    <div className="relative h-full flex flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,#1d2a4a_0%,#111623_35%,#080a10_72%)] text-zinc-100">
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <div className="absolute -top-28 left-[8%] h-72 w-72 rounded-full bg-sky-400/20 blur-3xl" />
        <div className="absolute top-[30%] -right-16 h-64 w-64 rounded-full bg-emerald-400/15 blur-3xl" />
      </div>
      {/* ── Header ── */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0a0f1a]/75 backdrop-blur-2xl">
        <div className="w-full px-4 sm:px-6">
          {/* Top row: brand + tabs + actions */}
          <div className="flex h-12 items-center gap-3 md:h-14 lg:h-16">
            {/* Brand */}
            <Image
              src="/EchoDeck.png"
              alt="EchoDeck"
              width={542}
              height={391}
              priority
              className="h-6 w-auto select-none shrink-0 md:h-7 lg:h-8"
            />

            {/* Tabs */}
            <nav className="flex items-center gap-0.5 rounded-xl border border-white/10 bg-white/5 p-0.5 md:p-1 lg:p-1.5">
              <button
                type="button"
                onClick={() => setActiveTab("player")}
                className={`rounded-md px-3.5 py-1.5 text-xs font-medium transition-all md:px-4 md:py-2 md:text-sm lg:px-5 lg:py-2.5 lg:text-base ${
                  activeTab === "player"
                    ? "bg-gradient-to-r from-sky-300 to-emerald-300 text-slate-900 shadow-sm"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                Library
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("download")}
                className={`rounded-md px-3.5 py-1.5 text-xs font-medium transition-all md:px-4 md:py-2 md:text-sm lg:px-5 lg:py-2.5 lg:text-base ${
                  activeTab === "download"
                    ? "bg-gradient-to-r from-sky-300 to-emerald-300 text-slate-900 shadow-sm"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                Download
              </button>
            </nav>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Song count */}
            <span className="hidden sm:inline text-xs text-zinc-400 tabular-nums md:text-sm lg:text-base">
              {songs.length} {songs.length === 1 ? "track" : "tracks"}
            </span>

            <button
              type="button"
              onClick={() => setActiveTab("manage")}
              className="hidden sm:inline-flex h-8 items-center rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-zinc-200 hover:bg-white/10 md:text-sm"
            >
              Manage
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("repair")}
              className="hidden sm:inline-flex h-8 items-center rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-zinc-200 hover:bg-white/10 md:text-sm"
            >
              Repair
            </button>

            {/* Logout */}
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100"
              aria-label="Logout"
              title="Logout"
            >
              <LogoutIcon />
            </button>
          </div>

          {/* Toolbar row (library tab only) */}
          {activeTab === "player" && (
            <LibraryToolbar
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onClearSearch={() => setSearchQuery("")}
              scopeMode={scopeMode}
              onScopeModeChange={setScopeMode}
              selectedPlaylist={selectedPlaylist}
              onSelectedPlaylistChange={setSelectedPlaylist}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              songsCount={songs.length}
              unassignedCount={unassignedCount}
              playlists={playlists}
            />
          )}
        </div>
      </header>

      {/* ── Main ── */}
      <main className="custom-scrollbar relative z-10 flex-1 overflow-y-auto w-full px-4 pt-4 sm:px-6 pb-32 sm:pb-28">
        {activeTab === "download" && (
          <DownloadForm
            onDownloadStart={() => {}}
            onDownloadComplete={() => {
              fetchSongs()
              fetchPlaylists()
              fetchLibraries()
            }}
          />
        )}

        {activeTab === "manage" && <LibraryManagementPanel embedded />}

        {activeTab === "repair" && <MaintenancePanel embedded />}

        {activeTab === "player" && (
          <div className="animate-[app-fade-in_450ms_ease-out]">
            <section className="mb-4 hidden grid-cols-1 gap-3 md:grid md:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-400">Library</p>
                <p className="mt-1 text-xl font-semibold text-white tabular-nums">{songs.length}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-400">Visible</p>
                <p className="mt-1 text-xl font-semibold text-white tabular-nums">{visibleSongs.length}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-zinc-400">Queue</p>
                <p className="mt-1 text-xl font-semibold text-white tabular-nums">{queueSongs.length}</p>
              </div>
            </section>
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
              </div>
            ) : songs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-900 text-3xl text-zinc-600">
                  ♪
                </div>
                <p className="text-sm font-medium text-zinc-300">No tracks yet</p>
                <p className="mt-1 text-xs text-zinc-600">
                  Switch to the Download tab to add music.
                </p>
              </div>
            ) : visibleSongs.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-800/60 bg-zinc-900/40 py-16 text-center">
                <p className="text-sm font-medium text-zinc-300">No matches</p>
                <p className="mt-1 text-xs text-zinc-500">
                  {searchQuery.trim()
                    ? "Try a different search term."
                    : scopeMode === "libraries"
                      ? "Try a different scope."
                      : "Try a different playlist filter."}
                </p>
              </div>
            ) : (
              <>
                {viewMode === "grid" ? (
                  renderGroupedGrid()
                ) : scopeMode === "all" ? (
                  <SongList
                    songs={visibleSongs}
                    playlists={playlists}
                    currentSongId={currentSongId}
                    onPlay={handlePlaySong}
                    onAddToQueue={handleAddToQueue}
                    onPlayNext={handlePlayNext}
                    onDelete={handleDelete}
                    onDeleteMany={handleDeleteMany}
                    onAssignPlaylist={handleAssignPlaylist}
                    onAssignPlaylistMany={handleAssignPlaylistMany}
                    onCreatePlaylist={createPlaylist}
                  />
                ) : (
                  renderGroupFolders((group) => (
                    <SongList
                      songs={group.songs}
                      playlists={playlists}
                      currentSongId={currentSongId}
                      onPlay={handlePlaySong}
                      onAddToQueue={handleAddToQueue}
                      onPlayNext={handlePlayNext}
                      onDelete={handleDelete}
                      onDeleteMany={handleDeleteMany}
                      onAssignPlaylist={handleAssignPlaylist}
                      onAssignPlaylistMany={handleAssignPlaylistMany}
                      onCreatePlaylist={createPlaylist}
                    />
                  ))
                )}
              </>
            )}
          </div>
        )}
      </main>

      <Player
        song={currentSong}
        songs={queueSongs}
        onSongChange={(song) => setCurrentSongId(song.id)}
        onQueueReorder={handleQueueReorder}
        onQueueRemove={handleQueueRemove}
        onQueueClear={() => {
          setQueueIds([])
          setCurrentSongId(null)
        }}
        onPlaybackStateChange={(nextState) => {
          const prev = playbackStateRef.current
          const prevBucket = Math.floor(Math.max(0, prev.positionSec) / 5)
          const nextBucket = Math.floor(Math.max(0, nextState.positionSec) / 5)
          const shouldSync =
            prev.isPlaying !== nextState.isPlaying ||
            prev.repeatMode !== nextState.repeatMode ||
            prev.shuffle !== nextState.shuffle ||
            prevBucket !== nextBucket

          playbackStateRef.current = nextState
          if (shouldSync) {
            schedulePlaybackSessionSync()
          }
        }}
      />
    </div>
  )
}
