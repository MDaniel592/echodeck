"use client"

type ScopeMode = "all" | "playlists" | "libraries"
type ViewMode = "list" | "grid"

interface PlaylistOption {
  id: number
  name: string
  _count: { songs: number }
}

interface TagOption {
  id: number
  name: string
  _count?: { songs: number }
}

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

function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.2" />
      <rect x="14" y="3" width="7" height="7" rx="1.2" />
      <rect x="3" y="14" width="7" height="7" rx="1.2" />
      <rect x="14" y="14" width="7" height="7" rx="1.2" />
    </svg>
  )
}

function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <circle cx="4" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="18" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

interface LibraryToolbarProps {
  searchQuery: string
  onSearchChange: (value: string) => void
  onClearSearch: () => void
  scopeMode: ScopeMode
  onScopeModeChange: (value: ScopeMode) => void
  selectedPlaylist: string
  onSelectedPlaylistChange: (value: string) => void
  selectedTag: string
  onSelectedTagChange: (value: string) => void
  viewMode: ViewMode
  onViewModeChange: (value: ViewMode) => void
  cardScale: number
  onCardScaleChange: (value: number) => void
  songsCount: number
  unassignedCount: number
  playlists: PlaylistOption[]
  tags: TagOption[]
}

export default function LibraryToolbar({
  searchQuery,
  onSearchChange,
  onClearSearch,
  scopeMode,
  onScopeModeChange,
  selectedPlaylist,
  onSelectedPlaylistChange,
  selectedTag,
  onSelectedTagChange,
  viewMode,
  onViewModeChange,
  cardScale,
  onCardScaleChange,
  songsCount,
  unassignedCount,
  playlists,
  tags,
}: LibraryToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 pb-2 pt-0 lg:gap-3">
      <div className="relative flex-1 max-w-xs">
        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5 text-zinc-400">
          <SearchIcon />
        </span>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search..."
          className="h-8 w-full rounded-lg border border-white/10 bg-white/5 pl-8 pr-3 text-sm text-white placeholder-zinc-500 transition-colors focus:border-sky-300/50 focus:outline-none lg:h-10 lg:text-base"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={onClearSearch}
            className="absolute inset-y-0 right-0 flex items-center pr-2 text-zinc-400 hover:text-zinc-100"
            aria-label="Clear search"
          >
            <CloseIcon />
          </button>
        )}
      </div>

      <select
        value={scopeMode}
        onChange={(e) => onScopeModeChange(e.target.value as ScopeMode)}
        className="h-8 rounded-lg border border-white/10 bg-white/5 pl-2.5 text-xs text-zinc-200 transition-colors focus:border-sky-300/50 focus:outline-none lg:h-10 lg:text-sm"
        aria-label="Scope"
      >
        <option value="all">Scope: All Songs</option>
        <option value="playlists">Scope: Playlists</option>
        <option value="libraries">Scope: Libraries</option>
      </select>

      {scopeMode !== "libraries" && (
        <select
          value={selectedPlaylist}
          onChange={(e) => onSelectedPlaylistChange(e.target.value)}
          className="h-8 rounded-lg border border-white/10 bg-white/5 pl-2.5 text-xs text-zinc-200 transition-colors focus:border-sky-300/50 focus:outline-none sm:min-w-[10rem] lg:h-10 lg:text-sm"
        >
          <option value="all">All Playlists ({songsCount})</option>
          <option value="none">Unassigned ({unassignedCount})</option>
          {playlists.map((playlist) => (
            <option key={playlist.id} value={playlist.id}>
              {playlist.name} ({playlist._count.songs})
            </option>
          ))}
        </select>
      )}

      <select
        value={selectedTag}
        onChange={(e) => onSelectedTagChange(e.target.value)}
        className="h-8 rounded-lg border border-white/10 bg-white/5 pl-2.5 text-xs text-zinc-200 transition-colors focus:border-sky-300/50 focus:outline-none sm:min-w-[10rem] lg:h-10 lg:text-sm"
      >
        <option value="all">Tag: Any</option>
        {tags.map((tag) => (
          <option key={tag.id} value={tag.id}>
            {tag.name} ({tag._count?.songs ?? 0})
          </option>
        ))}
      </select>

      <div className="inline-flex h-8 items-center rounded-lg border border-white/10 bg-white/5 p-0.5 lg:h-10">
        <button
          type="button"
          onClick={() => onViewModeChange("list")}
          className={`inline-flex h-full items-center gap-1 rounded-md px-2.5 text-xs transition-colors ${
            viewMode === "list"
              ? "bg-sky-300/90 text-slate-900"
              : "text-zinc-200 hover:bg-white/10"
          }`}
          aria-pressed={viewMode === "list"}
        >
          <ListIcon />
          List
        </button>
        <button
          type="button"
          onClick={() => onViewModeChange("grid")}
          className={`inline-flex h-full items-center gap-1 rounded-md px-2.5 text-xs transition-colors ${
            viewMode === "grid"
              ? "bg-sky-300/90 text-slate-900"
              : "text-zinc-200 hover:bg-white/10"
          }`}
          aria-pressed={viewMode === "grid"}
        >
          <GridIcon />
          Grid
        </button>
      </div>

      {viewMode === "grid" && (
        <div className="inline-flex h-8 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2.5 lg:h-10">
          <span className="text-[10px] uppercase tracking-wide text-zinc-400 lg:text-xs">Card Size</span>
          <input
            type="range"
            min={80}
            max={190}
            step={5}
            value={cardScale}
            onChange={(e) => onCardScaleChange(Number.parseInt(e.target.value, 10))}
            className="h-1.5 w-20 accent-sky-300 lg:w-28"
            aria-label="Grid card size"
          />
        </div>
      )}
    </div>
  )
}
