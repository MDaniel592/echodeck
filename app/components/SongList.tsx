"use client"

import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import { createPortal } from "react-dom"

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
}

interface SongListProps {
  songs: Song[]
  playlists: Playlist[]
  currentSongId: number | null
  onPlay: (song: Song) => void
  onAddToQueue: (song: Song) => void
  onPlayNext: (song: Song) => void
  onDelete: (id: number) => void
  onDeleteMany?: (ids: number[]) => Promise<void> | void
  onAssignPlaylist: (songId: number, playlistId: number | null) => Promise<void> | void
  onAssignPlaylistMany?: (songIds: number[], playlistId: number | null) => Promise<void> | void
  onCreatePlaylist: (name: string) => Promise<Playlist>
}

function PlayNextIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[15px] w-[15px]"
      aria-hidden="true"
    >
      <path d="M5 5v14" />
      <path d="M9 5l9 7-9 7V5z" />
      <path d="M19 5v14" />
    </svg>
  )
}

function AddToQueueIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[15px] w-[15px]"
      aria-hidden="true"
    >
      <path d="M4 7h11" />
      <path d="M4 12h11" />
      <path d="M4 17h8" />
      <path d="M18 11v8" />
      <path d="M14 15h8" />
    </svg>
  )
}

function DeleteIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[15px] w-[15px]"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M5 6l1 14h12l1-14" />
    </svg>
  )
}

function PlaylistIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[15px] w-[15px]"
      aria-hidden="true"
    >
      <path d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[15px] w-[15px]"
      aria-hidden="true"
    >
      <path d="M12 5v10" />
      <path d="M7 12l5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  )
}

function MoreIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-[15px] w-[15px]"
      aria-hidden="true"
    >
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="19" r="1.5" />
    </svg>
  )
}

