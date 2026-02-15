"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"

type MaintenanceAudit = {
  songsTotal: number
  songsWithoutLibrary: number
  songsWithoutArtistRef: number
  songsWithoutAlbumRef: number
  songsWithoutCover: number
  importSongs: number
  malformedTitles: number
  duplicateImportCandidates: number
  malformedSamples: Array<{ id: number; title: string; filePath: string }>
  importDuplicateSamples: Array<{ id: number; title: string; filePath: string }>
}

type MaintenanceAction =
  | "attach_library"
  | "backfill_metadata"
  | "dedupe_library_imports"
  | "normalize_titles"
  | "fill_missing_covers"
  | "refresh_file_metadata"
  | "queue_redownload_candidates"
  | "refresh_origin_metadata"

type MaintenanceResult = {
  action: MaintenanceAction
  dryRun: boolean
  details: Record<string, number | string | boolean>
}

const ACTIONS: Array<{ id: MaintenanceAction; label: string; description: string }> = [
  {
    id: "attach_library",
    label: "Attach To Library",
    description: "Assign songs without libraryId to your main library and ensure downloads path is tracked.",
  },
  {
    id: "backfill_metadata",
    label: "Backfill Artist/Album",
    description: "Create missing Artist/Album references from existing song text metadata.",
  },
  {
    id: "dedupe_library_imports",
    label: "Deduplicate Imports",
    description: "Remove duplicate songs under /library-imports and remap references safely.",
  },
  {
    id: "normalize_titles",
    label: "Normalize Titles",
    description: "Clean malformed numeric prefixes from song titles.",
  },
  {
    id: "fill_missing_covers",
    label: "Fill Missing Covers",
    description: "Reuse known cover paths from matching songs when coverPath is missing.",
  },
  {
    id: "refresh_file_metadata",
    label: "Refresh File Metadata",
    description: "Run ffprobe on local files and update title/tag/technical metadata fields from audio tags.",
  },
  {
    id: "queue_redownload_candidates",
    label: "Queue Re-download Candidates",
    description: "Queue download tasks for tracks with missing files or weak technical metadata.",
  },
  {
    id: "refresh_origin_metadata",
    label: "Refresh Origin Metadata",
    description: "Fetch metadata/artwork from source URLs (YouTube/SoundCloud/Spotify) without audio re-download.",
  },
]

