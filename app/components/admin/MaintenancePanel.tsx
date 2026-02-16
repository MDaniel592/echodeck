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

type MaintenanceProgress = {
  action: MaintenanceAction
  dryRun: boolean
  phase: "start" | "scan" | "apply" | "complete"
  message?: string
  processed?: number
  total?: number
}

interface MaintenancePanelProps {
  embedded?: boolean
}

const MIN_PROGRESS_PANEL_MS = 1200

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

export default function MaintenancePanel({ embedded = false }: MaintenancePanelProps) {
  const router = useRouter()
  const [audit, setAudit] = useState<MaintenanceAudit | null>(null)
  const [loadingAudit, setLoadingAudit] = useState(true)
  const [runningAction, setRunningAction] = useState<MaintenanceAction | null>(null)
  const [error, setError] = useState("")
  const [resultLog, setResultLog] = useState<MaintenanceResult[]>([])
  const [progress, setProgress] = useState<MaintenanceProgress | null>(null)
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [showProgressPanel, setShowProgressPanel] = useState(false)
  const [panelMode, setPanelMode] = useState<"running" | "complete" | "error">("running")
  const [activeResult, setActiveResult] = useState<MaintenanceResult | null>(null)
  const [forbidden, setForbidden] = useState(false)

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
          if (embedded) {
            setForbidden(true)
            setLoadingAudit(false)
            return
          }
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
  }, [embedded, router])

  useEffect(() => {
    if (!runStartedAt || !runningAction) {
      setElapsedSeconds(0)
      return
    }
    const tick = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - runStartedAt) / 1000)))
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [runStartedAt, runningAction])

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
    const startedAt = Date.now()
    setRunningAction(action)
    setError("")
    setShowProgressPanel(true)
    setPanelMode("running")
    setActiveResult(null)
    setProgress({
      action,
      dryRun,
      phase: "start",
      message: "Starting maintenance run...",
      processed: 0,
      total: undefined,
    })
    setRunStartedAt(startedAt)
    try {
      const res = await fetch("/api/admin/maintenance/fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, dryRun, stream: true }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error || "Maintenance action failed.")
        return
      }

      let finalResult: MaintenanceResult | null = null
      let streamError = ""

      if (res.body) {
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split("\n")
          buffer = lines.pop() ?? ""

          for (const rawLine of lines) {
            const line = rawLine.trim()
            if (!line) continue
            let payload: unknown
            try {
              payload = JSON.parse(line)
            } catch {
              continue
            }
            if (!payload || typeof payload !== "object") continue
            const typed = payload as {
              type?: string
              event?: MaintenanceProgress
              result?: MaintenanceResult
              error?: string
              startedAt?: number
            }
            if (typed.type === "started" && typeof typed.startedAt === "number") {
              setRunStartedAt(typed.startedAt)
            } else if (typed.type === "progress" && typed.event) {
              setProgress(typed.event)
            } else if (typed.type === "result" && typed.result) {
              finalResult = typed.result
              setActiveResult(typed.result)
              setPanelMode("complete")
              setProgress((prev) =>
                prev
                  ? {
                      ...prev,
                      phase: "complete",
                      message: "Completed.",
                    }
                  : null
              )
            } else if (typed.type === "error") {
              streamError = typed.error || "Maintenance action failed."
              setPanelMode("error")
            }
          }
        }
      }

      if (streamError) {
        setError(streamError)
        setProgress((prev) =>
          prev
            ? {
                ...prev,
                message: streamError,
              }
            : null
        )
        return
      }
      if (!finalResult) {
        setError("Maintenance action did not return a final result.")
        setPanelMode("error")
        return
      }
      setResultLog((prev) => [finalResult as MaintenanceResult, ...prev].slice(0, 20))
      if (!dryRun) {
        await refreshAudit()
      }
    } catch {
      setError("Maintenance action failed.")
      setPanelMode("error")
    } finally {
      const elapsedMs = Date.now() - startedAt
      if (elapsedMs < MIN_PROGRESS_PANEL_MS) {
        await new Promise((resolve) => setTimeout(resolve, MIN_PROGRESS_PANEL_MS - elapsedMs))
      }
      setRunningAction(null)
      setRunStartedAt(null)
      setShowProgressPanel(false)
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

  const progressPercent =
    progress && typeof progress.processed === "number" && typeof progress.total === "number" && progress.total > 0
      ? Math.max(0, Math.min(100, Math.round((progress.processed / progress.total) * 100)))
      : null

  const content = (
    <>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Maintenance</h1>
          <p className="mt-1 text-sm text-zinc-400">Audit and repair library/download structure issues.</p>
        </div>
        {!embedded ? (
          <button
            type="button"
            onClick={() => router.push("/")}
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
          >
            Back
          </button>
        ) : null}
      </div>

      {forbidden ? (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          Admin role is required for maintenance actions.
        </div>
      ) : null}

      {error ? (
        <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>
      ) : null}

      {!forbidden ? (
        <>
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

          {showProgressPanel ? (
            <div
              className={`mt-4 rounded-lg p-4 ${
                panelMode === "error"
                  ? "border border-red-500/30 bg-red-500/10"
                  : panelMode === "complete"
                    ? "border border-emerald-500/30 bg-emerald-500/10"
                    : "border border-blue-500/30 bg-blue-500/10"
              }`}
            >
              <div
                className={`flex flex-wrap items-center gap-3 text-xs ${
                  panelMode === "error" ? "text-red-100" : panelMode === "complete" ? "text-emerald-100" : "text-blue-100"
                }`}
              >
                <span className="font-medium">Running: {runningAction}</span>
                <span>Elapsed: {elapsedSeconds}s</span>
                {progress && typeof progress.processed === "number" && typeof progress.total === "number" ? (
                  <span>
                    Progress: {progress.processed}/{progress.total}
                  </span>
                ) : null}
              </div>
              <p
                className={`mt-2 text-xs ${
                  panelMode === "error" ? "text-red-200" : panelMode === "complete" ? "text-emerald-200" : "text-blue-200"
                }`}
              >
                {progress?.message || "Working..."}
              </p>
              {progressPercent !== null ? (
                <div
                  className={`mt-3 h-2 rounded ${
                    panelMode === "error" ? "bg-red-950/70" : panelMode === "complete" ? "bg-emerald-950/70" : "bg-blue-950/70"
                  }`}
                >
                  <div
                    className={`h-2 rounded transition-all ${
                      panelMode === "error" ? "bg-red-400" : panelMode === "complete" ? "bg-emerald-400" : "bg-blue-400"
                    }`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              ) : null}
              {activeResult ? (
                <pre className="mt-3 whitespace-pre-wrap text-xs text-zinc-200">{JSON.stringify(activeResult.details, null, 2)}</pre>
              ) : null}
            </div>
          ) : null}

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <h3 className="text-sm font-semibold">Malformed Title Samples</h3>
              <div className="mt-2 max-h-72 overflow-auto text-xs">
                {(audit?.malformedSamples || []).length === 0 ? (
                  <p className="text-zinc-500">None</p>
                ) : (
                  (audit?.malformedSamples || []).map((song) => (
                    <div key={song.id} className="mb-2 border-b border-zinc-800 pb-2">
                      <div className="font-medium">
                        {song.id}: {song.title}
                      </div>
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
                      <div className="font-medium">
                        {song.id}: {song.title}
                      </div>
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
                    <pre className="mt-1 whitespace-pre-wrap text-zinc-400">{JSON.stringify(item.details, null, 2)}</pre>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      ) : null}
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
