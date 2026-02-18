export function shouldStartPlaybackTransition(input: {
  duration: number
  currentTime: number
  isPlaying: boolean
  crossfadeSeconds: number
  gaplessEnabled: boolean
  alreadyTriggered: boolean
}): boolean {
  if (input.alreadyTriggered || !input.isPlaying) return false
  if (!Number.isFinite(input.duration) || input.duration <= 0) return false

  const remaining = input.duration - input.currentTime
  if (!Number.isFinite(remaining) || remaining < 0) return false

  const transitionWindow = input.crossfadeSeconds > 0
    ? Math.min(12, Math.max(0.2, input.crossfadeSeconds))
    : input.gaplessEnabled
      ? 0.12
      : 0

  if (transitionWindow <= 0) return false
  return remaining <= transitionWindow
}
