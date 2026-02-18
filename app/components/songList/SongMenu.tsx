"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import type { Playlist, Song } from "./types"

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

interface SongMenuProps {
  song: Song
  playlists: Playlist[]
  assignedPlaylist: Playlist | null
  onPlayNext: (song: Song) => void
  onAddToQueue: (song: Song) => void
  onDelete: (id: number) => void
  onAssignPlaylist: (songId: number, playlistId: number | null) => Promise<void> | void
  onCreatePlaylist: (name: string) => Promise<Playlist>
}

export default function SongMenu({
  song,
  playlists,
  assignedPlaylist,
  onPlayNext,
  onAddToQueue,
  onDelete,
  onAssignPlaylist,
  onCreatePlaylist,
}: SongMenuProps) {
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
    const menuHeight = menuView === "playlist" ? 330 : 220
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
    icon: ReactNode
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
