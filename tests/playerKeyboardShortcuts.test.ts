import { describe, expect, it } from "vitest"
import {
  resolvePlayerShortcutAction,
  shouldIgnorePlayerShortcut,
} from "../app/components/player/keyboardShortcuts"

describe("player keyboard shortcuts", () => {
  it("maps standard media keys", () => {
    expect(resolvePlayerShortcutAction({ key: " ", code: "Space", altKey: false, ctrlKey: false, metaKey: false })).toBe("togglePlay")
    expect(resolvePlayerShortcutAction({ key: "k", code: "KeyK", altKey: false, ctrlKey: false, metaKey: false })).toBe("togglePlay")
    expect(resolvePlayerShortcutAction({ key: "ArrowRight", code: "ArrowRight", altKey: false, ctrlKey: false, metaKey: false })).toBe("seekForward")
    expect(resolvePlayerShortcutAction({ key: "j", code: "KeyJ", altKey: false, ctrlKey: false, metaKey: false })).toBe("seekBackward")
    expect(resolvePlayerShortcutAction({ key: "n", code: "KeyN", altKey: false, ctrlKey: false, metaKey: false })).toBe("next")
    expect(resolvePlayerShortcutAction({ key: "p", code: "KeyP", altKey: false, ctrlKey: false, metaKey: false })).toBe("previous")
  })

  it("ignores shortcuts while typing or with modifiers", () => {
    expect(
      shouldIgnorePlayerShortcut({
        isTyping: true,
        event: { key: "k", code: "KeyK", altKey: false, ctrlKey: false, metaKey: false },
      })
    ).toBe(true)
    expect(
      shouldIgnorePlayerShortcut({
        isTyping: false,
        event: { key: "k", code: "KeyK", altKey: false, ctrlKey: true, metaKey: false },
      })
    ).toBe(true)
    expect(
      shouldIgnorePlayerShortcut({
        isTyping: false,
        event: { key: "k", code: "KeyK", altKey: false, ctrlKey: false, metaKey: false },
      })
    ).toBe(false)
  })
})
