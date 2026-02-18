import { describe, expect, it } from "vitest"
import { shouldStartPlaybackTransition } from "../app/components/player/transitions"

describe("player transitions", () => {
  it("starts transition inside crossfade window", () => {
    expect(
      shouldStartPlaybackTransition({
        duration: 200,
        currentTime: 198.5,
        isPlaying: true,
        crossfadeSeconds: 2,
        gaplessEnabled: false,
        alreadyTriggered: false,
      })
    ).toBe(true)
  })

  it("supports tiny gapless handoff when crossfade is disabled", () => {
    expect(
      shouldStartPlaybackTransition({
        duration: 200,
        currentTime: 199.95,
        isPlaying: true,
        crossfadeSeconds: 0,
        gaplessEnabled: true,
        alreadyTriggered: false,
      })
    ).toBe(true)
  })

  it("does not transition when paused or already triggered", () => {
    expect(
      shouldStartPlaybackTransition({
        duration: 200,
        currentTime: 198.5,
        isPlaying: false,
        crossfadeSeconds: 2,
        gaplessEnabled: true,
        alreadyTriggered: false,
      })
    ).toBe(false)
    expect(
      shouldStartPlaybackTransition({
        duration: 200,
        currentTime: 198.5,
        isPlaying: true,
        crossfadeSeconds: 2,
        gaplessEnabled: true,
        alreadyTriggered: true,
      })
    ).toBe(false)
  })
})
