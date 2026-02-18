"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

type SongLite = {
  id: number
  title: string
  artist: string | null
  playlistId?: number | null
}

type PlaylistLite = {
  id: number
  name: string
}

type SmartPlaylistRule = {
  artistContains?: string
  albumContains?: string
  genreContains?: string
  sourceEquals?: string
  yearGte?: number
  yearLte?: number
  minPlayCount?: number
  minBitrate?: number
  maxBitrate?: number
  minDurationSec?: number
  maxDurationSec?: number
  minRating?: number
  playedWithinDays?: number
  starredOnly?: boolean
  hasLyrics?: boolean
  libraryId?: number
  search?: string
  sortBy?: "createdAt" | "playCount" | "lastPlayedAt" | "year" | "title" | "artist"
  sortOrder?: "asc" | "desc"
  limit?: number
}

type SmartPlaylist = {
  id: number
  name: string
  ruleJson: string
  rule?: SmartPlaylistRule
  estimatedSongCount?: number
}

type Tag = {
  id: number
  name: string
  color: string | null
  _count?: { songs: number }
}

type DuplicateGroup = {
  fingerprint: string
  songs: Array<{
    id: number
    title: string
    artist: string | null
    source: string
    bitrate: number | null
    duration: number | null
  }>
}

interface OrganizationPanelProps {
  songs: SongLite[]
  playlists: PlaylistLite[]
  selectedPlaylist: string
  onAssignPlaylistMany: (songIds: number[], playlistId: number | null) => Promise<void> | void
  onDeleteMany: (ids: number[]) => Promise<void> | void
  onCreatePlaylist: (name: string) => Promise<PlaylistLite>
  onRefreshSongs: () => Promise<void> | void
  onRefreshPlaylists: () => Promise<void> | void
}

const EMPTY_RULE: SmartPlaylistRule = {
  sortBy: "createdAt",
  sortOrder: "desc",
  limit: 200,
}

