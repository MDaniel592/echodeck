export function reorderQueue(ids: number[], fromIndex: number, toIndex: number): number[] {
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= ids.length || toIndex >= ids.length) return ids
  if (fromIndex === toIndex) return ids
  const next = [...ids]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}

export function removeQueueItem(ids: number[], songId: number, index: number): number[] {
  if (index < 0 || index >= ids.length) return ids
  const next = [...ids]
  if (next[index] !== songId) {
    const fallbackIndex = next.indexOf(songId)
    if (fallbackIndex === -1) return ids
    next.splice(fallbackIndex, 1)
    return next
  }
  next.splice(index, 1)
  return next
}

export function queuePositionLabel(currentIndex: number, total: number): string {
  const safeTotal = Math.max(0, total)
  const current = currentIndex >= 0 ? currentIndex + 1 : 0
  return `${current}/${safeTotal}`
}
