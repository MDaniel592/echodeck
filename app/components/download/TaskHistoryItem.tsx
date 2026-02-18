import { SourceIcon, TaskStatusBadge } from "./taskUi"
import { parseEventPayload, taskDisplayName, taskProgressPercent, type DownloadTaskSummary } from "./types"

interface TaskHistoryItemProps {
  task: DownloadTaskSummary
  selected: boolean
  variant: "mobile" | "desktop"
  onSelect: () => void
}

export default function TaskHistoryItem({ task, selected, variant, onSelect }: TaskHistoryItemProps) {
  const total = task.totalItems ?? 0
  const progressPercent = taskProgressPercent(task)

  if (variant === "mobile") {
    return (
      <button
        type="button"
        onClick={onSelect}
        className={`w-full px-1 py-2 text-left transition-colors ${
          selected ? "bg-zinc-900/60" : "hover:bg-zinc-900/40"
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-zinc-200">
            <SourceIcon source={task.source} />
            {taskDisplayName(task)}
          </p>
          <TaskStatusBadge status={task.status} className="rounded-md px-1.5 py-0.5 text-[10px]" />
        </div>
        <p className="mt-0.5 text-[10px] text-zinc-500">
          {task.processedItems}
          {total > 0 ? `/${total}` : ""} processed
        </p>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all"
            style={{ width: `${progressPercent ?? 0}%` }}
          />
        </div>
        {progressPercent !== null && (
          <p className="mt-0.5 text-[11px] text-blue-300">
            {progressPercent}%
          </p>
        )}
      </button>
    )
  }

  const lastPayload = parseEventPayload(task.lastEvent?.payload)
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full border-b border-zinc-900 px-2.5 py-1.5 text-left transition-colors last:border-b-0 ${
        selected ? "bg-zinc-800/70" : "hover:bg-zinc-900/70"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-200 lg:text-base">
          <SourceIcon source={task.source} />
          {taskDisplayName(task)}
        </p>
        <TaskStatusBadge status={task.status} className="text-[10px] px-1.5 py-0.5 rounded-md lg:text-sm" />
      </div>
      <p className="mt-0.5 text-[10px] text-zinc-400 lg:text-sm">
        {task.processedItems}
        {total > 0 ? `/${total}` : ""} processed, {task.successfulItems} success, {task.failedItems} failed
      </p>
      {task.playlist?.name && (
        <p className="mt-0.5 text-[10px] text-zinc-500 lg:text-sm">Playlist: {task.playlist.name}</p>
      )}
      {task.lastEvent?.message && (
        <p className="mt-0.5 truncate text-sm text-zinc-500">{task.lastEvent.message}</p>
      )}
      {progressPercent !== null && (
        <p className="mt-0.5 text-sm text-blue-300">
          Progress: {progressPercent}%
          {lastPayload?.speed ? ` @ ${lastPayload.speed}` : ""}
          {lastPayload?.eta ? ` ETA ${lastPayload.eta}` : ""}
        </p>
      )}
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all"
          style={{ width: `${progressPercent ?? 0}%` }}
        />
      </div>
    </button>
  )
}
