export function formatDuration(seconds: number | null): string {
  if (!seconds) return "--:--"
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

export function formatSize(bytes: number | null): string {
  if (!bytes) return ""
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function getSourceBadge(source: string): { label: string; className: string } {
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
