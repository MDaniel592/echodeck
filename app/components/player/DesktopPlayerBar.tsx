"use client"

import type { ChangeEvent, MouseEvent, RefObject, TouchEvent } from "react"
import { ScrollingTitle, VolumeIcon, ShuffleIcon, PrevIcon, PlayPauseIcon, NextIcon, RepeatIcon, QueueIcon, formatTime } from "./ui"

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
  replayGainTrackDb?: number | null
  replayGainAlbumDb?: number | null
  replayGainTrackPeak?: number | null
  replayGainAlbumPeak?: number | null
  playlistId: number | null
  createdAt: string
}

const PLAYBACK_RATE_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2]

interface DesktopPlayerBarProps {
  song: Song
  songsLength: number
  playing: boolean
  shuffleEnabled: boolean
  repeatMode: "off" | "all" | "one"
  repeatTitle: string
  canGoPrev: boolean
  canGoNext: boolean
  currentTime: number
  duration: number
  progress: number
  volume: number
  isQueueSheetOpen: boolean
  normalizationEnabled: boolean
  gaplessEnabled: boolean
  crossfadeSeconds: number
  coverSrc: string | null
  accentColor: string
  playbackRate: number
  silenceSkipEnabled: boolean
  showLyrics: boolean
  onToggleShuffle: () => void
  onPlayPrev: () => void
  onTogglePlay: () => void
  onPlayNext: () => void
  onCycleRepeat: () => void
  onToggleMute: () => void
  onVolumeChange: (e: ChangeEvent<HTMLInputElement>) => void
  onToggleQueue: () => void
  onToggleNormalization: () => void
  onToggleGapless: () => void
  onCrossfadeChange: (value: number) => void
  onPlaybackRateChange: (rate: number) => void
  onToggleSilenceSkip: () => void
  onToggleLyrics: () => void
  desktopSeekBarRef: RefObject<HTMLDivElement | null>
  onDesktopSeekClick: (e: MouseEvent<HTMLDivElement>) => void
  onDesktopSeekTouchStart: (e: TouchEvent<HTMLDivElement>) => void
  onDesktopSeekTouchMove: (e: TouchEvent<HTMLDivElement>) => void
  onDesktopSeekTouchEnd: (e: TouchEvent<HTMLDivElement>) => void
}

