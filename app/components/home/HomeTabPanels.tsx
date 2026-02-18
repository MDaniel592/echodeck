"use client"

import DownloadForm from "../DownloadForm"
import MaintenancePanel from "../admin/MaintenancePanel"
import LibraryManagementPanel from "../library/LibraryManagementPanel"
import OrganizationPanel from "../organization/OrganizationPanel"
import HomePlayerTab from "./HomePlayerTab"
import type { HomeTab, Playlist, ScopeMode, Song, ViewMode } from "./types"
import type { SongGroup } from "../../../lib/songGrouping"

interface HomeTabPanelsProps {
  activeTab: HomeTab
  songs: Song[]
  playlists: Playlist[]
  selectedPlaylist: string
  loading: boolean
  searchQuery: string
  scopeMode: ScopeMode
  viewMode: ViewMode
  groupedVisibleSongs: SongGroup<Song>[]
  expandedGroupKey: string | null
  currentSongId: number | null
  queueSongs: Song[]
  visibleSongs: Song[]
  cardScale: number
  onExpandedGroupKeyChange: (key: string | null) => void
  onPlay: (song: Song) => void
  onAddToQueue: (song: Song) => void
  onPlayNext: (song: Song) => void
  onDelete: (id: number) => Promise<void>
  onDeleteMany: (ids: number[]) => Promise<void>
  onAssignPlaylist: (songId: number, playlistId: number | null) => Promise<void>
  onAssignPlaylistMany: (songIds: number[], playlistId: number | null) => Promise<void>
  onCreatePlaylist: (name: string) => Promise<Playlist>
  onRefreshSongs: () => Promise<void>
  onRefreshPlaylists: () => Promise<void>
  onRefreshLibraries: () => Promise<void>
}

export default function HomeTabPanels({
  activeTab,
  songs,
  playlists,
  selectedPlaylist,
  loading,
  searchQuery,
  scopeMode,
  viewMode,
  groupedVisibleSongs,
  expandedGroupKey,
  currentSongId,
  queueSongs,
  visibleSongs,
  cardScale,
  onExpandedGroupKeyChange,
  onPlay,
  onAddToQueue,
  onPlayNext,
  onDelete,
  onDeleteMany,
  onAssignPlaylist,
  onAssignPlaylistMany,
  onCreatePlaylist,
  onRefreshSongs,
  onRefreshPlaylists,
  onRefreshLibraries,
}: HomeTabPanelsProps) {
  return (
    <>
      {activeTab === "download" && (
        <DownloadForm
          onDownloadStart={() => {}}
          onDownloadComplete={() => {
            void onRefreshSongs()
            void onRefreshPlaylists()
            void onRefreshLibraries()
          }}
        />
      )}

      {activeTab === "manage" && <LibraryManagementPanel embedded />}

      {activeTab === "organize" && (
        <OrganizationPanel
          songs={songs.map((song) => ({
            id: song.id,
            title: song.title,
            artist: song.artist,
            playlistId: song.playlistId,
          }))}
          playlists={playlists.map((playlist) => ({
            id: playlist.id,
            name: playlist.name,
          }))}
          selectedPlaylist={selectedPlaylist}
          onAssignPlaylistMany={onAssignPlaylistMany}
          onDeleteMany={onDeleteMany}
          onCreatePlaylist={onCreatePlaylist}
          onRefreshSongs={onRefreshSongs}
          onRefreshPlaylists={onRefreshPlaylists}
        />
      )}

      {activeTab === "maintenance" && <MaintenancePanel embedded />}

      {activeTab === "player" && (
        <HomePlayerTab
          songs={songs}
          visibleSongs={visibleSongs}
          queueSongs={queueSongs}
          loading={loading}
          searchQuery={searchQuery}
          scopeMode={scopeMode}
          viewMode={viewMode}
          groupedVisibleSongs={groupedVisibleSongs}
          expandedGroupKey={expandedGroupKey}
          onExpandedGroupKeyChange={onExpandedGroupKeyChange}
          currentSongId={currentSongId}
          playlists={playlists}
          cardScale={cardScale}
          onPlay={onPlay}
          onAddToQueue={onAddToQueue}
          onPlayNext={onPlayNext}
          onDelete={onDelete}
          onDeleteMany={onDeleteMany}
          onAssignPlaylist={onAssignPlaylist}
          onAssignPlaylistMany={onAssignPlaylistMany}
          onCreatePlaylist={onCreatePlaylist}
        />
      )}
    </>
  )
}
