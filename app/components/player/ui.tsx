"use client"

import { useEffect, useRef, useState, type CSSProperties } from "react"

export function formatTime(seconds: number): string {
  if (isNaN(seconds)) return "0:00"
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

export function PlayPauseIcon({
  playing,
  large = false,
  xlarge = false,
}: {
  playing: boolean
  large?: boolean
  xlarge?: boolean
}) {
  const isLarge = large || xlarge

  if (playing) {
    return (
      <span className={`inline-flex items-center ${xlarge ? "gap-1.5" : isLarge ? "gap-1" : "gap-[3px]"}`}>
        <span
          className={`${
            xlarge
              ? "h-6 w-[6px]"
              : isLarge
                ? "h-5 w-[5px]"
                : "h-4 w-1"
          } rounded-[1px] bg-current`}
        />
        <span
          className={`${
            xlarge
              ? "h-6 w-[6px]"
              : isLarge
                ? "h-5 w-[5px]"
                : "h-4 w-1"
          } rounded-[1px] bg-current`}
        />
      </span>
    )
  }

  return (
    <span
      className={`block h-0 w-0 border-y-transparent border-l-current ${
        xlarge
          ? "ml-0.5 border-y-[10px] border-l-[16px]"
          : isLarge
            ? "ml-0.5 border-y-[9px] border-l-[14px]"
            : "ml-[1px] border-y-[7px] border-l-[11px]"
      }`}
    />
  )
}

export function MinimizePlayerIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

export function QueueIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M7 7h11" />
      <path d="M7 12h11" />
      <path d="M7 17h11" />
      <circle cx="4" cy="7" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="4" cy="12" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="4" cy="17" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function VolumeIcon({ className = "h-4 w-4 text-zinc-400" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  )
}

export function ShuffleIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
    </svg>
  )
}

export function PrevIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M6 6h2v12H6V6zm3.5 6l8.5 6V6l-8.5 6z" />
    </svg>
  )
}

export function NextIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M6 18l8.5-6L6 6v12zm9-12v12h2V6h-2z" />
    </svg>
  )
}

export function RepeatIcon({
  mode,
  className = "h-5 w-5",
}: {
  mode: "off" | "all" | "one"
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M17 1l4 4-4 4" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="M7 23l-4-4 4-4" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
      {mode === "one" && (
        <text
          x="12"
          y="15"
          fontSize="10"
          fontWeight="700"
          fill="currentColor"
          textAnchor="middle"
          stroke="none"
        >
          1
        </text>
      )}
    </svg>
  )
}

export function ScrollingTitle({
  text,
  className,
  speed = 15,
}: {
  text: string
  className: string
  speed?: number
}) {
  const containerRef = useRef<HTMLSpanElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)
  const MARQUEE_GAP = 28
  const MARQUEE_SPEED = speed
  const [marqueeState, setMarqueeState] = useState({
    enabled: false,
    travel: 0,
    durationSec: 0,
  })

  useEffect(() => {
    let frame = 0

    const update = () => {
      if (!containerRef.current || !measureRef.current) return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const containerWidth = containerRef.current?.clientWidth ?? 0
        const textWidth = measureRef.current?.scrollWidth ?? 0
        const overflow = Math.max(0, textWidth - containerWidth)
        const enabled = overflow > 6
        const travel = enabled ? textWidth + MARQUEE_GAP : 0
        const durationSec = enabled ? Math.max(6, travel / MARQUEE_SPEED) : 0

        setMarqueeState((prev) => {
          if (
            prev.enabled === enabled &&
            Math.abs(prev.travel - travel) < 1 &&
            Math.abs(prev.durationSec - durationSec) < 0.1
          ) {
            return prev
          }

          return {
            enabled,
            travel,
            durationSec,
          }
        })
      })
    }

    update()

    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== "undefined" && containerRef.current && measureRef.current) {
      observer = new ResizeObserver(update)
      observer.observe(containerRef.current)
      observer.observe(measureRef.current)
    }

    if (typeof window !== "undefined") {
      window.addEventListener("resize", update)
    }

    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      if (typeof window !== "undefined") {
        window.removeEventListener("resize", update)
      }
    }
  }, [text, MARQUEE_SPEED])

  const marqueeStyle: CSSProperties | undefined = marqueeState.enabled
    ? ({
        "--player-marquee-travel": `${marqueeState.travel}px`,
        "--player-marquee-duration": `${marqueeState.durationSec}s`,
      } as CSSProperties)
    : undefined

  return (
    <p className={`${className} relative`} title={text}>
      <span ref={containerRef} className="block overflow-hidden whitespace-nowrap">
        {marqueeState.enabled ? (
          <span className="player-marquee-track inline-flex min-w-max whitespace-nowrap" style={marqueeStyle}>
            <span>{text}</span>
            <span className="pl-7" aria-hidden="true">
              {text}
            </span>
          </span>
        ) : (
          <span className="block truncate">{text}</span>
        )}
      </span>
      <span
        ref={measureRef}
        className="pointer-events-none absolute -z-10 opacity-0 whitespace-nowrap select-none"
        aria-hidden="true"
      >
        {text}
      </span>
    </p>
  )
}
