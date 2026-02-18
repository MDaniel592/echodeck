export type PlayerShortcutAction =
  | "togglePlay"
  | "seekForward"
  | "seekBackward"
  | "next"
  | "previous"

export type KeyboardShortcutEventLike = {
  key: string
  code: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}

export function shouldIgnorePlayerShortcut(input: {
  isTyping: boolean
  event: KeyboardShortcutEventLike
}): boolean {
  return input.isTyping || input.event.altKey || input.event.ctrlKey || input.event.metaKey
}

export function resolvePlayerShortcutAction(event: KeyboardShortcutEventLike): PlayerShortcutAction | null {
  if (event.code === "Space" || event.key.toLowerCase() === "k") return "togglePlay"
  if (event.key === "ArrowRight" || event.key.toLowerCase() === "l") return "seekForward"
  if (event.key === "ArrowLeft" || event.key.toLowerCase() === "j") return "seekBackward"
  if (event.key === "ArrowDown" || event.key.toLowerCase() === "n") return "next"
  if (event.key === "ArrowUp" || event.key.toLowerCase() === "p") return "previous"
  return null
}