export default function MaintenancePage() {
  const router = useRouter()
  const [audit, setAudit] = useState<MaintenanceAudit | null>(null)
  const [loadingAudit, setLoadingAudit] = useState(true)
  const [runningAction, setRunningAction] = useState<MaintenanceAction | null>(null)
  const [error, setError] = useState("")
  const [resultLog, setResultLog] = useState<MaintenanceResult[]>([])

  useEffect(() => {
    let active = true

    async function bootstrap() {
      try {
        const authRes = await fetch("/api/auth/check", { cache: "no-store" })
        const authData = await authRes.json()
        if (!active) return
        if (!authData?.authenticated) {
          router.replace("/login")
          return
        }
        if (authData?.user?.role !== "admin") {
          router.replace("/")
          return
        }
      } catch {
        if (active) router.replace("/login")
        return
      }

      await refreshAudit()
    }

    void bootstrap()
    return () => {
      active = false
    }
  }, [router])

  async function refreshAudit() {
    setLoadingAudit(true)
    setError("")
    try {
      const res = await fetch("/api/admin/maintenance/audit", { cache: "no-store" })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error || "Failed to load audit.")
        return
      }
      setAudit(data as MaintenanceAudit)
    } catch {
      setError("Failed to load audit.")
    } finally {
      setLoadingAudit(false)
    }
  }

  async function runAction(action: MaintenanceAction, dryRun: boolean) {
    setRunningAction(action)
    setError("")
    try {
      const res = await fetch("/api/admin/maintenance/fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, dryRun }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error || "Maintenance action failed.")
        return
      }
      setResultLog((prev) => [data as MaintenanceResult, ...prev].slice(0, 20))
      if (!dryRun) {
        await refreshAudit()
      }
    } catch {
      setError("Maintenance action failed.")
    } finally {
      setRunningAction(null)
    }
  }

  const cards = useMemo(
    () =>
      audit
        ? [
            { label: "Songs", value: audit.songsTotal },
            { label: "No Library", value: audit.songsWithoutLibrary },
            { label: "No Artist Ref", value: audit.songsWithoutArtistRef },
            { label: "No Album Ref", value: audit.songsWithoutAlbumRef },
            { label: "No Cover", value: audit.songsWithoutCover },
            { label: "Import Copies", value: audit.importSongs },
            { label: "Malformed Titles", value: audit.malformedTitles },
            { label: "Duplicate Candidates", value: audit.duplicateImportCandidates },
          ]
        : [],
    [audit]
  )

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Maintenance</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Audit and repair library/download structure issues.
            </p>
          </div>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
          >
            Back
          </button>
        </div>

        {error ? (
          <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {loadingAudit
            ? Array.from({ length: 8 }).map((_, idx) => (
                <div key={idx} className="h-20 animate-pulse rounded-lg border border-zinc-800 bg-zinc-900/60" />
              ))
            : cards.map((card) => (
                <div key={card.label} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                  <div className="text-xs text-zinc-400">{card.label}</div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums">{card.value}</div>
                </div>
              ))}
        </div>

        <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <h2 className="text-sm font-semibold">Fix Actions</h2>
          <div className="mt-3 space-y-3">
            {ACTIONS.map((action) => {
              const isRunning = runningAction === action.id
              return (
                <div
                  key={action.id}
                  className="flex flex-col gap-2 rounded-lg border border-zinc-800 bg-black/40 p-3 md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <div className="text-sm font-medium">{action.label}</div>
                    <div className="text-xs text-zinc-400">{action.description}</div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={Boolean(runningAction)}
                      onClick={() => runAction(action.id, true)}
                      className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-60"
                    >
                      {isRunning ? "Running..." : "Dry Run"}
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(runningAction)}
                      onClick={() => runAction(action.id, false)}
                      className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                    >
                      Apply
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
            <h3 className="text-sm font-semibold">Malformed Title Samples</h3>
            <div className="mt-2 max-h-72 overflow-auto text-xs">
              {(audit?.malformedSamples || []).length === 0 ? (
                <p className="text-zinc-500">None</p>
              ) : (
                (audit?.malformedSamples || []).map((song) => (
                  <div key={song.id} className="mb-2 border-b border-zinc-800 pb-2">
                    <div className="font-medium">{song.id}: {song.title}</div>
                    <div className="text-zinc-500">{song.filePath}</div>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
            <h3 className="text-sm font-semibold">Duplicate Import Samples</h3>
            <div className="mt-2 max-h-72 overflow-auto text-xs">
              {(audit?.importDuplicateSamples || []).length === 0 ? (
                <p className="text-zinc-500">None</p>
              ) : (
                (audit?.importDuplicateSamples || []).map((song) => (
                  <div key={song.id} className="mb-2 border-b border-zinc-800 pb-2">
                    <div className="font-medium">{song.id}: {song.title}</div>
                    <div className="text-zinc-500">{song.filePath}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <h3 className="text-sm font-semibold">Recent Runs</h3>
          <div className="mt-2 max-h-72 overflow-auto text-xs">
            {resultLog.length === 0 ? (
              <p className="text-zinc-500">No actions run in this session.</p>
            ) : (
              resultLog.map((item, index) => (
                <div key={`${item.action}-${index}`} className="mb-2 border-b border-zinc-800 pb-2">
                  <div className="font-medium">
                    {item.action} {item.dryRun ? "(dry-run)" : "(applied)"}
                  </div>
                  <pre className="mt-1 whitespace-pre-wrap text-zinc-400">
                    {JSON.stringify(item.details, null, 2)}
                  </pre>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