export default function OrganizationPanel({
  songs,
  playlists,
  selectedPlaylist,
  onAssignPlaylistMany,
  onDeleteMany,
  onCreatePlaylist,
  onRefreshSongs,
  onRefreshPlaylists,
}: OrganizationPanelProps) {
  const [smartPlaylists, setSmartPlaylists] = useState<SmartPlaylist[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const [newSmartName, setNewSmartName] = useState("")
  const [newRule, setNewRule] = useState<SmartPlaylistRule>(EMPTY_RULE)

  const [newTagName, setNewTagName] = useState("")
  const [newTagColor, setNewTagColor] = useState("#38bdf8")

  const [selectedTagId, setSelectedTagId] = useState<string>("")
  const [songSearch, setSongSearch] = useState("")
  const [selectedSongIds, setSelectedSongIds] = useState<number[]>([])

  const [previewSmart, setPreviewSmart] = useState<{ id: number; songs: SongLite[] } | null>(null)
  const [busyAction, setBusyAction] = useState("")
  const [playlistToolTarget, setPlaylistToolTarget] = useState<string>("")
  const [playlistNewName, setPlaylistNewName] = useState("")
  const [playlistCreateName, setPlaylistCreateName] = useState("")

  useEffect(() => {
    if (playlistToolTarget && playlists.some((p) => String(p.id) === playlistToolTarget)) return
    const selectedParsed = Number.parseInt(selectedPlaylist, 10)
    if (Number.isInteger(selectedParsed) && playlists.some((p) => p.id === selectedParsed)) {
      setPlaylistToolTarget(String(selectedParsed))
      return
    }
    setPlaylistToolTarget(playlists[0] ? String(playlists[0].id) : "")
  }, [playlists, selectedPlaylist, playlistToolTarget])

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const [smartRes, tagsRes, dupRes] = await Promise.all([
        fetch("/api/smart-playlists", { cache: "no-store" }),
        fetch("/api/song-tags", { cache: "no-store" }),
        fetch("/api/songs/duplicates?songLimit=5000&groupLimit=50", { cache: "no-store" }),
      ])

      if (!smartRes.ok || !tagsRes.ok || !dupRes.ok) {
        throw new Error("Failed to load organization data")
      }

      const smartData = (await smartRes.json()) as SmartPlaylist[]
      const tagData = (await tagsRes.json()) as Tag[]
      const dupData = (await dupRes.json()) as { groups?: DuplicateGroup[] }

      setSmartPlaylists(Array.isArray(smartData) ? smartData : [])
      setTags(Array.isArray(tagData) ? tagData : [])
      setDuplicates(Array.isArray(dupData.groups) ? dupData.groups : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load organization data")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  const filteredSongs = useMemo(() => {
    const q = songSearch.trim().toLowerCase()
    if (!q) return songs.slice(0, 300)
    return songs
      .filter((song) => `${song.title} ${song.artist || ""}`.toLowerCase().includes(q))
      .slice(0, 300)
  }, [songs, songSearch])

  function toggleSong(id: number) {
    setSelectedSongIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function createSmartPlaylist() {
    if (!newSmartName.trim()) return
    setBusyAction("create-smart")
    setError("")
    try {
      const res = await fetch("/api/smart-playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newSmartName.trim(), rule: newRule }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || "Failed to create smart playlist")
      setNewSmartName("")
      setNewRule(EMPTY_RULE)
      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create smart playlist")
    } finally {
      setBusyAction("")
    }
  }

  async function deleteSmartPlaylist(id: number) {
    setBusyAction(`delete-smart-${id}`)
    setError("")
    try {
      const res = await fetch(`/api/smart-playlists/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to delete smart playlist")
      if (previewSmart?.id === id) setPreviewSmart(null)
      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete smart playlist")
    } finally {
      setBusyAction("")
    }
  }

  async function previewSmartPlaylist(id: number) {
    setBusyAction(`preview-smart-${id}`)
    setError("")
    try {
      const res = await fetch(`/api/smart-playlists/${id}/songs?limit=40`, { cache: "no-store" })
      const body = await res.json().catch(() => ({})) as { songs?: SongLite[] }
      if (!res.ok) throw new Error("Failed to preview smart playlist")
      setPreviewSmart({ id, songs: Array.isArray(body.songs) ? body.songs : [] })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to preview smart playlist")
    } finally {
      setBusyAction("")
    }
  }

  async function createTag() {
    if (!newTagName.trim()) return
    setBusyAction("create-tag")
    setError("")
    try {
      const res = await fetch("/api/song-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTagName.trim(), color: newTagColor.trim() || null }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || "Failed to create tag")
      setNewTagName("")
      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create tag")
    } finally {
      setBusyAction("")
    }
  }

  async function addSongsToTag() {
    if (!selectedTagId || selectedSongIds.length === 0) return
    setBusyAction("add-songs-tag")
    setError("")
    try {
      const res = await fetch(`/api/song-tags/${selectedTagId}/songs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ songIds: selectedSongIds }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || "Failed to add songs to tag")
      setSelectedSongIds([])
      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add songs to tag")
    } finally {
      setBusyAction("")
    }
  }

  async function removeSongsFromTag() {
    if (!selectedTagId || selectedSongIds.length === 0) return
    setBusyAction("remove-songs-tag")
    setError("")
    try {
      const res = await fetch(`/api/song-tags/${selectedTagId}/songs`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ songIds: selectedSongIds }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || "Failed to remove songs from tag")
      setSelectedSongIds([])
      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove songs from tag")
    } finally {
      setBusyAction("")
    }
  }

  async function deleteTag(id: number) {
    setBusyAction(`delete-tag-${id}`)
    setError("")
    try {
      const res = await fetch(`/api/song-tags/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to delete tag")
      if (String(id) === selectedTagId) setSelectedTagId("")
      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete tag")
    } finally {
      setBusyAction("")
    }
  }

  async function createPlaylistFromTools() {
    const name = playlistCreateName.trim()
    if (!name) return
    setBusyAction("playlist-create")
    setError("")
    try {
      const created = await onCreatePlaylist(name)
      setPlaylistCreateName("")
      setPlaylistToolTarget(String(created.id))
      await Promise.resolve(onRefreshPlaylists())
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create playlist")
    } finally {
      setBusyAction("")
    }
  }

  async function assignByMode(mode: "unassigned" | "all") {
    const parsed = Number.parseInt(playlistToolTarget, 10)
    if (!Number.isInteger(parsed) || parsed <= 0) {
      setError("Select a target playlist first")
      return
    }

    const ids =
      mode === "all"
        ? songs.map((song) => song.id)
        : songs.filter((song) => song.playlistId === null || song.playlistId === undefined).map((song) => song.id)
    if (ids.length === 0) return

    setBusyAction(`playlist-assign-${mode}`)
    setError("")
    try {
      await Promise.resolve(onAssignPlaylistMany(ids, parsed))
      await Promise.resolve(onRefreshPlaylists())
      await Promise.resolve(onRefreshSongs())
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign songs to playlist")
    } finally {
      setBusyAction("")
    }
  }

  async function renamePlaylistFromTools() {
    const parsed = Number.parseInt(playlistToolTarget, 10)
    const nextName = playlistNewName.trim()
    if (!Number.isInteger(parsed) || parsed <= 0) {
      setError("Select a playlist first")
      return
    }
    if (!nextName) {
      setError("Type a new playlist name")
      return
    }

    setBusyAction("playlist-rename")
    setError("")
    try {
      const res = await fetch(`/api/playlists/${parsed}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nextName }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || "Failed to rename playlist")
      setPlaylistNewName("")
      await Promise.resolve(onRefreshPlaylists())
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rename playlist")
    } finally {
      setBusyAction("")
    }
  }

  async function deletePlaylistFromTools() {
    const parsed = Number.parseInt(playlistToolTarget, 10)
    if (!Number.isInteger(parsed) || parsed <= 0) {
      setError("Select a playlist first")
      return
    }
    const playlist = playlists.find((p) => p.id === parsed)
    const ok = window.confirm(`Delete playlist \"${playlist?.name || parsed}\"? Songs will remain in library.`)
    if (!ok) return

    setBusyAction("playlist-delete")
    setError("")
    try {
      const res = await fetch(`/api/playlists/${parsed}`, { method: "DELETE" })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || "Failed to delete playlist")
      await Promise.resolve(onRefreshPlaylists())
      await Promise.resolve(onRefreshSongs())
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete playlist")
    } finally {
      setBusyAction("")
    }
  }

  async function deleteDuplicateSecondaryCopies() {
    const idsToDelete = duplicates.flatMap((group) => group.songs.slice(1).map((song) => song.id))
    const uniqueIds = Array.from(new Set(idsToDelete))
    if (uniqueIds.length === 0) return

    const ok = window.confirm(`Delete ${uniqueIds.length} duplicate copies (keeping best match per group)?`)
    if (!ok) return

    setBusyAction("dedupe-delete")
    setError("")
    try {
      await Promise.resolve(onDeleteMany(uniqueIds))
      await Promise.resolve(onRefreshSongs())
      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete duplicate copies")
    } finally {
      setBusyAction("")
    }
  }

  async function tagAllDuplicates() {
    if (duplicates.length === 0) return
    setBusyAction("tag-duplicates")
    setError("")
    try {
      const today = new Date().toISOString().slice(0, 10)
      const name = `duplicates-${today}`
      let tag = tags.find((t) => t.name === name)
      if (!tag) {
        const createRes = await fetch("/api/song-tags", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, color: "#f97316" }),
        })
        const created = (await createRes.json().catch(() => ({}))) as Tag
        if (!createRes.ok || !created?.id) throw new Error("Failed to create duplicates tag")
        tag = created
      }

      const ids = Array.from(new Set(duplicates.flatMap((group) => group.songs.map((song) => song.id))))
      const assignRes = await fetch(`/api/song-tags/${tag.id}/songs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ songIds: ids }),
      })
      if (!assignRes.ok) throw new Error("Failed to tag duplicate songs")

      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to tag duplicates")
    } finally {
      setBusyAction("")
    }
  }

  return (
    <div className="space-y-6">
      {error ? <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</div> : null}

      <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <h2 className="text-base font-semibold text-zinc-100">Organize Music</h2>
        <p className="mt-1 text-sm text-zinc-400">
          1) Put songs in a playlist, 2) tag by mood/topic, 3) build smart playlists, 4) clean duplicates.
        </p>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">1. Playlists</h3>
          <p className="text-xs text-zinc-400">Use this for manual or temporary groupings.</p>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-3 space-y-2">
          <p className="text-xs font-medium text-zinc-300">Select target playlist</p>
          <div className="flex flex-wrap gap-2">
            <select
              value={playlistToolTarget}
              onChange={(e) => setPlaylistToolTarget(e.target.value)}
              className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm"
            >
              <option value="">Select playlist</option>
              {playlists.map((playlist) => (
                <option key={playlist.id} value={String(playlist.id)}>
                  {playlist.name}
                </option>
              ))}
            </select>
            <button
              disabled={!playlistToolTarget || busyAction === "playlist-assign-unassigned"}
              onClick={() => void assignByMode("unassigned")}
              className="rounded bg-sky-400 px-3 py-2 text-xs font-semibold text-slate-900 disabled:opacity-60"
            >
              Send Unassigned Here
            </button>
            <button
              disabled={!playlistToolTarget || busyAction === "playlist-assign-all"}
              onClick={() => void assignByMode("all")}
              className="rounded bg-cyan-300 px-3 py-2 text-xs font-semibold text-slate-900 disabled:opacity-60"
            >
              Send All Songs Here
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-3 space-y-2">
          <p className="text-xs font-medium text-zinc-300">Create / Rename / Delete</p>
          <div className="flex flex-wrap gap-2">
            <input
              value={playlistCreateName}
              onChange={(e) => setPlaylistCreateName(e.target.value)}
              placeholder="New playlist name"
              className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm"
            />
            <button
              disabled={busyAction === "playlist-create"}
              onClick={() => void createPlaylistFromTools()}
              className="rounded bg-emerald-400 px-3 py-2 text-xs font-semibold text-slate-900 disabled:opacity-60"
            >
              Create
            </button>
            <input
              value={playlistNewName}
              onChange={(e) => setPlaylistNewName(e.target.value)}
              placeholder="Rename selected playlist"
              className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm"
            />
            <button
              disabled={!playlistToolTarget || busyAction === "playlist-rename"}
              onClick={() => void renamePlaylistFromTools()}
              className="rounded bg-amber-300 px-3 py-2 text-xs font-semibold text-slate-900 disabled:opacity-60"
            >
              Rename
            </button>
            <button
              disabled={!playlistToolTarget || busyAction === "playlist-delete"}
              onClick={() => void deletePlaylistFromTools()}
              className="rounded bg-rose-500/80 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
            >
              Delete
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">2. Tags</h3>
          <p className="text-xs text-zinc-400">Tags are flexible labels. A song can have many tags.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm" placeholder="New tag name" value={newTagName} onChange={(e) => setNewTagName(e.target.value)} />
          <input className="h-9 w-14 rounded border border-white/10 bg-black/20" type="color" value={newTagColor} onChange={(e) => setNewTagColor(e.target.value)} />
          <button disabled={busyAction === "create-tag"} onClick={() => void createTag()} className="rounded-lg bg-emerald-400 px-3 py-2 text-sm font-semibold text-slate-900 disabled:opacity-60">Create Tag</button>
        </div>

        <div className="space-y-2">
          {tags.map((tag) => (
            <div key={tag.id} className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tag.color || "#a1a1aa" }} />
              <span className="text-zinc-100">{tag.name}</span>
              <span className="text-zinc-400">{tag._count?.songs ?? 0} songs</span>
              <button onClick={() => void deleteTag(tag.id)} className="ml-auto rounded bg-rose-500/20 px-2 py-1 text-xs text-rose-200">Delete</button>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-3 space-y-2">
          <p className="text-xs font-medium text-zinc-300">Assign Songs To Tag</p>
          <div className="flex flex-wrap gap-2">
            <select value={selectedTagId} onChange={(e) => setSelectedTagId(e.target.value)} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm">
              <option value="">Select tag</option>
              {tags.map((tag) => (
                <option key={tag.id} value={String(tag.id)}>{tag.name}</option>
              ))}
            </select>
            <input value={songSearch} onChange={(e) => setSongSearch(e.target.value)} placeholder="Search songs" className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm" />
            <button onClick={() => setSelectedSongIds(filteredSongs.map((song) => song.id))} className="rounded bg-white/10 px-3 py-2 text-xs">Select Shown</button>
            <button onClick={() => setSelectedSongIds([])} className="rounded bg-white/10 px-3 py-2 text-xs">Clear</button>
            <button disabled={!selectedTagId || selectedSongIds.length === 0} onClick={() => void addSongsToTag()} className="rounded bg-sky-400 px-3 py-2 text-xs font-semibold text-slate-900 disabled:opacity-60">Add</button>
            <button disabled={!selectedTagId || selectedSongIds.length === 0} onClick={() => void removeSongsFromTag()} className="rounded bg-amber-300 px-3 py-2 text-xs font-semibold text-slate-900 disabled:opacity-60">Remove</button>
          </div>
          <p className="text-xs text-zinc-500">Selected: {selectedSongIds.length}</p>
          <div className="max-h-56 overflow-y-auto space-y-1">
            {filteredSongs.map((song) => {
              const checked = selectedSongIds.includes(song.id)
              return (
                <label key={song.id} className="flex items-center gap-2 text-sm text-zinc-200">
                  <input type="checkbox" checked={checked} onChange={() => toggleSong(song.id)} />
                  <span>{song.title}</span>
                  <span className="text-zinc-500">{song.artist || "Unknown"}</span>
                </label>
              )
            })}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">3. Smart Playlists</h3>
          <p className="text-xs text-zinc-400">Automatic lists based on rules.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <input className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm" placeholder="Name" value={newSmartName} onChange={(e) => setNewSmartName(e.target.value)} />
          <input className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm" placeholder="Artist contains" value={newRule.artistContains || ""} onChange={(e) => setNewRule((prev) => ({ ...prev, artistContains: e.target.value || undefined }))} />
          <input className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm" placeholder="Genre contains" value={newRule.genreContains || ""} onChange={(e) => setNewRule((prev) => ({ ...prev, genreContains: e.target.value || undefined }))} />
          <input className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm" placeholder="Source equals (youtube/library)" value={newRule.sourceEquals || ""} onChange={(e) => setNewRule((prev) => ({ ...prev, sourceEquals: e.target.value || undefined }))} />
          <input className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm" placeholder="Min play count" type="number" value={newRule.minPlayCount || ""} onChange={(e) => setNewRule((prev) => ({ ...prev, minPlayCount: e.target.value ? Number.parseInt(e.target.value, 10) : undefined }))} />
          <input className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm" placeholder="Min bitrate kbps" type="number" value={newRule.minBitrate || ""} onChange={(e) => setNewRule((prev) => ({ ...prev, minBitrate: e.target.value ? Number.parseInt(e.target.value, 10) : undefined }))} />
          <input className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm" placeholder="Max bitrate kbps" type="number" value={newRule.maxBitrate || ""} onChange={(e) => setNewRule((prev) => ({ ...prev, maxBitrate: e.target.value ? Number.parseInt(e.target.value, 10) : undefined }))} />
          <input className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm" placeholder="Min duration sec" type="number" value={newRule.minDurationSec || ""} onChange={(e) => setNewRule((prev) => ({ ...prev, minDurationSec: e.target.value ? Number.parseInt(e.target.value, 10) : undefined }))} />
          <input className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm" placeholder="Max duration sec" type="number" value={newRule.maxDurationSec || ""} onChange={(e) => setNewRule((prev) => ({ ...prev, maxDurationSec: e.target.value ? Number.parseInt(e.target.value, 10) : undefined }))} />
          <input className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm" placeholder="Min rating (1-5)" type="number" min={1} max={5} value={newRule.minRating || ""} onChange={(e) => setNewRule((prev) => ({ ...prev, minRating: e.target.value ? Number.parseInt(e.target.value, 10) : undefined }))} />
          <input className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm" placeholder="Played in last N days" type="number" value={newRule.playedWithinDays || ""} onChange={(e) => setNewRule((prev) => ({ ...prev, playedWithinDays: e.target.value ? Number.parseInt(e.target.value, 10) : undefined }))} />
          <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-zinc-200">
            <input type="checkbox" checked={Boolean(newRule.hasLyrics)} onChange={(e) => setNewRule((prev) => ({ ...prev, hasLyrics: e.target.checked || undefined }))} />
            Lyrics required
          </label>
        </div>
        <button disabled={busyAction === "create-smart"} onClick={() => void createSmartPlaylist()} className="rounded-lg bg-sky-400 px-3 py-2 text-sm font-semibold text-slate-900 disabled:opacity-60">Create Smart Playlist</button>

        <div className="space-y-2">
          {loading ? <p className="text-sm text-zinc-400">Loading...</p> : null}
          {smartPlaylists.map((list) => (
            <div key={list.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm">
              <span className="font-medium text-zinc-100">{list.name}</span>
              <span className="text-zinc-400">~{list.estimatedSongCount ?? 0} songs</span>
              <button onClick={() => void previewSmartPlaylist(list.id)} className="rounded bg-white/10 px-2 py-1 text-xs">Preview</button>
              <button onClick={() => void deleteSmartPlaylist(list.id)} className="rounded bg-rose-500/20 px-2 py-1 text-xs text-rose-200">Delete</button>
            </div>
          ))}
        </div>

        {previewSmart ? (
          <div className="rounded-lg border border-white/10 bg-black/20 p-3">
            <p className="mb-2 text-xs text-zinc-400">Preview (first {previewSmart.songs.length})</p>
            <div className="max-h-52 overflow-y-auto space-y-1 text-sm">
              {previewSmart.songs.map((song) => (
                <div key={song.id} className="text-zinc-200">{song.title} <span className="text-zinc-500">{song.artist || "Unknown"}</span></div>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">4. Duplicates</h3>
          <p className="text-xs text-zinc-400">Detect likely duplicate tracks and clean quickly.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => void loadAll()} className="rounded bg-white/10 px-2 py-1 text-xs">Refresh</button>
          <button disabled={duplicates.length === 0 || busyAction === "tag-duplicates"} onClick={() => void tagAllDuplicates()} className="rounded bg-orange-400 px-3 py-1.5 text-xs font-semibold text-slate-900 disabled:opacity-60">Tag All Duplicates</button>
          <button disabled={duplicates.length === 0 || busyAction === "dedupe-delete"} onClick={() => void deleteDuplicateSecondaryCopies()} className="rounded bg-rose-500/80 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">Keep Best, Delete Rest</button>
        </div>
        <p className="text-xs text-zinc-400">Groups found: {duplicates.length}</p>
        <div className="space-y-2 max-h-[28rem] overflow-y-auto">
          {duplicates.map((group) => (
            <div key={group.fingerprint} className="rounded-lg border border-white/10 bg-black/20 p-3">
              <p className="text-xs text-zinc-500">{group.songs.length} tracks</p>
              <div className="space-y-1 text-sm">
                {group.songs.map((song) => (
                  <div key={song.id} className="text-zinc-200">
                    {song.title} <span className="text-zinc-500">{song.artist || "Unknown"}</span> <span className="text-zinc-500">[{song.source}]</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
