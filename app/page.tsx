"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import Image from "next/image"
import { useRouter } from "next/navigation"
import DownloadForm from "./components/DownloadForm"
import SongList from "./components/SongList"
import Player from "./components/Player"

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
  playlistId: number | null
  createdAt: string
}

interface Playlist {
  id: number
  name: string
  createdAt: string
  _count: { songs: number }
}

const QUEUE_STORAGE_KEY = "echodeck.queue.ids"
const DEVICE_ID_STORAGE_KEY = "echodeck.device.id"

function SearchIcon({ className = "h-4 w-4" }: { className?: string }) {
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
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.4-3.4" />
    </svg>
  )
}

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

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden="true"
    >
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  )
}

export default function Home() {
  const router = useRouter()
  const [songs, setSongs] = useState<Song[]>([])
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [currentSongId, setCurrentSongId] = useState<number | null>(null)
  const [queueIds, setQueueIds] = useState<number[]>([])
  const [activeTab, setActiveTab] = useState<"player" | "download">("player")
  const [selectedPlaylist, setSelectedPlaylist] = useState<string>("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const hydratedPlaybackRef = useRef(false)

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
    if (activeTab === "player") return
    setSearchQuery("")
  }, [activeTab])

  const fetchSongs = useCallback(async () => {
    try {
      const pageSize = 200
      let page = 1
      let totalPages = 1
      const allSongs: Song[] = []
      let fetchedAnyPage = false

      while (page <= totalPages) {
        const res = await fetch(`/api/songs?page=${page}&limit=${pageSize}`, {
          cache: "no-store",
        })
        if (!res.ok) {
          throw new Error(`Song fetch failed with HTTP ${res.status}`)
        }

        const data = await res.json() as { songs?: Song[]; totalPages?: number } | Song[]
        const pageSongs = Array.isArray(data)
          ? data
          : (Array.isArray(data.songs) ? data.songs : [])
        allSongs.push(...pageSongs)
        fetchedAnyPage = true

        if (!Array.isArray(data) && typeof data.totalPages === "number" && data.totalPages > 0) {
          totalPages = data.totalPages
        } else {
          totalPages = page
        }
        page += 1
      }

      if (fetchedAnyPage) {
        setSongs(allSongs)
      }
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

  useEffect(() => {
    fetchSongs()
    fetchPlaylists()
  }, [fetchSongs, fetchPlaylists])

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
          session?: { currentSong?: { id: number } | null } | null
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

  useEffect(() => {
    if (!deviceId || !hydratedPlaybackRef.current) return

    async function syncSession() {
      try {
        await fetch("/api/playback/session", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            deviceId,
            currentSongId,
            positionSec: 0,
            isPlaying: false,
            repeatMode: "off",
            shuffle: false,
          }),
        })
      } catch (error) {
        console.error("Failed to sync playback session:", error)
      }
    }

    void syncSession()
  }, [deviceId, currentSongId])

  async function handleDeleteMany(ids: number[]) {
    const uniqueIds = Array.from(new Set(ids))
    if (uniqueIds.length === 0) return

    try {
      const results = await Promise.all(
        uniqueIds.map(async (id) => {
          const res = await fetch(`/api/songs/${id}`, { method: "DELETE" })
          return { id, ok: res.ok }
        })
      )

      const deletedIds = results.filter((result) => result.ok).map((result) => result.id)
      if (deletedIds.length === 0) {
        throw new Error("Failed to delete selected songs")
      }

      const deletedSet = new Set(deletedIds)

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
      const results = await Promise.all(
        uniqueIds.map(async (songId) => {
          const res = await fetch(`/api/songs/${songId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playlistId }),
          })

          return { songId, ok: res.ok }
        })
      )

      const updatedIds = results.filter((result) => result.ok).map((result) => result.songId)
      if (updatedIds.length === 0) {
        throw new Error("Failed to assign playlist")
      }

      const updatedSet = new Set(updatedIds)
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

  const playlistSongs = useMemo(() => songs.filter((song) => {
    if (selectedPlaylist === "all") return true
    if (selectedPlaylist === "none") return song.playlistId === null
    const selectedId = Number.parseInt(selectedPlaylist, 10)
    return song.playlistId === selectedId
  }), [songs, selectedPlaylist])

  const normalizedSearch = searchQuery.trim().toLowerCase()

  const visibleSongs = useMemo(() => {
    if (!normalizedSearch) return playlistSongs
    return playlistSongs.filter((song) => {
      const haystack = [
        song.title,
        song.artist ?? "",
        song.source,
        song.format,
        song.quality ?? "",
      ]
        .join(" ")
        .toLowerCase()
      return haystack.includes(normalizedSearch)
    })
  }, [playlistSongs, normalizedSearch])

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

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ── Header ── */}
      <header className="sticky top-0 z-40 border-b border-zinc-800/60 bg-black/80 backdrop-blur-2xl">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
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
            <nav className="flex items-center gap-0.5 rounded-lg bg-zinc-900/80 p-0.5 md:p-1 lg:p-1.5">
              <button
                type="button"
                onClick={() => setActiveTab("player")}
                className={`rounded-md px-3.5 py-1.5 text-xs font-medium transition-all md:px-4 md:py-2 md:text-sm lg:px-5 lg:py-2.5 lg:text-base ${
                  activeTab === "player"
                    ? "bg-zinc-100 text-zinc-900 shadow-sm"
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
                    ? "bg-zinc-100 text-zinc-900 shadow-sm"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                Download
              </button>
            </nav>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Song count */}
            <span className="hidden sm:inline text-xs text-zinc-500 tabular-nums md:text-sm lg:text-base">
              {songs.length} {songs.length === 1 ? "track" : "tracks"}
            </span>

            <button
              type="button"
              onClick={() => router.push("/library")}
              className="hidden sm:inline-flex h-8 items-center rounded-lg border border-zinc-800 px-3 text-xs text-zinc-300 hover:bg-zinc-900 md:text-sm"
            >
              Manage
            </button>

            {/* Logout */}
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
              aria-label="Logout"
              title="Logout"
            >
              <LogoutIcon />
            </button>
          </div>

          {/* Toolbar row (library tab only) */}
          {activeTab === "player" && (
            <div className="flex items-center gap-2 pb-2 pt-0 lg:gap-3">
              {/* Search */}
              <div className="relative flex-1 max-w-xs">
                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5 text-zinc-500">
                  <SearchIcon />
                </span>
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search..."
                  className="h-8 w-full rounded-lg border border-zinc-800 bg-zinc-900/80 pl-8 pr-3 text-sm text-white placeholder-zinc-600 transition-colors focus:border-zinc-600 focus:outline-none lg:h-10 lg:text-base"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute inset-y-0 right-0 flex items-center pr-2 text-zinc-500 hover:text-zinc-300"
                    aria-label="Clear search"
                  >
                    <CloseIcon />
                  </button>
                )}
              </div>

              {/* Playlist filter */}
              <select
                value={selectedPlaylist}
                onChange={(e) => setSelectedPlaylist(e.target.value)}
                className="h-8 rounded-lg border border-zinc-800 bg-zinc-900/80 pl-2.5 text-xs text-zinc-300 transition-colors focus:border-zinc-600 focus:outline-none sm:min-w-[10rem] lg:h-10 lg:text-sm"
              >
                <option value="all">All Songs ({songs.length})</option>
                <option value="none">
                  Unassigned ({songs.filter((s) => s.playlistId === null).length})
                </option>
                {playlists.map((playlist) => (
                  <option key={playlist.id} value={playlist.id}>
                    {playlist.name} ({playlist._count.songs})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </header>

      {/* ── Main ── */}
      <main className="custom-scrollbar flex-1 overflow-y-auto mx-auto w-full max-w-5xl px-4 pt-3 sm:px-6 pb-32 sm:pb-28">
        {activeTab === "download" && (
          <DownloadForm
            onDownloadStart={() => {}}
            onDownloadComplete={() => {
              fetchSongs()
              fetchPlaylists()
            }}
          />
        )}

        {activeTab === "player" && (
          <>
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
                    : "Try a different playlist filter."}
                </p>
              </div>
            ) : (
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
            )}
          </>
        )}
      </main>

      <Player
        song={currentSong}
        songs={queueSongs}
        onSongChange={(song) => setCurrentSongId(song.id)}
      />
    </div>
  )
}
