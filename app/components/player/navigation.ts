import type { RepeatMode } from "./types"

export function getRandomQueueIndex(totalSongs: number, currentIndex: number): number | null {
  if (totalSongs < 2 || currentIndex < 0) return null
  let nextIndex = currentIndex
  while (nextIndex === currentIndex) {
    nextIndex = Math.floor(Math.random() * totalSongs)
  }
  return nextIndex
}

interface QueueIndexOptions {
  currentIndex: number
  totalSongs: number
  shuffleEnabled: boolean
  repeatMode: RepeatMode
}

export function getPrevQueueIndex(options: QueueIndexOptions): number | null {
  const { currentIndex, totalSongs, shuffleEnabled, repeatMode } = options
  if (currentIndex < 0) return null

  if (shuffleEnabled) {
    const randomIndex = getRandomQueueIndex(totalSongs, currentIndex)
    if (randomIndex !== null) return randomIndex
  }

  if (currentIndex > 0) return currentIndex - 1
  if (repeatMode === "all") return totalSongs - 1
  return null
}

export function getNextQueueIndex(options: QueueIndexOptions): number | null {
  const { currentIndex, totalSongs, shuffleEnabled, repeatMode } = options
  if (currentIndex < 0) return null

  if (shuffleEnabled) {
    const randomIndex = getRandomQueueIndex(totalSongs, currentIndex)
    if (randomIndex !== null) return randomIndex
  }

  if (currentIndex < totalSongs - 1) return currentIndex + 1
  if (repeatMode === "all") return 0
  return null
}

export function canGoPrevInQueue(options: QueueIndexOptions): boolean {
  const { currentIndex, totalSongs, shuffleEnabled, repeatMode } = options
  return currentIndex >= 0 && (shuffleEnabled ? totalSongs > 1 || repeatMode === "all" : currentIndex > 0 || repeatMode === "all")
}

export function canGoNextInQueue(options: QueueIndexOptions): boolean {
  const { currentIndex, totalSongs, shuffleEnabled, repeatMode } = options
  return currentIndex >= 0 && (shuffleEnabled ? totalSongs > 1 || repeatMode === "all" : currentIndex < totalSongs - 1 || repeatMode === "all")
}
