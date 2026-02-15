"use client"

import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react"
import { queuePositionLabel } from "../../lib/playbackQueue"
import DesktopQueuePanel from "./player/DesktopQueuePanel"
import DesktopPlayerBar from "./player/DesktopPlayerBar"
import MobileQueueSheet from "./player/MobileQueueSheet"
import {
  formatTime,
  MinimizePlayerIcon,
  NextIcon,
  PlayPauseIcon,
  PrevIcon,
  QueueIcon,
  RepeatIcon,
  ScrollingTitle,
  ShuffleIcon,
} from "./player/ui"
import { useSeekBarHandlers } from "./player/useSeekBarHandlers"

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

        <MobileQueueSheet
          isVisible={isMobileExpanded && isQueueSheetOpen}
          songs={songs}
          currentSongId={songId}
          queuePosition={queuePosition}
          queueDragOffset={queueDragOffset}
          isQueueDragging={isQueueDragging}
          transitionEase={MOBILE_EXPAND_EASE}
          onClose={closeQueueSheet}
          onTouchStart={handleQueueSheetTouchStart}
          onTouchMove={handleQueueSheetTouchMove}
          onTouchEnd={handleQueueSheetTouchEnd}
          onSelectSong={(queueSong) => onSongChange(queueSong)}
          onMoveItem={moveQueueItem}
          onRemoveItem={removeQueueItem}
          onClear={() => {
            onQueueClear?.()
            closeQueueSheet()
          }}
        />
      </>
    )
  }

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[70] border-t border-zinc-800/80 bg-[linear-gradient(180deg,rgba(39,39,42,0.90)_0%,rgba(24,24,27,0.88)_100%)] backdrop-blur-xl shadow-[0_-18px_40px_rgba(0,0,0,0.55)] px-3 sm:px-4 lg:px-6 pt-3 lg:pt-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
    >
      <audio ref={audioRef} />
      <DesktopPlayerBar
        song={song}
        songsLength={songs.length}
        playing={playing}
        shuffleEnabled={shuffleEnabled}
        repeatMode={repeatMode}
        repeatTitle={repeatTitle}
        canGoPrev={canGoPrev}
        canGoNext={canGoNext}
        currentTime={currentTime}
        duration={duration}
        progress={progress}
        volume={volume}
        isQueueSheetOpen={isQueueSheetOpen}
        coverSrc={coverSrc}
        onToggleShuffle={() => setShuffleEnabled((prev) => !prev)}
        onPlayPrev={playPrev}
        onTogglePlay={togglePlay}
        onPlayNext={playNext}
        onCycleRepeat={cycleRepeatMode}
        onVolumeChange={changeVolume}
        onToggleQueue={toggleQueueSheet}
        desktopSeekBarRef={desktopSeekBarRef}
        onDesktopSeekClick={handleDesktopSeekClick}
        onDesktopSeekTouchStart={handleDesktopSeekTouchStart}
        onDesktopSeekTouchMove={handleDesktopSeekTouchMove}
        onDesktopSeekTouchEnd={handleDesktopSeekTouchEnd}
      />
      {isQueueSheetOpen && (
        <DesktopQueuePanel
          songs={songs}
          currentSongId={songId}
          queuePosition={queuePosition}
          onClose={closeQueueSheet}
          onSelectSong={(queueSong) => onSongChange(queueSong)}
          onRemove={(queueSongId, index) => removeQueueItem(queueSongId, index)}
          onClear={() => onQueueClear?.()}
        />
      )}
    </div>
  )
}
