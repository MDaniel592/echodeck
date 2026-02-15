"use client"

import { useState, useRef, useEffect, useLayoutEffect, useCallback, type CSSProperties } from "react"
import { queuePositionLabel } from "../../lib/playbackQueue"

interface Song {
  id: number
  title: string
  artist: string | null
  duration: number | null
  format: string
  quality: string | null
  source: string
  sourceUrl: string | null
  filePath: string
  coverPath: string | null
  thumbnail: string | null
  fileSize: number | null
  playlistId: number | null
  createdAt: string
}

interface PlayerProps {
  song: Song | null
  songs: Song[]
  onSongChange: (song: Song) => void
  onQueueReorder?: (fromIndex: number, toIndex: number) => void
  onQueueRemove?: (songId: number, index: number) => void
  onQueueClear?: () => void
  onPlaybackStateChange?: (state: {
    positionSec: number
    isPlaying: boolean
    repeatMode: RepeatMode
    shuffle: boolean
  }) => void
}

type RepeatMode = "off" | "all" | "one"
const MOBILE_EXPAND_MS = 720
const MOBILE_COLLAPSE_MS = 480
const MOBILE_FADE_MS = 190
const MINI_FADE_MS = 250
const QUEUE_CLOSE_DRAG_THRESHOLD = 96
const MOBILE_EXPAND_EASE = "cubic-bezier(0.22, 1, 0.36, 1)"
const MOBILE_COLLAPSE_EASE = "cubic-bezier(0.4, 0, 1, 1)"
const MEDIA_SESSION_ACTIONS: MediaSessionAction[] = [
  "play",
  "pause",
  "previoustrack",
  "nexttrack",
  "seekbackward",
  "seekforward",
  "seekto",
]

