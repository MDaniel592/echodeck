"use client"

import { useCallback, useRef, type MouseEvent, type RefObject, type TouchEvent } from "react"

export function useSeekBarHandlers(
  audioRef: RefObject<HTMLAudioElement | null>,
  barRef: RefObject<HTMLDivElement | null>,
  duration: number,
) {
  const seekingRef = useRef(false)

  const seekToPosition = useCallback((clientX: number) => {
    const audio = audioRef.current
    const bar = barRef.current
    if (!audio || !bar || !duration) return
    const rect = bar.getBoundingClientRect()
    const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    audio.currentTime = pct * duration
  }, [audioRef, barRef, duration])

  const handleClick = useCallback((e: MouseEvent<HTMLDivElement>) => {
    seekToPosition(e.clientX)
  }, [seekToPosition])

  const handleTouchStart = useCallback((e: TouchEvent<HTMLDivElement>) => {
    e.stopPropagation()
    const touch = e.touches[0]
    if (!touch) return
    seekingRef.current = true
    seekToPosition(touch.clientX)
  }, [seekToPosition])

  const handleTouchMove = useCallback((e: TouchEvent<HTMLDivElement>) => {
    if (!seekingRef.current) return
    e.stopPropagation()
    const touch = e.touches[0]
    if (!touch) return
    seekToPosition(touch.clientX)
  }, [seekToPosition])

  const handleTouchEnd = useCallback((e: TouchEvent<HTMLDivElement>) => {
    e.stopPropagation()
    seekingRef.current = false
  }, [])

  return [handleClick, handleTouchStart, handleTouchMove, handleTouchEnd] as const
}
