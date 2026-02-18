import { SourceIcon } from "./taskUi"
import { statusLabel, taskDisplayName, type DownloadTaskSummary } from "./types"

interface FeaturedTaskCardProps {
  task: DownloadTaskSummary
  percent: number | null
  variant: "mobile" | "desktop"
}

export default function FeaturedTaskCard({ task, percent, variant }: FeaturedTaskCardProps) {
  if (variant === "mobile") {
    return (
      <div className="mt-2 rounded-md bg-zinc-900/40 p-2 md:hidden">
        <div className="flex items-start gap-2.5">
          {task.previewImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={task.previewImageUrl}
              alt={taskDisplayName(task)}
              className="h-10 w-10 shrink-0 rounded-lg object-cover"
            />
          ) : (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-cyan-300">
              <SourceIcon source={task.source} showFallback />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wide text-cyan-300/90">Downloading</p>
            <p className="truncate text-sm font-semibold text-zinc-100">
              {taskDisplayName(task)}
            </p>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all"
                style={{ width: `${percent ?? 0}%` }}
              />
            </div>
          </div>
          <div className="text-right text-[10px] text-zinc-400">
            {task.processedItems}
            {task.totalItems ? `/${task.totalItems}` : ""} · {percent ?? 0}%
          </div>
        </div>
        {task.lastEvent?.message && (
          <p className="mt-1 truncate text-[11px] text-zinc-500">{task.lastEvent.message}</p>
        )}
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-cyan-700/40 bg-gradient-to-br from-cyan-900/25 to-zinc-900/80">
      <div className="flex items-start gap-3 p-3">
        {task.previewImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={task.previewImageUrl}
            alt={taskDisplayName(task)}
            className="h-14 w-14 shrink-0 rounded-xl object-cover shadow-[0_0_24px_rgba(34,211,238,0.15)]"
          />
        ) : (
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-cyan-500/30 bg-zinc-900 text-cyan-300 shadow-[0_0_24px_rgba(34,211,238,0.15)]">
            <SourceIcon source={task.source} showFallback />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-wide text-cyan-300/90">Now Downloading</p>
          <p className="mt-0.5 truncate text-sm font-semibold text-zinc-100">
            {taskDisplayName(task)}
          </p>
        </div>
      </div>
      <div className="px-3 pb-3">
        <div className="mb-1 flex items-center justify-between text-[11px] text-zinc-400">
          <span>
            {task.processedItems}
            {task.totalItems ? `/${task.totalItems}` : ""} processed
          </span>
          <span>{percent !== null ? `${percent}%` : statusLabel(task.status)}</span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all"
            style={{ width: `${percent ?? 0}%` }}
          />
        </div>
      </div>
    </div>
  )
}
