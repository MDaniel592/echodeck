"use client"

import { useRef, useEffect } from "react"
import { parseLrc, isLrcFormat } from "../../../lib/lyricsParser"

interface LyricsPanelProps {
  lyrics: string | null
  currentTime: number
}

export default function LyricsPanel({ lyrics, currentTime }: LyricsPanelProps) {
  const activeLineRef = useRef<HTMLParagraphElement | null>(null)

  if (!lyrics) {
    return (
      <div className="h-full overflow-y-auto px-6 py-4 flex items-center justify-center">
        <p className="text-zinc-600 text-sm">No lyrics</p>
      </div>
    )
  }

  if (isLrcFormat(lyrics)) {
    return <SyncedLyrics lyrics={lyrics} currentTime={currentTime} activeLineRef={activeLineRef} />
  }

  return (
    <div className="h-full overflow-y-auto custom-scrollbar px-6 py-4">
      <p className="text-zinc-300 text-sm leading-7 whitespace-pre-wrap">{lyrics}</p>
    </div>
  )
}

function SyncedLyrics({
  lyrics,
  currentTime,
  activeLineRef,
}: {
  lyrics: string
  currentTime: number
  activeLineRef: React.RefObject<HTMLParagraphElement | null>
}) {
  const lines = parseLrc(lyrics)

  const activeIndex = lines
    ? lines.reduce<number>((acc, line, i) => {
        return line.timestamp <= currentTime ? i : acc
      }, -1)
    : -1

  useEffect(() => {
    if (activeLineRef.current) {
      activeLineRef.current.scrollIntoView({ behavior: "smooth", block: "center" })
    }
  }, [activeIndex, activeLineRef])

  if (!lines) {
    return (
      <div className="h-full overflow-y-auto px-6 py-4 flex items-center justify-center">
        <p className="text-zinc-600 text-sm">No lyrics</p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto custom-scrollbar px-6 py-4 flex flex-col items-center gap-2">
      {lines.map((line, i) => {
        const isActive = i === activeIndex
        return (
          <p
            key={i}
            ref={isActive ? activeLineRef : null}
            className={`text-center transition-all duration-300 ${
              isActive
                ? "text-white font-medium scale-105"
                : "text-zinc-500 text-sm"
            }`}
          >
            {line.text || "\u00A0"}
          </p>
        )
      })}
    </div>
  )
}