export default function DesktopPlayerBar({
  song,
  songsLength,
  playing,
  shuffleEnabled,
  repeatMode,
  repeatTitle,
  canGoPrev,
  canGoNext,
  currentTime,
  duration,
  progress,
  volume,
  isQueueSheetOpen,
  normalizationEnabled,
  gaplessEnabled,
  crossfadeSeconds,
  coverSrc,
  accentColor,
  playbackRate,
  silenceSkipEnabled,
  showLyrics,
  onToggleShuffle,
  onPlayPrev,
  onTogglePlay,
  onPlayNext,
  onCycleRepeat,
  onToggleMute,
  onVolumeChange,
  onToggleQueue,
  onToggleNormalization,
  onToggleGapless,
  onCrossfadeChange,
  onPlaybackRateChange,
  onToggleSilenceSkip,
  onToggleLyrics,
  desktopSeekBarRef,
  onDesktopSeekClick,
  onDesktopSeekTouchStart,
  onDesktopSeekTouchMove,
  onDesktopSeekTouchEnd,
}: DesktopPlayerBarProps) {
  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-3 lg:gap-2.5 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(22rem,1.35fr)_minmax(0,1fr)] lg:items-center lg:gap-x-4">
      <div className="flex items-center gap-3 min-w-0 lg:gap-4">
        <div className="w-12 h-12 rounded overflow-hidden bg-zinc-800 shrink-0 flex items-center justify-center lg:h-[3.25rem] lg:w-[3.25rem]">
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
            className="text-sm font-medium text-white lg:text-[1.05rem]"
            speed={20}
          />
          <p className="text-xs text-zinc-500 truncate lg:text-[0.9rem]">{song.artist || "Unknown"}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2 lg:gap-2 lg:px-3 lg:w-full lg:max-w-[42rem] lg:justify-self-center">
        <div className="flex items-center justify-center gap-2.5 lg:gap-2.5">
          <button
            type="button"
            onClick={onToggleShuffle}
            className={`h-10 min-w-10 px-2.5 rounded-lg inline-flex items-center justify-center transition-all lg:h-11 lg:min-w-11 ${
              shuffleEnabled
                ? "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                : "text-zinc-400 hover:text-white hover:bg-zinc-800"
            }`}
            title="Shuffle"
            aria-label={shuffleEnabled ? "Disable shuffle" : "Enable shuffle"}
          >
            <ShuffleIcon className="h-[1.1rem] w-[1.1rem] lg:h-[1.25rem] lg:w-[1.25rem]" />
          </button>
          <button
            type="button"
            onClick={onPlayPrev}
            disabled={!canGoPrev}
            className="h-10 min-w-10 px-2.5 rounded-lg inline-flex items-center justify-center text-zinc-300 hover:text-white hover:bg-zinc-800 hover:scale-105 disabled:text-zinc-700 disabled:hover:bg-transparent disabled:hover:scale-100 transition-all lg:h-11 lg:min-w-11"
          >
            <PrevIcon className="h-[1.4rem] w-[1.4rem] lg:h-[1.65rem] lg:w-[1.65rem]" />
          </button>
          <button
            type="button"
            onClick={onTogglePlay}
            className="h-11 w-11 flex items-center justify-center rounded-full bg-white text-black hover:scale-105 active:scale-95 transition-transform lg:h-12 lg:w-12"
          >
            <PlayPauseIcon playing={playing} large />
          </button>
          <button
            type="button"
            onClick={onPlayNext}
            disabled={!canGoNext}
            className="h-10 min-w-10 px-2.5 rounded-lg inline-flex items-center justify-center text-zinc-300 hover:text-white hover:bg-zinc-800 hover:scale-105 disabled:text-zinc-700 disabled:hover:bg-transparent disabled:hover:scale-100 transition-all lg:h-11 lg:min-w-11"
          >
            <NextIcon className="h-[1.4rem] w-[1.4rem] lg:h-[1.65rem] lg:w-[1.65rem]" />
          </button>
          <button
            type="button"
            onClick={onCycleRepeat}
            className={`h-10 min-w-10 px-2.5 rounded-lg inline-flex items-center justify-center transition-all lg:h-11 lg:min-w-11 ${
              repeatMode !== "off"
                ? "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                : "text-zinc-400 hover:text-white hover:bg-zinc-800"
            }`}
            title={repeatTitle}
            aria-label={repeatTitle}
          >
            <RepeatIcon mode={repeatMode} className="h-[1.1rem] w-[1.1rem] lg:h-[1.25rem] lg:w-[1.25rem]" />
          </button>
        </div>

        <div className="w-full flex items-center gap-2 lg:gap-2">
          <span className="text-[11px] text-zinc-500 w-9 text-right lg:w-10 lg:text-xs">{formatTime(currentTime)}</span>
          <div
            ref={desktopSeekBarRef}
            className="flex-1 h-1.5 bg-zinc-700 rounded-full cursor-pointer group lg:h-2"
            onClick={onDesktopSeekClick}
            onTouchStart={onDesktopSeekTouchStart}
            onTouchMove={onDesktopSeekTouchMove}
            onTouchEnd={onDesktopSeekTouchEnd}
            onTouchCancel={onDesktopSeekTouchEnd}
          >
            <div
              className="h-full rounded-full relative transition-colors"
              style={{ width: `${progress}%`, backgroundColor: accentColor }}
            >
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity lg:h-3.5 lg:w-3.5" />
            </div>
          </div>
          <span className="text-[11px] text-zinc-500 w-9 lg:w-10 lg:text-xs">{formatTime(duration)}</span>
        </div>
      </div>

      <div className="w-full min-w-0 flex items-center gap-2 flex-wrap lg:w-full lg:max-w-[24rem] lg:justify-self-center lg:grid lg:grid-cols-[max-content_auto] lg:grid-rows-[auto_auto] lg:items-center lg:gap-x-2.5 lg:gap-y-1.5">
        <div className="w-full sm:w-52 lg:w-[10.5rem] lg:row-start-1 lg:col-start-1 lg:justify-self-center min-w-0 flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleMute}
            className={`h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-md transition-colors ${
              volume <= 0.001
                ? "bg-zinc-800 text-zinc-200"
                : "text-zinc-400 hover:text-white hover:bg-zinc-800"
            }`}
            aria-label={volume <= 0.001 ? "Unmute volume" : "Mute volume"}
            title={volume <= 0.001 ? "Unmute" : "Mute"}
          >
            <VolumeIcon
              muted={volume <= 0.001}
              className="h-[1.05rem] w-[1.05rem] lg:h-[1.35rem] lg:w-[1.35rem]"
            />
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={onVolumeChange}
            className="w-full min-w-0 accent-emerald-500"
          />
        </div>

        <div className="inline-flex items-center rounded-lg border border-zinc-700/70 bg-zinc-900/50 p-1 lg:row-start-2 lg:col-start-1 lg:justify-self-center">
          <button
            type="button"
            onClick={onToggleNormalization}
            className={`h-7 min-w-7 rounded-md px-2 text-[10px] font-semibold tracking-wide transition-colors ${
              normalizationEnabled
                ? "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                : "text-zinc-400 hover:text-white hover:bg-zinc-800"
            }`}
            aria-label={normalizationEnabled ? "Disable audio normalization" : "Enable audio normalization"}
            title={normalizationEnabled ? "Normalization enabled" : "Normalization disabled"}
          >
            NRM
          </button>
          <button
            type="button"
            onClick={onToggleGapless}
            className={`ml-1 h-7 min-w-7 rounded-md px-2 text-[10px] font-semibold tracking-wide transition-colors ${
              gaplessEnabled
                ? "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                : "text-zinc-400 hover:text-white hover:bg-zinc-800"
            }`}
            aria-label={gaplessEnabled ? "Disable gapless playback" : "Enable gapless playback"}
            title={gaplessEnabled ? "Gapless enabled" : "Gapless disabled"}
          >
            GAP
          </button>
          <button
            type="button"
            onClick={onToggleSilenceSkip}
            className={`ml-1 h-7 min-w-7 rounded-md px-2 text-[10px] font-semibold tracking-wide transition-colors ${
              silenceSkipEnabled
                ? "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
                : "text-zinc-400 hover:text-white hover:bg-zinc-800"
            }`}
            aria-label={silenceSkipEnabled ? "Disable silence skip" : "Enable silence skip"}
            title={silenceSkipEnabled ? "Silence skip enabled" : "Silence skip disabled"}
          >
            SKP
          </button>
          <label className="ml-1 hidden items-center gap-1 rounded-md border border-zinc-700/60 px-1.5 py-0.5 text-[10px] text-zinc-300 xl:inline-flex">
            XFD
            <input
              type="range"
              min={0}
              max={8}
              step={0.5}
              value={crossfadeSeconds}
              onChange={(event) => onCrossfadeChange(Number.parseFloat(event.target.value))}
              className="w-12 accent-emerald-500"
              aria-label="Crossfade seconds"
            />
            <span className="w-7 text-right tabular-nums">{crossfadeSeconds.toFixed(1)}s</span>
          </label>
          <label className="ml-1 inline-flex items-center gap-1 rounded-md border border-zinc-700/60 px-1.5 py-0.5 text-[10px] text-zinc-300">
            SPD
            <select
              value={playbackRate}
              onChange={(e) => onPlaybackRateChange(Number.parseFloat(e.target.value))}
              className="bg-transparent text-[10px] text-zinc-300 outline-none cursor-pointer"
              aria-label="Playback speed"
            >
              {PLAYBACK_RATE_OPTIONS.map((rate) => (
                <option key={rate} value={rate} className="bg-zinc-900">
                  {rate === 1 ? "1×" : `${rate}×`}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="inline-flex items-center gap-1 lg:row-start-2 lg:col-start-2 lg:justify-self-start">
          <button
            type="button"
            onClick={onToggleQueue}
            disabled={songsLength === 0}
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
          <button
            type="button"
            onClick={onToggleLyrics}
            className={`h-10 min-w-10 rounded-lg inline-flex items-center justify-center text-[10px] font-semibold tracking-wide transition-colors lg:h-11 lg:min-w-10 px-2 ${
              showLyrics
                ? "bg-zinc-800 text-white"
                : "text-zinc-400 hover:text-white hover:bg-zinc-800"
            }`}
            aria-label={showLyrics ? "Hide lyrics" : "Show lyrics"}
            title={showLyrics ? "Hide lyrics" : "Show lyrics"}
          >
            LYR
          </button>
        </div>
      </div>
    </div>
  )
}
