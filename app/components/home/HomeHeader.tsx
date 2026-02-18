"use client"

import type { ComponentProps } from "react"
import Image from "next/image"
import LibraryToolbar from "../library/LibraryToolbar"
import { DownloadTabIcon, GitHubIcon, LibraryTabIcon, LogoutIcon } from "./HomeIcons"
import type { HomeTab } from "./types"

interface HomeHeaderProps {
  activeTab: HomeTab
  onActiveTabChange: (tab: HomeTab) => void
  songsCount: number
  appVersion: string
  onLogout: () => void
  toolbarProps: ComponentProps<typeof LibraryToolbar>
}

export default function HomeHeader({
  activeTab,
  onActiveTabChange,
  songsCount,
  appVersion,
  onLogout,
  toolbarProps,
}: HomeHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0a0f1a]/75 backdrop-blur-2xl">
      <div className="w-full px-2.5 sm:px-6">
        <div className="flex h-10 items-center gap-2 md:h-14 md:gap-3 lg:h-16">
          <Image
            src="/EchoDeck.png"
            alt="EchoDeck"
            width={542}
            height={391}
            priority
            className="h-5 w-auto select-none shrink-0 md:h-7 lg:h-8"
          />

          <nav className="flex items-center rounded-xl px-0.5 py-0.5 md:px-1.5 md:py-1 lg:px-2 lg:py-1.5">
            <button
              type="button"
              onClick={() => onActiveTabChange("player")}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-all md:gap-1.5 md:px-4 md:py-2 md:text-sm lg:px-5 lg:py-2.5 lg:text-base ${
                activeTab === "player"
                  ? "bg-gradient-to-r from-sky-300 to-emerald-300 text-slate-900 shadow-sm"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              <LibraryTabIcon />
              Library
            </button>
            <span className="mx-1 h-5 w-px bg-white/15 md:h-6 lg:h-7" aria-hidden="true" />
            <button
              type="button"
              onClick={() => onActiveTabChange("download")}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-all md:gap-1.5 md:px-4 md:py-2 md:text-sm lg:px-5 lg:py-2.5 lg:text-base ${
                activeTab === "download"
                  ? "bg-gradient-to-r from-sky-300 to-emerald-300 text-slate-900 shadow-sm"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              <DownloadTabIcon />
              Download
            </button>
          </nav>

          <div className="flex-1" />

          <span className="hidden sm:inline text-xs text-zinc-400 tabular-nums md:text-sm lg:text-base">
            {songsCount} {songsCount === 1 ? "track" : "tracks"}
          </span>

          <button
            type="button"
            onClick={() => onActiveTabChange("manage")}
            className="hidden sm:inline-flex h-8 items-center rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-zinc-200 hover:bg-white/10 md:text-sm"
          >
            Manage
          </button>

          <button
            type="button"
            onClick={() => onActiveTabChange("organize")}
            className="hidden sm:inline-flex h-8 items-center rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-zinc-200 hover:bg-white/10 md:text-sm"
          >
            Organize
          </button>

          <button
            type="button"
            onClick={() => onActiveTabChange("maintenance")}
            className="hidden sm:inline-flex h-8 items-center rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-zinc-200 hover:bg-white/10 md:text-sm"
          >
            Maintenance
          </button>

          <span className="hidden sm:inline-flex h-8 items-center rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-zinc-400 md:text-sm">
            v{appVersion}
          </span>

          <a
            href="https://github.com/MDaniel592/echodeck"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 text-[11px] text-zinc-200 transition-colors hover:bg-white/10 md:h-8 md:gap-2 md:px-3 md:text-sm"
            aria-label="Open EchoDeck GitHub repository"
            title="GitHub repository"
          >
            <GitHubIcon />
            <span className="hidden md:inline">GitHub</span>
          </a>

          <button
            type="button"
            onClick={onLogout}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100 md:h-8 md:w-8"
            aria-label="Logout"
            title="Logout"
          >
            <LogoutIcon />
          </button>
        </div>

        {activeTab === "player" && <LibraryToolbar {...toolbarProps} />}
      </div>
    </header>
  )
}