function SongMenu({
  song,
  playlists,
  assignedPlaylist,
  onPlayNext,
  onAddToQueue,
  onDelete,
  onAssignPlaylist,
  onCreatePlaylist,
}: {
  song: Song
  playlists: Playlist[]
  assignedPlaylist: Playlist | null
  onPlayNext: (song: Song) => void
  onAddToQueue: (song: Song) => void
  onDelete: (id: number) => void
  onAssignPlaylist: (songId: number, playlistId: number | null) => Promise<void> | void
  onCreatePlaylist: (name: string) => Promise<Playlist>
}) {
  const [open, setOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [menuView, setMenuView] = useState<"main" | "playlist">("main")
  const [newPlaylistName, setNewPlaylistName] = useState("")
  const [playlistError, setPlaylistError] = useState("")
  const [creatingPlaylist, setCreatingPlaylist] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  function resetMenus() {
    setMenuView("main")
    setNewPlaylistName("")
    setPlaylistError("")
    setCreatingPlaylist(false)
  }

  function closeEverything() {
    setOpen(false)
    setConfirmDelete(false)
    resetMenus()
  }

  const updatePosition = useCallback(() => {
    if (!buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    const menuHeight = menuView === "playlist" ? 330 : 220 // approximate menu heights
    const spaceBelow = window.innerHeight - rect.bottom
    const openUpward = spaceBelow < menuHeight && rect.top > menuHeight

    setMenuPos({
      top: openUpward ? rect.top - menuHeight : rect.bottom + 4,
      left: rect.right - (menuView === "playlist" ? 288 : 180),
    })
  }, [menuView])

  useEffect(() => {
    if (!open) return
    updatePosition()
    function handleClick(e: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
        setConfirmDelete(false)
        setMenuView("main")
        setNewPlaylistName("")
        setPlaylistError("")
        setCreatingPlaylist(false)
      }
    }
    function handleScroll() {
      setOpen(false)
      setConfirmDelete(false)
      setMenuView("main")
      setNewPlaylistName("")
      setPlaylistError("")
      setCreatingPlaylist(false)
    }
    document.addEventListener("mousedown", handleClick)
    window.addEventListener("scroll", handleScroll, true)
    return () => {
      document.removeEventListener("mousedown", handleClick)
      window.removeEventListener("scroll", handleScroll, true)
    }
  }, [open, updatePosition])

  const playlistLabel = assignedPlaylist
    ? `Playlist: ${assignedPlaylist.name}`
    : "Assign to playlist"

  const items: {
    icon: React.ReactNode
    label: string
    onClick: () => void
    className: string
    disabled?: boolean
  }[] = [
    {
      icon: <PlaylistIcon />,
      label: playlistLabel,
      className: assignedPlaylist
        ? "text-blue-400 hover:bg-blue-500/10"
        : "text-zinc-300 hover:bg-zinc-700/50",
      onClick: () => {
        setPlaylistError("")
        setMenuView("playlist")
      },
    },
    {
      icon: <PlayNextIcon />,
      label: "Play next",
      className: "text-zinc-300 hover:bg-zinc-700/50",
      onClick: () => {
        onPlayNext(song)
        closeEverything()
      },
    },
    {
      icon: <AddToQueueIcon />,
      label: "Add to queue",
      className: "text-zinc-300 hover:bg-zinc-700/50",
      onClick: () => {
        onAddToQueue(song)
        closeEverything()
      },
    },
    {
      icon: <DownloadIcon />,
      label: "Download",
      className: "text-zinc-300 hover:bg-zinc-700/50",
      onClick: () => {
        const a = document.createElement("a")
        a.href = `/api/stream/${song.id}`
        a.download = `${song.title}.${song.format}`
        a.click()
        closeEverything()
      },
    },
  ]

  async function handleCreatePlaylist(e: React.FormEvent) {
    e.preventDefault()
    if (creatingPlaylist) return
    const name = newPlaylistName.trim()
    if (!name) return

    setCreatingPlaylist(true)
    setPlaylistError("")
    try {
      const playlist = await onCreatePlaylist(name)
      await onAssignPlaylist(song.id, playlist.id)
      closeEverything()
    } catch (err) {
      setPlaylistError(err instanceof Error ? err.message : "Failed to create playlist")
    } finally {
      setCreatingPlaylist(false)
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => {
            const nextOpen = !v
            if (!nextOpen) {
              setConfirmDelete(false)
              resetMenus()
            }
            return nextOpen
          })
        }}
        className="h-7 w-7 inline-flex items-center justify-center rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700/50 transition-colors"
        aria-label="More options"
        title="More options"
      >
        <MoreIcon />
      </button>
      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          className={`fixed z-[9999] rounded-lg border border-zinc-700/80 bg-zinc-900 shadow-xl shadow-black/40 ${menuView === "playlist" ? "w-72 py-2" : "min-w-[180px] py-1"}`}
          style={{ top: menuPos.top, left: menuPos.left }}
          onClick={(e) => e.stopPropagation()}
        >
          {menuView === "main" ? (
            <>
              {items.map((item, i) => (
                <button
                  key={i}
                  onClick={item.onClick}
                  disabled={item.disabled}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${item.className} disabled:opacity-30 disabled:cursor-not-allowed`}
                >
                  <span className="shrink-0">{item.icon}</span>
                  <span className="truncate">{item.label}</span>
                </button>
              ))}
              <button
                onClick={() => {
                  setOpen(false)
                  setConfirmDelete(true)
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors text-red-400 hover:bg-red-500/10"
              >
                <span className="shrink-0">
                  <DeleteIcon />
                </span>
                <span className="truncate">Delete</span>
              </button>
            </>
          ) : (
            <div className="px-3">
              <div className="mb-2 flex items-center justify-between">
                <button
                  onClick={() => setMenuView("main")}
                  className="px-2 py-1 text-xs rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                >
                  Back
                </button>
                <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  Assign Playlist
                </span>
                <span className="w-8" aria-hidden="true" />
              </div>

              <div className="custom-scrollbar mb-3 max-h-44 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950/40">
                <button
                  onClick={async () => {
                    await onAssignPlaylist(song.id, null)
                    closeEverything()
                  }}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left transition-colors ${
                    song.playlistId === null
                      ? "text-blue-400 bg-blue-500/10"
                      : "text-zinc-300 hover:bg-zinc-800/70"
                  }`}
                >
                  <span className="truncate">No playlist</span>
                  {song.playlistId === null && (
                    <span className="text-[10px] uppercase tracking-wide text-blue-300">Current</span>
                  )}
                </button>
                {playlists.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-zinc-500">No playlists yet. Create one below.</p>
                ) : (
                  playlists.map((playlist) => {
                    const isCurrent = playlist.id === song.playlistId
                    return (
                      <button
                        key={playlist.id}
                        onClick={async () => {
                          await onAssignPlaylist(song.id, playlist.id)
                          closeEverything()
                        }}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left transition-colors ${
                          isCurrent
                            ? "text-blue-400 bg-blue-500/10"
                            : "text-zinc-300 hover:bg-zinc-800/70"
                        }`}
                      >
                        <span className="truncate">{playlist.name}</span>
                        {isCurrent && (
                          <span className="text-[10px] uppercase tracking-wide text-blue-300">Current</span>
                        )}
                      </button>
                    )
                  })
                )}
              </div>

              <form onSubmit={handleCreatePlaylist} className="space-y-1">
                <label className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  Create New Playlist
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newPlaylistName}
                    onChange={(e) => {
                      setNewPlaylistName(e.target.value)
                      if (playlistError) {
                        setPlaylistError("")
                      }
                    }}
                    placeholder="Playlist name"
                    maxLength={80}
                    className="h-8 min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-800/80 px-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                  />
                  <button
                    type="submit"
                    disabled={creatingPlaylist || !newPlaylistName.trim()}
                    className="h-8 shrink-0 px-3 rounded-md text-xs font-medium bg-blue-500/20 border border-blue-500/40 text-blue-300 hover:bg-blue-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {creatingPlaylist ? "Creating..." : "Create"}
                  </button>
                </div>
                {playlistError && (
                  <p className="px-1 text-[11px] text-red-400">{playlistError}</p>
                )}
              </form>
            </div>
          )}
        </div>,
        document.body
      )}
      {confirmDelete && createPortal(
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 px-4"
          onClick={() => setConfirmDelete(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-zinc-700/80 bg-zinc-900 shadow-2xl shadow-black/50 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-medium text-zinc-100 truncate" title={song.title}>
              Delete &quot;{song.title}&quot;?
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              This removes it from your library and deletes the file.
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-2.5 py-1.5 text-xs rounded-md border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onDelete(song.id)
                  closeEverything()
                }}
                className="px-2.5 py-1.5 text-xs rounded-md bg-red-500/20 text-red-300 border border-red-500/40 hover:bg-red-500/30 transition-colors"
              >
                Delete file
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "--:--"
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

function formatSize(bytes: number | null): string {
  if (!bytes) return ""
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getSourceBadge(source: string): { label: string; className: string } {
  if (source === "youtube") {
    return { label: "YT", className: "bg-red-500/10 text-red-400/80 ring-1 ring-red-500/20" }
  }

  if (source === "spotify") {
    return { label: "Spotify", className: "bg-green-500/10 text-green-400/80 ring-1 ring-green-500/20" }
  }

  if (source === "soundcloud") {
    return { label: "SC", className: "bg-orange-500/10 text-orange-300/80 ring-1 ring-orange-500/20" }
  }

  return { label: "Other", className: "bg-zinc-800 text-zinc-400 ring-1 ring-zinc-700" }
}

export default function SongList({
  songs,
  playlists,
  currentSongId,
  onPlay,
  onAddToQueue,
  onPlayNext,
  onDelete,
  onDeleteMany,
  onAssignPlaylist,
  onAssignPlaylistMany,
  onCreatePlaylist,
}: SongListProps) {
  const LONG_PRESS_MS = 420
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedSongIds, setSelectedSongIds] = useState<Set<number>>(new Set())
  const [bulkPlaylistChoice, setBulkPlaylistChoice] = useState("")
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkError, setBulkError] = useState("")
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const longPressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressTriggeredRef = useRef(false)
  const longPressSongIdRef = useRef<number | null>(null)

  useEffect(() => {
    const visibleIds = new Set(songs.map((song) => song.id))
    setSelectedSongIds((prev) => {
      let changed = false
      const next = new Set<number>()
      for (const id of prev) {
        if (visibleIds.has(id)) {
          next.add(id)
        } else {
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [songs])

  useEffect(() => {
    if (selectedSongIds.size > 0) return
    setConfirmBulkDelete(false)
  }, [selectedSongIds.size])

  function clearLongPressTimer() {
    if (!longPressTimeoutRef.current) return
    clearTimeout(longPressTimeoutRef.current)
    longPressTimeoutRef.current = null
  }

  useEffect(() => {
    return () => {
      clearLongPressTimer()
    }
  }, [])

  function startLongPress(songId: number, e: React.PointerEvent<HTMLDivElement>) {
    if (selectionMode || bulkBusy) return
    if (e.pointerType === "mouse" && e.button !== 0) return

    longPressTriggeredRef.current = false
    longPressSongIdRef.current = songId
    clearLongPressTimer()

    longPressTimeoutRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true
      setSelectionMode(true)
      setBulkError("")
      setSelectedSongIds(new Set([songId]))
      longPressTimeoutRef.current = null
    }, LONG_PRESS_MS)
  }

  function cancelLongPress() {
    clearLongPressTimer()
  }

  function toggleSongSelection(songId: number) {
    setSelectedSongIds((prev) => {
      const next = new Set(prev)
      if (next.has(songId)) {
        next.delete(songId)
      } else {
        next.add(songId)
      }
      return next
    })
  }

  function resetSelectionState() {
    setSelectedSongIds(new Set())
    setBulkPlaylistChoice("")
    setBulkError("")
    setConfirmBulkDelete(false)
  }

  const selectedCount = selectedSongIds.size
  const playlistById = useMemo(
    () => new Map(playlists.map((playlist) => [playlist.id, playlist])),
    [playlists]
  )
  const allVisibleSelected =
    songs.length > 0 &&
    songs.every((song) => selectedSongIds.has(song.id))

  const selectedIds = Array.from(selectedSongIds)

  function renderSelectionToolbar() {
    return (
      <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/85 px-3 py-1.5 backdrop-blur">
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setSelectedSongIds(allVisibleSelected ? new Set() : new Set(songs.map((song) => song.id)))
              setBulkError("")
            }}
            className="h-7 whitespace-nowrap rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 text-xs text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800/80"
          >
            {allVisibleSelected ? "Clear all" : "Select all"}
          </button>
          <select
            value={bulkPlaylistChoice}
            onChange={(e) => setBulkPlaylistChoice(e.target.value)}
            className="h-7 min-w-0 w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-2.5 text-xs text-zinc-300 focus:border-zinc-600 focus:outline-none"
            disabled={bulkBusy}
          >
            <option value="">Assign playlist...</option>
            <option value="__none__">No playlist</option>
            {playlists.map((playlist) => (
              <option key={playlist.id} value={playlist.id}>
                {playlist.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleApplyBulkPlaylist}
            disabled={bulkBusy || selectedCount === 0 || bulkPlaylistChoice === ""}
            className="h-7 whitespace-nowrap rounded-lg border border-blue-500/40 bg-blue-500/20 px-3 text-xs font-medium text-blue-200 transition-colors hover:bg-blue-500/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {bulkBusy ? "Applying..." : "Apply"}
          </button>
        </div>
        <div className="mt-1.5 grid grid-cols-3 items-center gap-2">
          <button
            type="button"
            onClick={() => setConfirmBulkDelete(true)}
            disabled={bulkBusy || selectedCount === 0}
            className="h-7 w-full whitespace-nowrap rounded-lg border border-red-500/40 bg-red-500/20 px-3 text-xs font-medium text-red-200 transition-colors hover:bg-red-500/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Delete selected
          </button>
          <span className="text-center text-xs font-medium text-zinc-200 tabular-nums">
            {selectedCount} selected
          </span>
          <button
            type="button"
            onClick={() => {
              setSelectionMode(false)
              resetSelectionState()
            }}
            className="h-7 w-full whitespace-nowrap rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 text-xs text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800/80"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  async function runBulkDelete(ids: number[]) {
    if (ids.length === 0) return

    if (onDeleteMany) {
      await onDeleteMany(ids)
      return
    }

    for (const id of ids) {
      await Promise.resolve(onDelete(id))
    }
  }

  async function runBulkAssign(songIds: number[], playlistId: number | null) {
    if (songIds.length === 0) return

    if (onAssignPlaylistMany) {
      await onAssignPlaylistMany(songIds, playlistId)
      return
    }

    for (const id of songIds) {
      await Promise.resolve(onAssignPlaylist(id, playlistId))
    }
  }

  async function handleApplyBulkPlaylist() {
    if (bulkBusy || selectedCount === 0 || bulkPlaylistChoice === "") return

    const playlistId =
      bulkPlaylistChoice === "__none__"
        ? null
        : Number.parseInt(bulkPlaylistChoice, 10)

    if (playlistId !== null && !Number.isInteger(playlistId)) {
      setBulkError("Choose a valid playlist.")
      return
    }

    setBulkBusy(true)
    setBulkError("")
    try {
      await runBulkAssign(selectedIds, playlistId)
      setSelectedSongIds(new Set())
      setBulkPlaylistChoice("")
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : "Failed to assign playlist")
    } finally {
      setBulkBusy(false)
    }
  }

  async function handleConfirmBulkDelete() {
    if (bulkBusy || selectedCount === 0) return

    setBulkBusy(true)
    setBulkError("")
    try {
      await runBulkDelete(selectedIds)
      resetSelectionState()
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : "Failed to delete selected songs")
    } finally {
      setBulkBusy(false)
    }
  }

  if (songs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-900 text-3xl text-zinc-600">
          ♪
        </div>
        <p className="text-sm font-medium text-zinc-300">No songs yet</p>
        <p className="mt-1 text-xs text-zinc-600">Download some music to get started</p>
      </div>
    )
  }

  return (
    <>
      {selectionMode && createPortal(
        <div
          className="fixed inset-x-0 top-0 z-50 px-4 sm:px-6"
          style={{ paddingTop: "max(env(safe-area-inset-top), 0.5rem)" }}
        >
          <div className="mx-auto max-w-5xl">
            {renderSelectionToolbar()}
          </div>
        </div>,
        document.body
      )}

      <div className="space-y-2">
        {bulkError && (
          <p className="px-1 text-xs text-red-400">{bulkError}</p>
        )}

        <div className="space-y-px rounded-xl border border-zinc-800/60 overflow-hidden">
          {songs.map((song, index) => {
            const isPlaying = currentSongId === song.id
            const isSelected = selectedSongIds.has(song.id)
            const sourceBadge = getSourceBadge(song.source)
            const coverSrc = song.coverPath ? `/api/cover/${song.id}` : song.thumbnail
            const assignedPlaylist =
              song.playlistId === null
                ? null
                : playlistById.get(song.playlistId) ?? null

            return (
              <div
                key={song.id}
                className={`flex items-center gap-3 px-3 py-2.5 transition-colors cursor-pointer group lg:gap-3.5 lg:px-4 lg:py-3 ${
                  isPlaying
                    ? "bg-blue-500/10"
                    : "hover:bg-zinc-800/50"
                } ${!isPlaying && index % 2 === 0 ? "bg-zinc-900/30" : "bg-zinc-900/60"}`}
                onPointerDown={(e) => startLongPress(song.id, e)}
                onPointerUp={cancelLongPress}
                onPointerCancel={cancelLongPress}
                onPointerLeave={(e) => {
                  if (e.pointerType === "mouse") {
                    cancelLongPress()
                  }
                }}
                onClick={() => {
                  if (selectionMode) {
                    toggleSongSelection(song.id)
                    return
                  }
                  if (longPressTriggeredRef.current && longPressSongIdRef.current === song.id) {
                    longPressTriggeredRef.current = false
                    longPressSongIdRef.current = null
                    return
                  }
                  onPlay(song)
                }}
              >
                {/* Cover */}
                <div className={`w-10 h-10 rounded-lg overflow-hidden shrink-0 flex items-center justify-center lg:h-11 lg:w-11 ${
                  selectionMode && isSelected
                    ? "bg-zinc-800 ring-2 ring-emerald-400/80"
                    : isPlaying
                    ? "ring-2 ring-blue-500/50 bg-zinc-800"
                    : "bg-zinc-800"
                }`}>
                  {coverSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={coverSrc}
                      alt={`${song.title} cover`}
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-zinc-600 text-xs">♪</span>
                  )}
                </div>

                {/* Song info */}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium truncate md:text-base lg:text-lg ${isPlaying ? "text-blue-400" : "text-zinc-100"}`}>
                    {song.title}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-zinc-500 truncate md:text-sm lg:text-base">
                      {song.artist || "Unknown Artist"}
                    </span>
                    <span className="text-zinc-700 sm:hidden">·</span>
                    <span className="text-[11px] text-zinc-600 sm:hidden">{formatDuration(song.duration)}</span>
                  </div>
                </div>

                {/* Metadata (desktop) */}
                <div className="hidden sm:flex items-center gap-1.5 text-xs shrink-0 md:text-sm lg:text-base">
                  <span className="uppercase font-medium px-1.5 py-0.5 rounded bg-zinc-800/80 text-zinc-400">
                    {song.format}
                  </span>
                  <span className={`px-1.5 py-0.5 rounded ${sourceBadge.className}`}>
                    {sourceBadge.label}
                  </span>
                  {song.quality && <span className="text-zinc-600 px-1">{song.quality}</span>}
                  <span className="text-zinc-600 tabular-nums">{formatDuration(song.duration)}</span>
                  {!!formatSize(song.fileSize) && (
                    <span className="text-zinc-700 tabular-nums">{formatSize(song.fileSize)}</span>
                  )}
                </div>

                {/* Actions */}
                {!selectionMode && (
                  <div className="shrink-0">
                    <SongMenu
                      song={song}
                      playlists={playlists}
                      assignedPlaylist={assignedPlaylist}
                      onPlayNext={onPlayNext}
                      onAddToQueue={onAddToQueue}
                      onDelete={onDelete}
                      onAssignPlaylist={onAssignPlaylist}
                      onCreatePlaylist={onCreatePlaylist}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {confirmBulkDelete && selectedCount > 0 && createPortal(
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 px-4"
          onClick={() => !bulkBusy && setConfirmBulkDelete(false)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-zinc-700/80 bg-zinc-900 shadow-2xl shadow-black/50 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-medium text-zinc-100">
              Delete {selectedCount} {selectedCount === 1 ? "song" : "songs"}?
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              This removes them from your library and deletes their files.
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmBulkDelete(false)}
                disabled={bulkBusy}
                className="px-2.5 py-1.5 text-xs rounded-md border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmBulkDelete}
                disabled={bulkBusy}
                className="px-2.5 py-1.5 text-xs rounded-md bg-red-500/20 text-red-300 border border-red-500/40 hover:bg-red-500/30 transition-colors disabled:opacity-50"
              >
                {bulkBusy ? "Deleting..." : "Delete files"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
