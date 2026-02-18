"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { useRouter } from "next/navigation"
import Player from "./components/Player"
import HomeHeader from "./components/home/HomeHeader"
import HomeTabPanels from "./components/home/HomeTabPanels"
import {
  type HomeTab,
  type LibrarySummary,
  type Playlist,
  type RepeatMode,
  type ScopeMode,
  type Song,
  type SongTag,
  type ViewMode,
} from "./components/home/types"
import { normalizeSongTitle } from "../lib/songTitle"
import { removeQueueItem, reorderQueue } from "../lib/playbackQueue"
import { groupSongsByScope } from "../lib/songGrouping"
import pkg from "../package.json"

const QUEUE_STORAGE_KEY = "echodeck.queue.ids"
const DEVICE_ID_STORAGE_KEY = "echodeck.device.id"
const GRID_CARD_SCALE_STORAGE_KEY = "echodeck.grid.card.scale"

export default function Home() {
  const router = useRouter()
  const [songs, setSongs] = useState<Song[]>([])
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [tags, setTags] = useState<SongTag[]>([])
  const [libraries, setLibraries] = useState<LibrarySummary[]>([])
  const [currentSongId, setCurrentSongId] = useState<number | null>(null)
  const [queueIds, setQueueIds] = useState<number[]>([])
  const [activeTab, setActiveTab] = useState<HomeTab>("player")
  const appVersion = pkg.version || "dev"
  const [scopeMode, setScopeMode] = useState<ScopeMode>("all")
  const [viewMode, setViewMode] = useState<ViewMode>("grid")
  const [gridCardScale, setGridCardScale] = useState(100)
  const [expandedGroupKey, setExpandedGroupKey] = useState<string | null>(null)
  const [selectedPlaylist, setSelectedPlaylist] = useState<string>("all")
  const [selectedTag, setSelectedTag] = useState<string>("all")
  const [tagFilteredSongIds, setTagFilteredSongIds] = useState<Set<number> | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [searchResults, setSearchResults] = useState<Song[] | null>(null)
  const searchAbortRef = useRef<AbortController | null>(null)
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
    try {
      const raw = localStorage.getItem(GRID_CARD_SCALE_STORAGE_KEY)
      const parsed = Number.parseInt(raw || "", 10)
      if (Number.isInteger(parsed)) {
        setGridCardScale(Math.max(80, Math.min(190, parsed)))
      }
    } catch {
      // ignore storage access failures
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(GRID_CARD_SCALE_STORAGE_KEY, String(gridCardScale))
    } catch {
      // ignore storage access failures
    }
  }, [gridCardScale])

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
    setSearchResults(null)
  }, [activeTab])

  // Debounced server-side search
  useEffect(() => {
    const trimmed = searchQuery.trim()

    // Clear results immediately when search is emptied
    if (!trimmed) {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current)
        searchDebounceRef.current = null
      }
      if (searchAbortRef.current) {
        searchAbortRef.current.abort()
        searchAbortRef.current = null
      }
      setSearchResults(null)
      return
    }

    // Debounce the API call
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current)
    }

    searchDebounceRef.current = setTimeout(() => {
      searchDebounceRef.current = null

      // Abort any in-flight search
      if (searchAbortRef.current) {
        searchAbortRef.current.abort()
      }
      const controller = new AbortController()
      searchAbortRef.current = controller

      const params = new URLSearchParams({
        search: trimmed,
        limit: "1000",
      })

      // Pass scope filters so server results respect current view
      if (scopeMode !== "libraries" && selectedPlaylist !== "all") {
        params.set("playlistId", selectedPlaylist)
      }
      if (selectedTag !== "all") {
        params.set("tagId", selectedTag)
      }

      fetch(`/api/songs?${params.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then((res) => {
          if (!res.ok) throw new Error(`Search failed with HTTP ${res.status}`)
          return res.json() as Promise<{ songs?: Song[] } | Song[]>
        })
        .then((payload) => {
          const results = Array.isArray(payload)
            ? payload
            : Array.isArray(payload.songs)
              ? payload.songs
              : []
          setSearchResults(
            results.map((song) => ({
              ...song,
              title: normalizeSongTitle(song.title || "Unknown title"),
            }))
          )
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") return
          console.error("Search failed:", err)
        })
    }, 300)

    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current)
        searchDebounceRef.current = null
      }
    }
  }, [searchQuery, scopeMode, selectedPlaylist, selectedTag])

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

      const allSongs = [...firstSongs]
      const totalPages =
        Array.isArray(firstPayload) || typeof firstPayload.totalPages !== "number" || firstPayload.totalPages < 2
          ? 1
          : firstPayload.totalPages

      if (totalPages > 1) {
        const remainingPages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2)
        const concurrency = 6
        for (let i = 0; i < remainingPages.length; i += concurrency) {
          const batch = remainingPages.slice(i, i + concurrency)
          const pages = await Promise.all(
            batch.map(async (page) => {
              const res = await fetch(`/api/songs?page=${page}&limit=${pageSize}`, { cache: "no-store" })
              if (!res.ok) {
                throw new Error(`Song fetch failed with HTTP ${res.status}`)
              }
              const payload = await res.json() as { songs?: Song[] } | Song[]
              return Array.isArray(payload) ? payload : (Array.isArray(payload.songs) ? payload.songs : [])
            })
          )
          for (const songsPage of pages) {
            allSongs.push(...songsPage)
          }
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

  const fetchTags = useCallback(async () => {
    try {
      const res = await fetch("/api/song-tags", { cache: "no-store" })
      if (!res.ok) return
      const data = await res.json() as SongTag[]
      if (!Array.isArray(data)) return
      setTags(
        data
          .filter((tag): tag is SongTag => Number.isInteger(tag.id) && typeof tag.name === "string")
          .sort((a, b) => a.name.localeCompare(b.name))
      )
    } catch (err) {
      console.error("Failed to fetch song tags:", err)
    }
  }, [])

  useEffect(() => {
    fetchSongs()
    fetchPlaylists()
    fetchLibraries()
    fetchTags()
  }, [fetchSongs, fetchPlaylists, fetchLibraries, fetchTags])

  useEffect(() => {
    let cancelled = false

    async function hydrateTagFilter() {
      if (selectedTag === "all") {
        setTagFilteredSongIds(null)
        return
      }

      try {
        const limit = 1000
        let page = 1
        let totalPages = 1
        const ids = new Set<number>()

        while (page <= totalPages) {
          const res = await fetch(`/api/song-tags/${selectedTag}/songs?page=${page}&limit=${limit}`, { cache: "no-store" })
          if (!res.ok) break
          const payload = await res.json() as { songs?: Array<{ id: number }>; totalPages?: number }
          const rows = Array.isArray(payload.songs) ? payload.songs : []
          for (const row of rows) {
            if (Number.isInteger(row.id)) ids.add(row.id)
          }
          totalPages = typeof payload.totalPages === "number" && payload.totalPages > 0 ? payload.totalPages : 1
          page += 1
        }

        if (!cancelled) {
          setTagFilteredSongIds(ids)
        }
      } catch (error) {
        console.error("Failed to hydrate tag filter songs:", error)
        if (!cancelled) setTagFilteredSongIds(new Set())
      }
    }

    void hydrateTagFilter()
    return () => {
      cancelled = true
    }
  }, [selectedTag])

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
      sessionSyncTimeoutRef.current = null
      void syncPlaybackSession()
    }
  }, [syncPlaybackSession])

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
    const byPlaylist = scopeMode === "libraries" ? songs : songs.filter((song) => {
      if (selectedPlaylist === "all") return true
      if (selectedPlaylist === "none") return song.playlistId === null
      const selectedId = Number.parseInt(selectedPlaylist, 10)
      return song.playlistId === selectedId
    })

    if (!tagFilteredSongIds) return byPlaylist
    return byPlaylist.filter((song) => tagFilteredSongIds.has(song.id))
  }, [songs, selectedPlaylist, scopeMode, tagFilteredSongIds])

  const visibleSongs = useMemo(() => {
    if (searchResults !== null) return searchResults
    return scopedSongs
  }, [scopedSongs, searchResults])

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

  return (
    <div className="relative h-full flex flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,#1d2a4a_0%,#111623_35%,#080a10_72%)] text-zinc-100">
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <div className="absolute -top-28 left-[8%] h-72 w-72 rounded-full bg-sky-400/20 blur-3xl" />
        <div className="absolute top-[30%] -right-16 h-64 w-64 rounded-full bg-emerald-400/15 blur-3xl" />
      </div>
      <HomeHeader
        activeTab={activeTab}
        onActiveTabChange={setActiveTab}
        songsCount={songs.length}
        appVersion={appVersion}
        onLogout={handleLogout}
        toolbarProps={{
          searchQuery,
          onSearchChange: setSearchQuery,
          onClearSearch: () => setSearchQuery(""),
          scopeMode,
          onScopeModeChange: setScopeMode,
          selectedPlaylist,
          onSelectedPlaylistChange: setSelectedPlaylist,
          selectedTag,
          onSelectedTagChange: setSelectedTag,
          viewMode,
          onViewModeChange: setViewMode,
          cardScale: gridCardScale,
          onCardScaleChange: setGridCardScale,
          songsCount: songs.length,
          unassignedCount,
          playlists,
          tags,
        }}
      />

      {/* ── Main ── */}
      <main className="custom-scrollbar relative z-10 flex-1 overflow-y-auto w-full px-2.5 pt-2 sm:px-6 sm:pt-4 pb-32 sm:pb-28">
        <HomeTabPanels
          activeTab={activeTab}
          songs={songs}
          playlists={playlists}
          selectedPlaylist={selectedPlaylist}
          loading={loading}
          searchQuery={searchQuery}
          scopeMode={scopeMode}
          viewMode={viewMode}
          groupedVisibleSongs={groupedVisibleSongs}
          expandedGroupKey={expandedGroupKey}
          currentSongId={currentSongId}
          queueSongs={queueSongs}
          visibleSongs={visibleSongs}
          cardScale={gridCardScale}
          onExpandedGroupKeyChange={setExpandedGroupKey}
          onPlay={handlePlaySong}
          onAddToQueue={handleAddToQueue}
          onPlayNext={handlePlayNext}
          onDelete={handleDelete}
          onDeleteMany={handleDeleteMany}
          onAssignPlaylist={handleAssignPlaylist}
          onAssignPlaylistMany={handleAssignPlaylistMany}
          onCreatePlaylist={createPlaylist}
          onRefreshSongs={fetchSongs}
          onRefreshPlaylists={fetchPlaylists}
          onRefreshLibraries={fetchLibraries}
        />
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
