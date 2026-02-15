"use client"

import { type ReactNode } from "react"

function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v2H3V7z" />
      <rect x="3" y="11" width="18" height="9" rx="2" />
      {open && <path d="M7 15h10" />}
    </svg>
  )
}

interface LibraryGroupFolderProps {
  label: string
  count: number
  isOpen: boolean
  onToggle: () => void
  children: ReactNode
}

export default function LibraryGroupFolder({
  label,
  count,
  isOpen,
  onToggle,
  children,
}: LibraryGroupFolderProps) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-white/[0.04] sm:px-4"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-2.5">
          <span className={isOpen ? "text-sky-300" : "text-zinc-300"}>
            <FolderIcon open={isOpen} />
          </span>
          <h3 className={`text-sm font-semibold tracking-wide ${isOpen ? "text-sky-100" : "text-zinc-100"}`}>{label}</h3>
        </div>
        <span className="text-xs text-zinc-400 tabular-nums">{count} tracks</span>
      </button>
      {isOpen ? (
        <div className="border-t border-white/10 p-2.5 sm:p-3">{children}</div>
      ) : null}
    </section>
  )
}
