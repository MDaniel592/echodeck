"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

type Library = {
  id: number
  name: string
  createdAt: string
  _count?: { songs: number }
  paths?: Array<{ id: number; path: string; enabled: boolean; lastScannedAt: string | null }>
  scanRuns?: Array<{ id: number; status: string; startedAt: string; finishedAt: string | null }>
}

type Artist = {
  id: number
  name: string
  _count?: { albums: number; songs: number }
}

type Album = {
  id: number
  title: string
  year: number | null
  artist?: { id: number; name: string } | null
  _count?: { songs: number }
}

interface LibraryManagementPanelProps {
  embedded?: boolean
}

export default function LibraryManagementPanel({ embedded = false }: LibraryManagementPanelProps) {
  const router = useRouter()
  const [libraries, setLibraries] = useState<Library[]>([])
  const [artists, setArtists] = useState<Artist[]>([])
  const [albums, setAlbums] = useState<Album[]>([])
  const [name, setName] = useState("")
  const [inputPath, setInputPath] = useState("")
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scanState, setScanState] = useState<Record<number, string>>({})

  const libraryCountLabel = useMemo(() => {
    const count = libraries.length
    return `${count} ${count === 1 ? "library" : "libraries"}`
  }, [libraries.length])

  const fetchAll = useCallback(async () => {
    try {
      setError(null)

      const [librariesRes, artistsRes, albumsRes] = await Promise.all([
        fetch("/api/libraries", { cache: "no-store" }),
        fetch("/api/artists?limit=20", { cache: "no-store" }),
        fetch("/api/albums?limit=20", { cache: "no-store" }),
      ])

      if (librariesRes.status === 401 || artistsRes.status === 401 || albumsRes.status === 401) {
        router.push("/login")
        return
      }

      const librariesPayload = await librariesRes.json().catch(() => [])
      const artistsPayload = await artistsRes.json().catch(() => ({ artists: [] }))
      const albumsPayload = await albumsRes.json().catch(() => ({ albums: [] }))

      const nextLibraries = Array.isArray(librariesPayload) ? librariesPayload : []
      setLibraries(nextLibraries)
      setArtists(Array.isArray(artistsPayload?.artists) ? artistsPayload.artists : [])
      setAlbums(Array.isArray(albumsPayload?.albums) ? albumsPayload.albums : [])

      const nextScanState: Record<number, string> = {}
      for (const library of nextLibraries) {
        const latest = library.scanRuns?.[0]
        if (!latest) continue
        if (latest.status === "queued" || latest.status === "running") {
          nextScanState[library.id] = latest.status
        }
      }
      setScanState(nextScanState)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load library metadata")
    }
  }, [router])

  useEffect(() => {
    void fetchAll()
  }, [fetchAll])

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null

    const startPolling = () => {
      if (interval) return
      interval = setInterval(() => {
        if (typeof document !== "undefined" && document.visibilityState !== "visible") return
        void fetchAll()
      }, 7000)
    }

    const stopPolling = () => {
      if (!interval) return
      clearInterval(interval)
      interval = null
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void fetchAll()
        startPolling()
        return
      }
      stopPolling()
    }

    if (typeof document === "undefined" || document.visibilityState === "visible") {
      startPolling()
    }
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      stopPolling()
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [fetchAll])

  async function handleCreateLibrary() {
    if (!name.trim() || !inputPath.trim()) return
    setCreating(true)
    setError(null)
    try {
      const res = await fetch("/api/libraries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), path: inputPath.trim() }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new Error(payload?.error || "Failed to create library")
      }
      setName("")
      setInputPath("")
      await fetchAll()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create library")
    } finally {
      setCreating(false)
    }
  }

  async function handleScan(libraryId: number) {
    setScanState((prev) => ({ ...prev, [libraryId]: "queuing" }))
    setError(null)
    try {
      const res = await fetch(`/api/libraries/${libraryId}/scan`, { method: "POST" })
      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(payload?.error || "Failed to queue scan")
      }
      setScanState((prev) => ({ ...prev, [libraryId]: payload?.status || "queued" }))
      await fetchAll()
    } catch (e) {
      setScanState((prev) => ({ ...prev, [libraryId]: "error" }))
      setError(e instanceof Error ? e.message : "Failed to queue scan")
    }
  }

  const content = (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Library Management</h1>
          <p className="mt-1 text-sm text-zinc-400">{libraryCountLabel}</p>
        </div>
        {!embedded ? (
          <Link
            href="/"
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-900"
          >
            Back to Player
          </Link>
        ) : null}
      </div>

      <section className="mb-6 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-300">Create Library</h2>
        <div className="grid gap-3 md:grid-cols-[1fr_2fr_auto]">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Library name"
            className="h-10 rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm"
          />
          <input
            value={inputPath}
            onChange={(e) => setInputPath(e.target.value)}
            placeholder="Absolute path to audio folder"
            className="h-10 rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm"
          />
          <button
            type="button"
            onClick={handleCreateLibrary}
            disabled={creating}
            className="h-10 rounded-lg bg-zinc-100 px-4 text-sm font-medium text-zinc-900 disabled:opacity-50"
          >
            {creating ? "Creating..." : "Create"}
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
      </section>

      <section className="mb-6 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-300">Libraries</h2>
        <div className="space-y-3">
          {libraries.length === 0 && <p className="text-sm text-zinc-500">No libraries yet.</p>}
          {libraries.map((library) => (
            <div key={library.id} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{library.name}</p>
                  <p className="text-xs text-zinc-500">{(library._count?.songs || 0)} songs</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleScan(library.id)}
                  className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800"
                >
                  {scanState[library.id] ? `Scan (${scanState[library.id]})` : "Scan"}
                </button>
              </div>
              <div className="mt-2 space-y-1">
                {(library.paths || []).map((p) => (
                  <p key={p.id} className="truncate text-xs text-zinc-400">
                    {p.path}
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-300">Top Artists</h2>
          <ul className="space-y-2">
            {artists.map((artist) => (
              <li key={artist.id} className="flex items-center justify-between text-sm">
                <span>{artist.name}</span>
                <span className="text-zinc-500">
                  {(artist._count?.albums || 0)} albums / {(artist._count?.songs || 0)} songs
                </span>
              </li>
            ))}
            {artists.length === 0 && <li className="text-sm text-zinc-500">No artist metadata yet.</li>}
          </ul>
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-300">Recent Albums</h2>
          <ul className="space-y-2">
            {albums.map((album) => (
              <li key={album.id} className="flex items-center justify-between text-sm">
                <span>{album.title}</span>
                <span className="text-zinc-500">
                  {album.artist?.name || "Unknown"} · {album.year || "n/a"}
                </span>
              </li>
            ))}
            {albums.length === 0 && <li className="text-sm text-zinc-500">No album metadata yet.</li>}
          </ul>
        </section>
      </div>
    </>
  )

  if (embedded) {
    return <div className="animate-[app-fade-in_450ms_ease-out]">{content}</div>
  }

  return (
    <div className="app-shell">
      <div className="relative z-10 mx-auto max-w-6xl px-4 py-6 sm:px-6">{content}</div>
    </div>
  )
}
