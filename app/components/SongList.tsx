"use client"

import { useState, useRef, useEffect, useMemo } from "react"
import { createPortal } from "react-dom"
import SongMenu from "./songList/SongMenu"
import type { SongListProps } from "./songList/types"
import { formatDuration, formatSize, getSourceBadge } from "./songList/utils"

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
                style={{ contentVisibility: "auto", containIntrinsicSize: "auto 72px" }}
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
