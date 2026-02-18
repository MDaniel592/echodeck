"use client"

import type { ReactNode } from "react"
import type { SongGroup } from "../../../lib/songGrouping"
import SongList from "../SongList"
import LibraryGroupFolder from "../library/LibraryGroupFolder"
import SongGridCards from "../library/SongGridCards"
import type { Playlist, ScopeMode, Song, ViewMode } from "./types"

interface HomePlayerTabProps {
  songs: Song[]
  visibleSongs: Song[]
  queueSongs: Song[]
  loading: boolean
  searchQuery: string
  scopeMode: ScopeMode
  viewMode: ViewMode
  groupedVisibleSongs: SongGroup<Song>[]
  expandedGroupKey: string | null
  onExpandedGroupKeyChange: (key: string | null) => void
  currentSongId: number | null
  playlists: Playlist[]
  cardScale: number
  onPlay: (song: Song) => void
  onAddToQueue: (song: Song) => void
  onPlayNext: (song: Song) => void
  onDelete: (id: number) => void
  onDeleteMany: (ids: number[]) => Promise<void>
  onAssignPlaylist: (songId: number, playlistId: number | null) => Promise<void>
  onAssignPlaylistMany: (songIds: number[], playlistId: number | null) => Promise<void>
  onCreatePlaylist: (name: string) => Promise<Playlist>
}

export default function HomePlayerTab({
  songs,
  visibleSongs,
  queueSongs,
  loading,
  searchQuery,
  scopeMode,
  viewMode,
  groupedVisibleSongs,
  expandedGroupKey,
  onExpandedGroupKeyChange,
  currentSongId,
  playlists,
  cardScale,
  onPlay,
  onAddToQueue,
  onPlayNext,
  onDelete,
  onDeleteMany,
  onAssignPlaylist,
  onAssignPlaylistMany,
  onCreatePlaylist,
}: HomePlayerTabProps) {
  function renderGroupFolders(children: (group: SongGroup<Song>) => ReactNode) {
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
              onToggle={() => onExpandedGroupKeyChange(isOpen ? null : group.key)}
            >
              {children(group)}
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
          onPlay={onPlay}
          onPlayNext={onPlayNext}
          onAddToQueue={onAddToQueue}
          cardScale={cardScale}
        />
      ))
    }

    return (
      <SongGridCards
        songs={visibleSongs}
        currentSongId={currentSongId}
        onPlay={onPlay}
        onPlayNext={onPlayNext}
        onAddToQueue={onAddToQueue}
        cardScale={cardScale}
      />
    )
  }

  return (
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
              onPlay={onPlay}
              onAddToQueue={onAddToQueue}
              onPlayNext={onPlayNext}
              onDelete={onDelete}
              onDeleteMany={onDeleteMany}
              onAssignPlaylist={onAssignPlaylist}
              onAssignPlaylistMany={onAssignPlaylistMany}
              onCreatePlaylist={onCreatePlaylist}
            />
          ) : (
            renderGroupFolders((group) => (
              <SongList
                songs={group.songs}
                playlists={playlists}
                currentSongId={currentSongId}
                onPlay={onPlay}
                onAddToQueue={onAddToQueue}
                onPlayNext={onPlayNext}
                onDelete={onDelete}
                onDeleteMany={onDeleteMany}
                onAssignPlaylist={onAssignPlaylist}
                onAssignPlaylistMany={onAssignPlaylistMany}
                onCreatePlaylist={onCreatePlaylist}
              />
            ))
          )}
        </>
      )}
    </div>
  )
}