function formatTime(seconds: number): string {
  if (isNaN(seconds)) return "0:00"
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

function PlayPauseIcon({
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

function MinimizePlayerIcon() {
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

function QueueIcon() {
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

function TrashIcon({ className = "h-4 w-4" }: { className?: string }) {
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
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M6 6l1 14h10l1-14" />
    </svg>
  )
}

function XIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  )
}

function VolumeIcon({ className = "h-4 w-4 text-zinc-400" }: { className?: string }) {
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

function ShuffleIcon({ className = "h-5 w-5" }: { className?: string }) {
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

function PrevIcon({ className = "h-5 w-5" }: { className?: string }) {
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

function NextIcon({ className = "h-5 w-5" }: { className?: string }) {
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

function RepeatIcon({ mode, className = "h-5 w-5" }: { mode: RepeatMode; className?: string }) {
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

function ScrollingTitle({
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

// Shared seek-by-touch/click logic for progress bars
function useSeekBarHandlers(
  audioRef: React.RefObject<HTMLAudioElement | null>,
  barRef: React.RefObject<HTMLDivElement | null>,
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

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    seekToPosition(e.clientX)
  }, [seekToPosition])

  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation()
    const touch = e.touches[0]
    if (!touch) return
    seekingRef.current = true
    seekToPosition(touch.clientX)
  }, [seekToPosition])

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (!seekingRef.current) return
    e.stopPropagation()
    const touch = e.touches[0]
    if (!touch) return
    seekToPosition(touch.clientX)
  }, [seekToPosition])

  const handleTouchEnd = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation()
    seekingRef.current = false
  }, [])

  return [handleClick, handleTouchStart, handleTouchMove, handleTouchEnd] as const
}

export default function Player({
  song,
  songs,
  onSongChange,
  onQueueReorder,
  onQueueRemove,
  onQueueClear,
  onPlaybackStateChange,
}: PlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const miniArtworkRef = useRef<HTMLDivElement>(null)
  const fullArtworkRef = useRef<HTMLDivElement>(null)
  const mobileTouchStartYRef = useRef<number | null>(null)
  const miniTouchStartYRef = useRef<number | null>(null)
  const miniTouchStartTimeRef = useRef<number | null>(null)
  const queueTouchStartYRef = useRef<number | null>(null)
  const miniExpandTriggeredRef = useRef(false)
  const mobileCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mobileExpandTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(0.3)
  const [shuffleEnabled, setShuffleEnabled] = useState(false)
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("off")
  const [isMobileViewport, setIsMobileViewport] = useState(false)
  const [isMobileCollapsed, setIsMobileCollapsed] = useState(true)
  const [mobileDragOffset, setMobileDragOffset] = useState(0)
  const [isMobileDragging, setIsMobileDragging] = useState(false)
  const [isMobileExpanding, setIsMobileExpanding] = useState(false)
  const [isMobileCollapsing, setIsMobileCollapsing] = useState(false)
  const [mobileExpandStartOffset, setMobileExpandStartOffset] = useState(0)
  const [miniDragOffset, setMiniDragOffset] = useState(0)
  const [isMiniDragging, setIsMiniDragging] = useState(false)
  const [isQueueSheetOpen, setIsQueueSheetOpen] = useState(false)
  const [showQueueClearConfirm, setShowQueueClearConfirm] = useState(false)
  const [queueDragOffset, setQueueDragOffset] = useState(0)
  const [isQueueDragging, setIsQueueDragging] = useState(false)
  const [artworkFlip, setArtworkFlip] = useState({ dx: 0, dy: 0, scale: 1 })
  const defaultDocumentTitleRef = useRef<string>("EchoDeck")
  const lastPlaybackSnapshotRef = useRef<string>("")

  const currentIndex = song ? songs.findIndex((s) => s.id === song.id) : -1

  const getRandomIndex = useCallback(() => {
    if (songs.length < 2 || currentIndex < 0) return null
    let nextIndex = currentIndex
    while (nextIndex === currentIndex) {
      nextIndex = Math.floor(Math.random() * songs.length)
    }
    return nextIndex
  }, [songs.length, currentIndex])

  const getPrevIndex = useCallback(() => {
    if (currentIndex < 0) return null

    if (shuffleEnabled) {
      const randomIndex = getRandomIndex()
      if (randomIndex !== null) return randomIndex
    }

    if (currentIndex > 0) return currentIndex - 1
    if (repeatMode === "all") return songs.length - 1
    return null
  }, [currentIndex, shuffleEnabled, getRandomIndex, repeatMode, songs.length])

  const getNextIndex = useCallback(() => {
    if (currentIndex < 0) return null

    if (shuffleEnabled) {
      const randomIndex = getRandomIndex()
      if (randomIndex !== null) return randomIndex
    }

    if (currentIndex < songs.length - 1) return currentIndex + 1
    if (repeatMode === "all") return 0
    return null
  }, [currentIndex, shuffleEnabled, getRandomIndex, repeatMode, songs.length])

  const playPrev = useCallback(() => {
    const prevIndex = getPrevIndex()
    if (prevIndex !== null) onSongChange(songs[prevIndex])
  }, [getPrevIndex, onSongChange, songs])

  const playNext = useCallback(() => {
    const nextIndex = getNextIndex()
    if (nextIndex !== null) onSongChange(songs[nextIndex])
  }, [getNextIndex, onSongChange, songs])

  const emitPlaybackState = useCallback((timeSec: number, isPlayingValue: boolean) => {
    if (!onPlaybackStateChange) return
    const payload = {
      positionSec: Math.max(0, Math.round(timeSec)),
      isPlaying: isPlayingValue,
      repeatMode,
      shuffle: shuffleEnabled,
    }
    const serialized = JSON.stringify(payload)
    if (serialized === lastPlaybackSnapshotRef.current) return
    lastPlaybackSnapshotRef.current = serialized
    onPlaybackStateChange(payload)
  }, [onPlaybackStateChange, repeatMode, shuffleEnabled])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !song) return

    audio.src = `/api/stream/${song.id}`
    audio.currentTime = 0
    audio.volume = volume
    audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
  }, [song?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime)
      emitPlaybackState(audio.currentTime, !audio.paused)
    }
    const onDurationChange = () => setDuration(audio.duration)
    const onPlay = () => {
      setPlaying(true)
      emitPlaybackState(audio.currentTime, true)
    }
    const onPause = () => {
      setPlaying(false)
      emitPlaybackState(audio.currentTime, false)
    }
    const onEnded = () => {
      if (repeatMode === "one") {
        audio.currentTime = 0
        audio.play().catch(() => setPlaying(false))
        return
      }

      const nextIndex = getNextIndex()
      if (nextIndex === null) {
        setPlaying(false)
        return
      }
      onSongChange(songs[nextIndex])
    }

    audio.addEventListener("timeupdate", onTimeUpdate)
    audio.addEventListener("durationchange", onDurationChange)
    audio.addEventListener("play", onPlay)
    audio.addEventListener("pause", onPause)
    audio.addEventListener("ended", onEnded)

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate)
      audio.removeEventListener("durationchange", onDurationChange)
      audio.removeEventListener("play", onPlay)
      audio.removeEventListener("pause", onPause)
      audio.removeEventListener("ended", onEnded)
    }
  }, [emitPlaybackState, getNextIndex, onSongChange, repeatMode, songs])

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
      setPlaying(false)
    } else {
      audio.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
    }
  }, [playing])

  function changeVolume(e: React.ChangeEvent<HTMLInputElement>) {
    const val = parseFloat(e.target.value)
    setVolume(val)
    if (audioRef.current) audioRef.current.volume = val
  }

  function cycleRepeatMode() {
    setRepeatMode((prev) => {
      if (prev === "off") return "all"
      if (prev === "all") return "one"
      return "off"
    })
  }

  const canGoPrev =
    currentIndex >= 0 &&
    (shuffleEnabled
      ? songs.length > 1 || repeatMode === "all"
      : currentIndex > 0 || repeatMode === "all")

  const canGoNext =
    currentIndex >= 0 &&
    (shuffleEnabled
      ? songs.length > 1 || repeatMode === "all"
      : currentIndex < songs.length - 1 || repeatMode === "all")
  const queuePosition = queuePositionLabel(currentIndex, songs.length)

  useEffect(() => {
    if (typeof document === "undefined") return
    defaultDocumentTitleRef.current = document.title || "EchoDeck"
  }, [])

  useEffect(() => {
    if (typeof document === "undefined") return

    if (song?.title?.trim()) {
      document.title = song.title
      return
    }

    document.title = defaultDocumentTitleRef.current
  }, [song?.title])

  useEffect(() => {
    if (typeof window === "undefined" || !("mediaSession" in navigator)) return

    const mediaSession = navigator.mediaSession
    const setHandler = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        mediaSession.setActionHandler(action, handler)
      } catch {
        // Ignore unsupported actions per browser.
      }
    }

    mediaSession.playbackState = song
      ? (playing ? "playing" : "paused")
      : "none"

    if (song && "MediaMetadata" in window) {
      const artworkUrl = song.coverPath
        ? `${window.location.origin}/api/cover/${song.id}`
        : song.thumbnail
          ? new URL(song.thumbnail, window.location.origin).toString()
          : null

      mediaSession.metadata = new MediaMetadata({
        title: song.title,
        artist: song.artist || "Unknown Artist",
        artwork: artworkUrl
          ? [
              { src: artworkUrl, sizes: "96x96", type: "image/jpeg" },
              { src: artworkUrl, sizes: "192x192", type: "image/jpeg" },
              { src: artworkUrl, sizes: "512x512", type: "image/jpeg" },
            ]
          : [],
      })
    } else {
      mediaSession.metadata = null
    }

    setHandler("play", () => {
      const audio = audioRef.current
      if (!audio) return
      audio.play().catch(() => setPlaying(false))
    })
    setHandler("pause", () => {
      const audio = audioRef.current
      if (!audio) return
      audio.pause()
    })
    setHandler("previoustrack", canGoPrev ? playPrev : null)
    setHandler("nexttrack", canGoNext ? playNext : null)
    setHandler("seekbackward", (details) => {
      const audio = audioRef.current
      if (!audio) return
      const seekOffset = details.seekOffset ?? 10
      audio.currentTime = Math.max(0, audio.currentTime - seekOffset)
    })
    setHandler("seekforward", (details) => {
      const audio = audioRef.current
      if (!audio) return
      const seekOffset = details.seekOffset ?? 10
      const maxTime = Number.isFinite(audio.duration) ? audio.duration : audio.currentTime + seekOffset
      audio.currentTime = Math.min(maxTime, audio.currentTime + seekOffset)
    })
    setHandler("seekto", (details) => {
      const audio = audioRef.current
      if (!audio || details.seekTime === undefined) return
      const maxTime = Number.isFinite(audio.duration) ? audio.duration : details.seekTime
      audio.currentTime = Math.max(0, Math.min(details.seekTime, maxTime))
    })

    return () => {
      for (const action of MEDIA_SESSION_ACTIONS) {
        setHandler(action, null)
      }
    }
  }, [song, playing, canGoPrev, canGoNext, playPrev, playNext])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!song) return
      const activeElement = document.activeElement
      const isTyping =
        activeElement?.tagName === "INPUT" ||
        activeElement?.tagName === "TEXTAREA" ||
        activeElement?.tagName === "SELECT" ||
        (activeElement instanceof HTMLElement && activeElement.isContentEditable)
      if (isTyping || e.altKey || e.metaKey || e.ctrlKey) return

      if (e.code === "Space") {
        e.preventDefault()
        togglePlay()
        return
      }

      if (e.key === "ArrowRight") {
        e.preventDefault()
        const audio = audioRef.current
        if (!audio) return
        const maxTime = Number.isFinite(audio.duration) ? audio.duration : audio.currentTime + 5
        audio.currentTime = Math.min(maxTime, audio.currentTime + 5)
        return
      }

      if (e.key === "ArrowLeft") {
        e.preventDefault()
        const audio = audioRef.current
        if (!audio) return
        audio.currentTime = Math.max(0, audio.currentTime - 5)
        return
      }

      if (e.key === "ArrowUp" && canGoPrev) {
        e.preventDefault()
        playPrev()
        return
      }

      if (e.key === "ArrowDown" && canGoNext) {
        e.preventDefault()
        playNext()
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [song, canGoPrev, canGoNext, playPrev, playNext, togglePlay])

  useEffect(() => {
    if (typeof window === "undefined" || !("mediaSession" in navigator)) return
    if (!song || !Number.isFinite(duration) || duration <= 0) return
    if (typeof navigator.mediaSession.setPositionState !== "function") return

    try {
      navigator.mediaSession.setPositionState({
        duration,
        position: Math.min(currentTime, duration),
        playbackRate: 1,
      })
    } catch {
      // Position state can throw when browser cannot determine timeline.
    }
  }, [song, duration, currentTime])

  useEffect(() => {
    if (!song || !onPlaybackStateChange) return
    emitPlaybackState(currentTime, playing)
  }, [song, currentTime, playing, repeatMode, shuffleEnabled, emitPlaybackState, onPlaybackStateChange])

  const songId = song?.id ?? null

  // Seek bar hooks (must be called unconditionally)
  const mobileSeekBarRef = useRef<HTMLDivElement>(null)
  const desktopSeekBarRef = useRef<HTMLDivElement>(null)
  const [
    handleMobileSeekClick,
    handleMobileSeekTouchStart,
    handleMobileSeekTouchMove,
    handleMobileSeekTouchEnd,
  ] = useSeekBarHandlers(audioRef, mobileSeekBarRef, duration)
  const [
    handleDesktopSeekClick,
    handleDesktopSeekTouchStart,
    handleDesktopSeekTouchMove,
    handleDesktopSeekTouchEnd,
  ] = useSeekBarHandlers(audioRef, desktopSeekBarRef, duration)

  useEffect(() => {
    if (typeof window === "undefined") return

    const query = window.matchMedia("(max-width: 767px)")
    const syncViewport = () => setIsMobileViewport(query.matches)
    syncViewport()

    query.addEventListener("change", syncViewport)
    return () => query.removeEventListener("change", syncViewport)
  }, [])

  const isMobileExpanded =
    isMobileViewport &&
    songId !== null &&
    !isMobileCollapsed

  useEffect(() => {
    if (!isMobileViewport || !isMobileExpanded) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [isMobileViewport, isMobileExpanded])

  // FLIP measurement: compute dx, dy, scale between mini and full artwork **natural**
  // (at-rest) positions. Always compensates for the panel's current translateY so that
  // the stored values are independent of the panel offset.
  const mobileDragOffsetRef = useRef(mobileDragOffset)
  useEffect(() => {
    mobileDragOffsetRef.current = mobileDragOffset
  }, [mobileDragOffset])

  const measureFlip = useCallback(() => {
    const miniEl = miniArtworkRef.current
    const fullEl = fullArtworkRef.current
    if (!miniEl || !fullEl) return

    const miniRect = miniEl.getBoundingClientRect()
    const fullRect = fullEl.getBoundingClientRect()

    // getBoundingClientRect includes the parent panel's translateY.
    // Subtract it to get the full artwork's natural resting position.
    const panelY = mobileDragOffsetRef.current

    setArtworkFlip({
      dx: (miniRect.left + miniRect.width / 2) - (fullRect.left + fullRect.width / 2),
      dy: (miniRect.top + miniRect.height / 2) - (fullRect.top + fullRect.height / 2 - panelY),
      scale: miniRect.width / fullRect.width,
    })
  }, [])

  // Measure on initial mount (before first paint).
  useLayoutEffect(() => {
    if (!isMobileExpanded) return
    measureFlip()
  }, [isMobileExpanded, measureFlip])

  // Re-measure when the panel settles at rest (after expand completes). At this point
  // the viewport reflects the actual browser state (toolbar may have changed).
  // Also register resize handler only while at rest (no FLIP transforms applied).
  useEffect(() => {
    if (!isMobileExpanded || isMobileExpanding || isMobileCollapsing || isMobileDragging) return
    measureFlip()
    window.addEventListener("resize", measureFlip)
    return () => window.removeEventListener("resize", measureFlip)
  }, [isMobileExpanded, isMobileExpanding, isMobileCollapsing, isMobileDragging, measureFlip])

  useEffect(() => {
    return () => {
      if (mobileCloseTimeoutRef.current) {
        clearTimeout(mobileCloseTimeoutRef.current)
      }
      if (mobileExpandTimeoutRef.current) {
        clearTimeout(mobileExpandTimeoutRef.current)
      }
    }
  }, [])

  // Fix #8: clear isMobileExpanding if the effect re-runs (e.g. song changes mid-expand)
  useEffect(() => {
    if (!isMobileExpanded) {
      if (!isMobileExpanding) return
      const resetTimer = setTimeout(() => {
        setIsMobileExpanding(false)
      }, 0)
      return () => clearTimeout(resetTimer)
    }
    if (!isMobileExpanding) {
      return
    }
    let frameA = 0
    let frameB = 0
    frameA = requestAnimationFrame(() => {
      frameB = requestAnimationFrame(() => {
        setMobileDragOffset(0)
      })
    })
    mobileExpandTimeoutRef.current = setTimeout(() => {
      setIsMobileExpanding(false)
      mobileExpandTimeoutRef.current = null
    }, MOBILE_EXPAND_MS)
    return () => {
      cancelAnimationFrame(frameA)
      cancelAnimationFrame(frameB)
      if (mobileExpandTimeoutRef.current) {
        clearTimeout(mobileExpandTimeoutRef.current)
        mobileExpandTimeoutRef.current = null
      }
    }
  }, [isMobileExpanding, isMobileExpanded])

  if (!song) {
    return (
      <>
        <audio ref={audioRef} />
        <div className="fixed bottom-0 left-0 right-0 z-[70] border-t border-zinc-800/80 bg-[linear-gradient(180deg,rgba(39,39,42,0.90)_0%,rgba(24,24,27,0.88)_100%)] backdrop-blur-xl shadow-[0_-18px_40px_rgba(0,0,0,0.55)] px-3 sm:px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <div className="max-w-5xl mx-auto text-center text-zinc-600 text-sm">
            Select a song to play
          </div>
        </div>
      </>
    )
  }

  const progress = duration ? (currentTime / duration) * 100 : 0
  const coverSrc = song.coverPath ? `/api/cover/${song.id}` : song.thumbnail
  const repeatTitle =
    repeatMode === "off"
      ? "Repeat off"
      : repeatMode === "all"
      ? "Repeat all"
      : "Repeat one"
  const isMobileTransitioning = isMobileExpanding || isMobileCollapsing || isMobileDragging
  const mobileExpandProgress =
    isMobileTransitioning && mobileExpandStartOffset > 0
      ? Math.min(1, Math.max(0, 1 - (mobileDragOffset / mobileExpandStartOffset)))
      : 1
  const collapseMergeProgress =
    isMobileTransitioning
      ? Math.min(1, Math.max(0, 1 - mobileExpandProgress))
      : 0
  // Mini player only shows after 70% collapse progress for seamless FLIP handoff
  const miniRevealOpacity =
    isMobileTransitioning
      ? Math.min(1, Math.max(0, collapseMergeProgress > 0.7 ? (collapseMergeProgress - 0.7) / 0.3 : 0))
      : 0
  // Fix #7: softer opacity curve — delay fade-in until overlay is 30% visible
  const expandedDetailsProgress =
    isMobileTransitioning
      ? Math.min(1, Math.max(0, mobileExpandProgress < 0.3 ? 0 : (mobileExpandProgress - 0.3) / 0.7))
      : 1
  // Dynamic FLIP-based artwork transforms.
  // artworkFlip.dy is the natural offset (mini - full, at rest). But the artwork is a
  // child of the sliding panel, which adds its own translateY during transition. We
  // subtract the panel travel distance so the artwork counteracts the panel movement
  // and lands exactly on the mini player artwork.
  const panelTravel = mobileExpandStartOffset > 0 ? mobileExpandStartOffset : 0
  const artworkScale =
    1 - (1 - artworkFlip.scale) * collapseMergeProgress
  const artworkTranslateX =
    artworkFlip.dx * collapseMergeProgress
  const artworkTranslateY =
    (artworkFlip.dy - panelTravel) * collapseMergeProgress
  // Dynamic border-radius: 12px expanded → visually 4px at mini position
  const artworkBorderRadius =
    12 - (12 - 4 / artworkScale) * collapseMergeProgress

  function resetMobileDragState() {
    mobileTouchStartYRef.current = null
    setMobileDragOffset(0)
    setIsMobileDragging(false)
  }

  function resetMiniDragState() {
    miniTouchStartYRef.current = null
    miniTouchStartTimeRef.current = null
    miniExpandTriggeredRef.current = false
    setMiniDragOffset(0)
    setIsMiniDragging(false)
  }

  function closeQueueSheet() {
    queueTouchStartYRef.current = null
    setQueueDragOffset(0)
    setIsQueueDragging(false)
    setIsQueueSheetOpen(false)
    setShowQueueClearConfirm(false)
  }

  function openQueueSheet() {
    queueTouchStartYRef.current = null
    setQueueDragOffset(0)
    setIsQueueDragging(false)
    setIsQueueSheetOpen(true)
  }

  function toggleQueueSheet() {
    if (isQueueSheetOpen) {
      closeQueueSheet()
      return
    }
    openQueueSheet()
  }

  function expandMobilePlayer() {
    if (typeof window !== "undefined") {
      const startOffset = Math.max(window.innerHeight - 78, 280)
      setMobileExpandStartOffset(startOffset)
      setMobileDragOffset(startOffset)
      setIsMobileCollapsing(false)
      setIsMobileExpanding(true)
    }
    setIsMobileCollapsed(false)
    closeQueueSheet()
    resetMiniDragState()
  }

  function minimizeMobilePlayer(animate = true) {
    // Re-measure FLIP right before collapse for accurate positions.
    // Only when panel is at rest (no FLIP transforms polluting getBoundingClientRect).
    if (mobileDragOffset === 0) {
      measureFlip()
    }

    if (mobileCloseTimeoutRef.current) {
      clearTimeout(mobileCloseTimeoutRef.current)
      mobileCloseTimeoutRef.current = null
    }
    if (mobileExpandTimeoutRef.current) {
      clearTimeout(mobileExpandTimeoutRef.current)
      mobileExpandTimeoutRef.current = null
    }
    setIsMobileExpanding(false)
    closeQueueSheet()

    if (!animate || typeof window === "undefined") {
      setIsMobileCollapsed(true)
      setIsMobileCollapsing(false)
      setMobileExpandStartOffset(0)
      resetMobileDragState()
      return
    }

    const endOffset =
      mobileExpandStartOffset > 0
        ? mobileExpandStartOffset
        : Math.max(window.innerHeight - 78, 280)
    setMobileExpandStartOffset(endOffset)
    setIsMobileDragging(false)
    setIsMobileCollapsing(true)
    setMobileDragOffset(endOffset)

    mobileCloseTimeoutRef.current = setTimeout(() => {
      setIsMobileCollapsed(true)
      setIsMobileCollapsing(false)
      setMobileExpandStartOffset(0)
      resetMobileDragState()
      mobileCloseTimeoutRef.current = null
    }, MOBILE_COLLAPSE_MS)
  }

  function handleMobileOverlayTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    if (mobileCloseTimeoutRef.current) return
    const touch = e.touches[0]
    if (!touch) return
    if (typeof window !== "undefined" && mobileExpandStartOffset === 0) {
      setMobileExpandStartOffset(Math.max(window.innerHeight - 78, 280))
    }
    setIsMobileCollapsing(false)
    mobileTouchStartYRef.current = touch.clientY
    setIsMobileDragging(true)
  }

  function handleMobileOverlayTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    if (mobileTouchStartYRef.current === null) return
    const touch = e.touches[0]
    if (!touch) return
    const deltaY = touch.clientY - mobileTouchStartYRef.current
    const maxOffset =
      mobileExpandStartOffset > 0
        ? mobileExpandStartOffset
        : (typeof window !== "undefined" ? Math.max(window.innerHeight - 78, 280) : 320)
    setMobileDragOffset(deltaY > 0 ? Math.min(deltaY, maxOffset) : 0)
  }

  function handleMobileOverlayTouchEnd() {
    if (mobileDragOffset > 110) {
      minimizeMobilePlayer(true)
      return
    }
    resetMobileDragState()
  }

  function handleMiniPlayerTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    if (mobileCloseTimeoutRef.current) return
    const touch = e.touches[0]
    if (!touch) return
    miniTouchStartYRef.current = touch.clientY
    miniTouchStartTimeRef.current = Date.now()
    miniExpandTriggeredRef.current = false
    setIsMiniDragging(true)
  }

  function handleMiniPlayerTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    if (miniTouchStartYRef.current === null) return
    const touch = e.touches[0]
    if (!touch) return
    const deltaY = touch.clientY - miniTouchStartYRef.current
    if (deltaY < 0) {
      e.preventDefault()
      setMiniDragOffset(Math.max(deltaY, -140))
      if (deltaY <= -52 && !miniExpandTriggeredRef.current) {
        miniExpandTriggeredRef.current = true
        expandMobilePlayer()
      }
      return
    }
    setMiniDragOffset(0)
  }

  function handleMiniPlayerTouchEnd() {
    if (miniExpandTriggeredRef.current) {
      resetMiniDragState()
      return
    }

    const startedAt = miniTouchStartTimeRef.current
    const durationMs = startedAt === null ? null : Date.now() - startedAt
    const isQuickFlick = durationMs !== null && durationMs < 220 && miniDragOffset < -24

    if (miniDragOffset < -56 || isQuickFlick) {
      expandMobilePlayer()
      return
    }
    resetMiniDragState()
  }

  function handleQueueSheetTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    const touch = e.touches[0]
    if (!touch) return
    queueTouchStartYRef.current = touch.clientY
    setIsQueueDragging(true)
  }

  function handleQueueSheetTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    if (queueTouchStartYRef.current === null) return
    const touch = e.touches[0]
    if (!touch) return
    const deltaY = touch.clientY - queueTouchStartYRef.current

    if (deltaY <= 0) {
      setQueueDragOffset(0)
      return
    }

    e.preventDefault()
    setQueueDragOffset(Math.min(deltaY, 280))
  }

  function handleQueueSheetTouchEnd() {
    if (queueDragOffset > QUEUE_CLOSE_DRAG_THRESHOLD) {
      closeQueueSheet()
      return
    }
    queueTouchStartYRef.current = null
    setQueueDragOffset(0)
    setIsQueueDragging(false)
  }

  function moveQueueItem(fromIndex: number, toIndex: number) {
    if (!onQueueReorder) return
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= songs.length || toIndex >= songs.length) return
    if (fromIndex === toIndex) return
    onQueueReorder(fromIndex, toIndex)
  }

  function removeQueueItem(songId: number, index: number) {
    if (!onQueueRemove) return
    onQueueRemove(songId, index)
  }

  if (isMobileViewport) {
    const miniOpacity = isMobileExpanded
      ? miniRevealOpacity
      : 1

    return (
      <>
        <audio ref={audioRef} />
        <div
          className="fixed bottom-0 left-0 right-0 z-[60] border-t border-zinc-800/80 bg-[linear-gradient(180deg,rgba(39,39,42,0.90)_0%,rgba(24,24,27,0.88)_100%)] backdrop-blur-xl shadow-[0_-18px_40px_rgba(0,0,0,0.55)] px-3 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]"
          style={{
            transform: `translateY(${miniDragOffset}px)`,
            opacity: miniOpacity,
            transition: isMiniDragging || isMobileTransitioning
              ? "none"
              : `transform 180ms ${MOBILE_EXPAND_EASE}, opacity ${MINI_FADE_MS}ms ${MOBILE_EXPAND_EASE}`,
            touchAction: "none",
            pointerEvents: isMobileExpanded ? "none" : "auto",
          }}
          onTouchStart={handleMiniPlayerTouchStart}
          onTouchMove={handleMiniPlayerTouchMove}
          onTouchEnd={handleMiniPlayerTouchEnd}
          onTouchCancel={handleMiniPlayerTouchEnd}
        >
          <div className="max-w-5xl mx-auto flex items-center justify-between">
            <div className="flex-1 min-w-0 flex items-center gap-3 text-left">
              <div ref={miniArtworkRef} className="h-12 w-12 rounded overflow-hidden bg-zinc-800 shrink-0 flex items-center justify-center">
                {coverSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={coverSrc}
                    alt={`${song.title} cover`}
                    className="w-full h-full object-cover"
                    style={{
                      opacity: isMobileExpanded ? miniRevealOpacity : 1,
                    }}
                  />
                ) : (
                  <span className="text-zinc-500 text-xs">♪</span>
                )}
              </div>
              <div className="min-w-0">
                <ScrollingTitle
                  text={song.title}
                  className="text-sm font-medium text-white"
                  speed={12}
                />
                <p className="text-xs text-zinc-500 truncate">{song.artist || "Unknown Artist"}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={togglePlay}
              className="h-12 w-12 flex items-center justify-center text-white"
              aria-label={playing ? "Pause" : "Play"}
            >
              <PlayPauseIcon playing={playing} />
            </button>
          </div>
        </div>

        {isMobileExpanded && (
          <div
            className="fixed inset-0 z-[65] bg-[#121212] text-white flex flex-col px-3 sm:px-5 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl"
            style={{
              transform: `translate3d(0, ${mobileDragOffset}px, 0)`,
              touchAction: "none",
              transition: isMobileDragging
                ? "none"
                : isMobileCollapsing
                ? `transform ${MOBILE_COLLAPSE_MS}ms ${MOBILE_COLLAPSE_EASE}`
                : isMobileTransitioning
                ? `transform ${MOBILE_EXPAND_MS}ms ${MOBILE_EXPAND_EASE}`
                : `transform 220ms ${MOBILE_EXPAND_EASE}`,
            }}
            onTouchStart={handleMobileOverlayTouchStart}
            onTouchMove={handleMobileOverlayTouchMove}
            onTouchEnd={handleMobileOverlayTouchEnd}
            onTouchCancel={handleMobileOverlayTouchEnd}
          >
            <div
              className="flex items-center justify-between"
              style={{
                opacity: expandedDetailsProgress,
                transform: `translateY(${(1 - expandedDetailsProgress) * 10}px)`,
                transition: isMobileDragging
                  ? "none"
                  : `opacity ${MOBILE_FADE_MS}ms ${MOBILE_EXPAND_EASE}, transform ${MOBILE_FADE_MS}ms ${MOBILE_EXPAND_EASE}`,
              }}
            >
              <button
                type="button"
                onClick={() => minimizeMobilePlayer(true)}
                className="h-9 w-9 inline-flex items-center justify-center rounded-full text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
                aria-label="Minimize player"
              >
                <MinimizePlayerIcon />
              </button>
              <button
                type="button"
                onClick={toggleQueueSheet}
                disabled={songs.length === 0}
                className={`h-9 w-9 inline-flex items-center justify-center rounded-full transition-colors ${
                  isQueueSheetOpen
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-400 hover:text-white hover:bg-zinc-800"
                } disabled:opacity-40 disabled:hover:text-zinc-400 disabled:hover:bg-transparent`}
                aria-label={isQueueSheetOpen ? "Close queue" : "Open queue"}
                aria-expanded={isQueueSheetOpen}
              >
                <QueueIcon />
              </button>
            </div>

            <div className="flex-1 flex flex-col justify-center gap-6">
              <div
                ref={fullArtworkRef}
                className="w-full max-w-sm mx-auto aspect-square bg-[#121212] overflow-hidden"
                style={{
                  transform: `translate3d(${artworkTranslateX}px, ${artworkTranslateY}px, 0) scale(${artworkScale})`,
                  transformOrigin: "center center",
                  borderRadius: `${artworkBorderRadius}px`,
                  transition: isMobileDragging
                    ? "none"
                    : isMobileTransitioning
                    ? `transform ${(isMobileCollapsing ? MOBILE_COLLAPSE_MS : MOBILE_EXPAND_MS)}ms ${(isMobileCollapsing ? MOBILE_COLLAPSE_EASE : MOBILE_EXPAND_EASE)}, border-radius ${(isMobileCollapsing ? MOBILE_COLLAPSE_MS : MOBILE_EXPAND_MS)}ms ${(isMobileCollapsing ? MOBILE_COLLAPSE_EASE : MOBILE_EXPAND_EASE)}`
                    : `transform 320ms ${MOBILE_EXPAND_EASE}, border-radius 320ms ${MOBILE_EXPAND_EASE}`,
                }}
              >
                {coverSrc ? (
                  <div className="w-full h-full flex items-center justify-center">
                    <div className="rounded-xl overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={coverSrc}
                        alt={`${song.title} cover`}
                        className="max-w-full max-h-full block rounded-xl"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-4xl text-zinc-600">
                    ♪
                  </div>
                )}
              </div>

              <div
                className="text-center"
                style={{
                opacity: expandedDetailsProgress,
                transform: `translateY(${(1 - expandedDetailsProgress) * 14}px)`,
                transition: isMobileDragging
                  ? "none"
                  : `opacity ${MOBILE_FADE_MS}ms ${MOBILE_EXPAND_EASE}, transform ${MOBILE_FADE_MS}ms ${MOBILE_EXPAND_EASE}`,
                }}
              >
                <ScrollingTitle
                  text={song.title}
                  className="text-xl font-semibold"
                  speed={25}
                />
                <p className="text-sm text-zinc-400 mt-1 truncate">{song.artist || "Unknown Artist"}</p>
              </div>

              <div
                className="w-full max-w-sm mx-auto"
                style={{
                opacity: expandedDetailsProgress,
                transform: `translateY(${(1 - expandedDetailsProgress) * 16}px)`,
                transition: isMobileDragging
                  ? "none"
                  : `opacity ${MOBILE_FADE_MS}ms ${MOBILE_EXPAND_EASE}, transform ${MOBILE_FADE_MS}ms ${MOBILE_EXPAND_EASE}`,
                }}
              >
                {/* Fix #9: progress bar with touch-drag seeking */}
                <div className="w-full flex items-center gap-2">
                  <span className="text-[11px] text-zinc-500 w-9 text-right">
                    {formatTime(currentTime)}
                  </span>
                  <div
                    ref={mobileSeekBarRef}
                    className="flex-1 h-1.5 bg-zinc-700 rounded-full cursor-pointer group"
                    style={{ touchAction: "none" }}
                    onClick={handleMobileSeekClick}
                    onTouchStart={handleMobileSeekTouchStart}
                    onTouchMove={handleMobileSeekTouchMove}
                    onTouchEnd={handleMobileSeekTouchEnd}
                    onTouchCancel={handleMobileSeekTouchEnd}
                  >
                    <div
                      className="h-full bg-emerald-500 rounded-full relative group-hover:bg-emerald-400 transition-colors"
                      style={{ width: `${progress}%` }}
                    >
                      <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </div>
                  <span className="text-[11px] text-zinc-500 w-9">{formatTime(duration)}</span>
                </div>

                <div className="mt-5 flex items-center justify-center gap-2 sm:gap-4">
                  <button
                    type="button"
                    onClick={() => setShuffleEnabled((prev) => !prev)}
                    className={`h-[clamp(3rem,13.5vw,4rem)] w-[clamp(3rem,13.5vw,4rem)] shrink-0 inline-flex items-center justify-center rounded-full transition-all ${
                      shuffleEnabled
                        ? "bg-emerald-500/25 text-emerald-300 ring-1 ring-emerald-400/40 hover:bg-emerald-500/35"
                        : "text-zinc-400 hover:text-white hover:bg-zinc-800"
                    }`}
                    title="Shuffle"
                    aria-label={shuffleEnabled ? "Disable shuffle" : "Enable shuffle"}
                  >
                    <ShuffleIcon className="h-[clamp(1.1rem,5vw,1.5rem)] w-[clamp(1.1rem,5vw,1.5rem)]" />
                  </button>
                  <button
                    type="button"
                    onClick={playPrev}
                    disabled={!canGoPrev}
                    className="h-[clamp(3rem,13.5vw,4rem)] w-[clamp(3rem,13.5vw,4rem)] shrink-0 inline-flex items-center justify-center rounded-full text-zinc-300 hover:text-white hover:bg-zinc-800 hover:scale-105 disabled:text-zinc-700 disabled:hover:bg-transparent disabled:hover:scale-100 transition-all"
                  >
                    <PrevIcon className="h-[clamp(1.6rem,7vw,2.2rem)] w-[clamp(1.6rem,7vw,2.2rem)]" />
                  </button>
                  <button
                    type="button"
                    onClick={togglePlay}
                    className="h-[clamp(3.5rem,17vw,4.5rem)] w-[clamp(3.5rem,17vw,4.5rem)] shrink-0 flex items-center justify-center text-white hover:scale-105 transition-transform active:scale-95"
                  >
                    <PlayPauseIcon playing={playing} xlarge />
                  </button>
                  <button
                    type="button"
                    onClick={playNext}
                    disabled={!canGoNext}
                    className="h-[clamp(3rem,13.5vw,4rem)] w-[clamp(3rem,13.5vw,4rem)] shrink-0 inline-flex items-center justify-center rounded-full text-zinc-300 hover:text-white hover:bg-zinc-800 hover:scale-105 disabled:text-zinc-700 disabled:hover:bg-transparent disabled:hover:scale-100 transition-all"
                  >
                    <NextIcon className="h-[clamp(1.6rem,7vw,2.2rem)] w-[clamp(1.6rem,7vw,2.2rem)]" />
                  </button>
                  <button
                    type="button"
                    onClick={cycleRepeatMode}
                    className={`h-[clamp(3rem,13.5vw,4rem)] w-[clamp(3rem,13.5vw,4rem)] shrink-0 inline-flex items-center justify-center rounded-full transition-all ${
                      repeatMode !== "off"
                        ? "bg-emerald-500/25 text-emerald-300 ring-1 ring-emerald-400/40 hover:bg-emerald-500/35"
                        : "text-zinc-400 hover:text-white hover:bg-zinc-800"
                    }`}
                    title={repeatTitle}
                    aria-label={repeatTitle}
                  >
                    <RepeatIcon mode={repeatMode} className="h-[clamp(1.1rem,5vw,1.5rem)] w-[clamp(1.1rem,5vw,1.5rem)]" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {isMobileExpanded && isQueueSheetOpen && (
          <>
            <div
              className="fixed inset-0 z-[70] bg-black/45 transition-opacity duration-200"
              onClick={closeQueueSheet}
              aria-hidden="true"
            />

            <section
              className="fixed inset-x-0 bottom-0 z-[75] mx-2 sm:mx-4 max-h-[58vh] sm:max-h-[66vh] rounded-t-2xl border border-zinc-800 bg-zinc-950 shadow-[0_-18px_48px_rgba(0,0,0,0.6)] overflow-hidden animate-[queue-sheet-in_260ms_cubic-bezier(0.22,1,0.36,1)]"
              aria-label="Queue"
            >
              <div
                style={{
                  transform: `translate3d(0, ${queueDragOffset}px, 0)`,
                  transition: isQueueDragging
                    ? "none"
                    : `transform 220ms ${MOBILE_EXPAND_EASE}`,
                }}
              >
                <div
                  className="px-4 pt-3 pb-2 border-b border-zinc-800"
                  onTouchStart={handleQueueSheetTouchStart}
                  onTouchMove={handleQueueSheetTouchMove}
                  onTouchEnd={handleQueueSheetTouchEnd}
                  onTouchCancel={handleQueueSheetTouchEnd}
                >
                  {/* Fix #10: drag handle indicator */}
                  <div className="flex justify-center pb-2">
                    <div className="h-1 w-8 rounded-full bg-zinc-700" />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-zinc-100">Queue</h3>
                        <span className="text-xs font-medium tabular-nums text-zinc-400">{queuePosition}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        onQueueClear?.()
                        closeQueueSheet()
                      }}
                      disabled={songs.length === 0}
                      className="h-7 rounded-md border border-zinc-700 px-2.5 text-xs text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                {songs.length === 0 ? (
                  <div className="px-4 py-5 text-sm text-zinc-500">
                    Queue is empty.
                  </div>
                ) : (
                  <div className="max-h-[calc(58vh-4.6rem)] sm:max-h-[calc(66vh-4.6rem)] overflow-y-auto px-2 py-2">
                    {songs.map((queueSong, index) => {
                      const isCurrent = queueSong.id === songId
                      return (
                        <div
                          key={`${queueSong.id}-${index}`}
                          className={`mb-1 rounded-lg border px-2 py-2 ${
                            isCurrent
                              ? "bg-blue-600/20 border-blue-500/40"
                              : "bg-zinc-900 border-zinc-800"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              onSongChange(queueSong)
                            }}
                            className="w-full text-left"
                          >
                            <p className={`text-sm truncate ${isCurrent ? "text-blue-300" : "text-white"}`}>
                              {index + 1}. {queueSong.title}
                            </p>
                            <p className="text-xs text-zinc-500 truncate">
                              {queueSong.artist || "Unknown Artist"}
                            </p>
                          </button>
                          <div className="mt-2 flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => moveQueueItem(index, index - 1)}
                              disabled={index === 0}
                              className="h-6 rounded border border-zinc-700 px-2 text-[11px] text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white disabled:opacity-40"
                            >
                              Up
                            </button>
                            <button
                              type="button"
                              onClick={() => moveQueueItem(index, index + 1)}
                              disabled={index >= songs.length - 1}
                              className="h-6 rounded border border-zinc-700 px-2 text-[11px] text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white disabled:opacity-40"
                            >
                              Down
                            </button>
                            <button
                              type="button"
                              onClick={() => removeQueueItem(queueSong.id, index)}
                              className="h-6 rounded border border-red-500/35 px-2 text-[11px] text-red-300 transition-colors hover:bg-red-500/20"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </>
    )
  }

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[70] border-t border-zinc-800/80 bg-[linear-gradient(180deg,rgba(39,39,42,0.90)_0%,rgba(24,24,27,0.88)_100%)] backdrop-blur-xl shadow-[0_-18px_40px_rgba(0,0,0,0.55)] px-3 sm:px-4 lg:px-6 pt-3 lg:pt-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
    >
      <audio ref={audioRef} />
      <div className="max-w-6xl mx-auto flex flex-col gap-3 lg:gap-4 sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)] sm:items-center">
        <div className="flex items-center gap-3 min-w-0 lg:gap-4">
          <div className="w-12 h-12 rounded overflow-hidden bg-zinc-800 shrink-0 flex items-center justify-center lg:h-14 lg:w-14">
            {coverSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={coverSrc}
                alt={`${song.title} cover`}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-zinc-500 text-xs">♪</span>
            )}
          </div>
          <div className="min-w-0">
            <ScrollingTitle
              text={song.title}
              className="text-sm font-medium text-white lg:text-base"
              speed={20}
            />
            <p className="text-xs text-zinc-500 truncate lg:text-sm">{song.artist || "Unknown"}</p>
          </div>
        </div>

        <div className="flex flex-col gap-2 lg:gap-2.5 sm:px-4">
          <div className="flex items-center justify-center gap-2.5 lg:gap-3">
            <button
              type="button"
              onClick={() => setShuffleEnabled((prev) => !prev)}
              className={`h-10 min-w-10 px-2.5 rounded-lg inline-flex items-center justify-center transition-all lg:h-12 lg:min-w-12 ${
                shuffleEnabled
                  ? "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                  : "text-zinc-400 hover:text-white hover:bg-zinc-800"
              }`}
              title="Shuffle"
              aria-label={shuffleEnabled ? "Disable shuffle" : "Enable shuffle"}
            >
              <ShuffleIcon className="h-[1.1rem] w-[1.1rem] lg:h-[1.45rem] lg:w-[1.45rem]" />
            </button>
            <button
              type="button"
              onClick={playPrev}
              disabled={!canGoPrev}
              className="h-10 min-w-10 px-2.5 rounded-lg inline-flex items-center justify-center text-zinc-300 hover:text-white hover:bg-zinc-800 hover:scale-105 disabled:text-zinc-700 disabled:hover:bg-transparent disabled:hover:scale-100 transition-all lg:h-12 lg:min-w-12"
            >
              <PrevIcon className="h-[1.4rem] w-[1.4rem] lg:h-[1.9rem] lg:w-[1.9rem]" />
            </button>
            <button
              type="button"
              onClick={togglePlay}
              className="h-11 w-11 flex items-center justify-center rounded-full bg-white text-black hover:scale-105 active:scale-95 transition-transform lg:h-14 lg:w-14"
            >
              <PlayPauseIcon playing={playing} large />
            </button>
            <button
              type="button"
              onClick={playNext}
              disabled={!canGoNext}
              className="h-10 min-w-10 px-2.5 rounded-lg inline-flex items-center justify-center text-zinc-300 hover:text-white hover:bg-zinc-800 hover:scale-105 disabled:text-zinc-700 disabled:hover:bg-transparent disabled:hover:scale-100 transition-all lg:h-12 lg:min-w-12"
            >
              <NextIcon className="h-[1.4rem] w-[1.4rem] lg:h-[1.9rem] lg:w-[1.9rem]" />
            </button>
            <button
              type="button"
              onClick={cycleRepeatMode}
              className={`h-10 min-w-10 px-2.5 rounded-lg inline-flex items-center justify-center transition-all lg:h-12 lg:min-w-12 ${
                repeatMode !== "off"
                  ? "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                  : "text-zinc-400 hover:text-white hover:bg-zinc-800"
              }`}
              title={repeatTitle}
              aria-label={repeatTitle}
            >
              <RepeatIcon mode={repeatMode} className="h-[1.1rem] w-[1.1rem] lg:h-[1.45rem] lg:w-[1.45rem]" />
            </button>
          </div>

          <div className="w-full flex items-center gap-2 lg:gap-2.5">
            <span className="text-[11px] text-zinc-500 w-9 text-right lg:w-10 lg:text-xs">{formatTime(currentTime)}</span>
            <div
              ref={desktopSeekBarRef}
              className="flex-1 h-1.5 bg-zinc-700 rounded-full cursor-pointer group lg:h-2"
              onClick={handleDesktopSeekClick}
              onTouchStart={handleDesktopSeekTouchStart}
              onTouchMove={handleDesktopSeekTouchMove}
              onTouchEnd={handleDesktopSeekTouchEnd}
              onTouchCancel={handleDesktopSeekTouchEnd}
            >
              <div
                className="h-full bg-emerald-500 rounded-full relative group-hover:bg-emerald-400 transition-colors"
                style={{ width: `${progress}%` }}
              >
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity lg:h-3.5 lg:w-3.5" />
              </div>
            </div>
            <span className="text-[11px] text-zinc-500 w-9 lg:w-10 lg:text-xs">{formatTime(duration)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto sm:justify-end lg:gap-3">
          <VolumeIcon className="h-[1.05rem] w-[1.05rem] text-zinc-400 lg:h-[1.6rem] lg:w-[1.6rem]" />
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={changeVolume}
            className="w-full sm:w-28 lg:w-36 accent-emerald-500"
          />
          <button
            type="button"
            onClick={toggleQueueSheet}
            disabled={songs.length === 0}
            className={`h-10 min-w-10 rounded-lg inline-flex items-center justify-center transition-colors lg:h-11 lg:min-w-11 ${
              isQueueSheetOpen
                ? "bg-zinc-800 text-white"
                : "text-zinc-400 hover:text-white hover:bg-zinc-800"
            } disabled:opacity-40 disabled:hover:text-zinc-400 disabled:hover:bg-transparent`}
            aria-label={isQueueSheetOpen ? "Close queue" : "Open queue"}
            aria-expanded={isQueueSheetOpen}
          >
            <QueueIcon />
          </button>
        </div>
      </div>
      {isQueueSheetOpen && (
        <>
          <div className="absolute right-3 bottom-full z-[75] h-[min(34rem,60vh)] w-[min(32rem,94vw)]">
            <section className="relative h-full overflow-hidden rounded-tl-2xl rounded-tr-2xl border border-zinc-700/85 border-b-0 bg-[linear-gradient(180deg,rgba(39,39,42,0.90)_0%,rgba(24,24,27,0.88)_100%)] backdrop-blur-xl shadow-none">
                <div className="flex items-center justify-between border-b border-zinc-700/75 bg-[linear-gradient(180deg,rgba(43,50,66,0.82)_0%,rgba(34,39,52,0.80)_100%)] px-4 py-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-semibold text-zinc-100">Queue</h3>
                      <span className="text-sm font-medium tabular-nums text-zinc-300">{queuePosition}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setShowQueueClearConfirm(true)}
                      disabled={songs.length === 0}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-red-500/35 text-red-300 hover:bg-red-500/15 disabled:opacity-40"
                      aria-label="Clear queue"
                      title="Clear queue"
                    >
                      <TrashIcon />
                    </button>
                    <button
                      type="button"
                      onClick={closeQueueSheet}
                      className="h-7 rounded-md border border-zinc-700 px-2.5 text-xs text-zinc-300 hover:border-zinc-500 hover:text-white"
                    >
                      Close
                    </button>
                  </div>
                </div>
                {songs.length === 0 ? (
                  <div className="px-4 py-5 text-sm text-zinc-500">Queue is empty.</div>
                ) : (
                  <div className="custom-scrollbar h-[calc(100%-3.25rem)] overflow-y-auto px-2 py-2">
                    {songs.map((queueSong, index) => {
                      const isCurrent = queueSong.id === songId
                      const queueCoverSrc = queueSong.coverPath ? `/api/cover/${queueSong.id}` : queueSong.thumbnail
                      return (
                        <div
                          key={`${queueSong.id}-${index}`}
                          className={`mb-1 flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors ${
                            isCurrent
                              ? "border-sky-400/45 bg-sky-500/15"
                              : "border-zinc-800 bg-zinc-900 hover:bg-zinc-800"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              onSongChange(queueSong)
                            }}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="flex items-center gap-2.5">
                              <div className="h-9 w-9 shrink-0 overflow-hidden rounded bg-zinc-800">
                                {queueCoverSrc ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={queueCoverSrc}
                                    alt={`${queueSong.title} cover`}
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center text-[11px] text-zinc-500">♪</div>
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className={`truncate text-base ${isCurrent ? "text-sky-200" : "text-zinc-100"}`}>
                                  {index + 1}. {queueSong.title}
                                </p>
                                <p className="truncate text-sm text-zinc-400">{queueSong.artist || "Unknown Artist"}</p>
                              </div>
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => removeQueueItem(queueSong.id, index)}
                            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-white"
                            aria-label={`Remove ${queueSong.title} from queue`}
                            title="Remove from queue"
                          >
                            <XIcon />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
                {showQueueClearConfirm && (
                  <div className="absolute right-3 top-12 z-[77] w-[18rem] rounded-xl border border-zinc-700/80 bg-zinc-950 p-3 shadow-xl">
                    <p className="text-sm font-medium text-zinc-100">Clear entire queue?</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      This removes all queued tracks from the current playback session.
                    </p>
                    <div className="mt-3 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setShowQueueClearConfirm(false)}
                        className="h-7 rounded-md border border-zinc-700 px-2.5 text-xs text-zinc-300 hover:bg-zinc-800"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onQueueClear?.()
                          setShowQueueClearConfirm(false)
                          closeQueueSheet()
                        }}
                        className="h-7 rounded-md border border-red-500/40 bg-red-500/15 px-2.5 text-xs text-red-200 hover:bg-red-500/25"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}
