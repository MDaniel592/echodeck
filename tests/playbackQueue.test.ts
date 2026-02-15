import { describe, expect, it } from "vitest"
import { queuePositionLabel, removeQueueItem, reorderQueue } from "../lib/playbackQueue"

describe("playbackQueue utils", () => {
  it("reorders queue items by index", () => {
    const reordered = reorderQueue([1, 2, 3, 4], 1, 3)
    expect(reordered).toEqual([1, 3, 4, 2])
  })

  it("keeps queue unchanged for invalid reorder indexes", () => {
    const original = [1, 2, 3]
    expect(reorderQueue(original, -1, 1)).toEqual(original)
    expect(reorderQueue(original, 0, 9)).toEqual(original)
    expect(reorderQueue(original, 1, 1)).toEqual(original)
  })

  it("removes queue entry by index and song id", () => {
    const next = removeQueueItem([10, 11, 12], 11, 1)
    expect(next).toEqual([10, 12])
  })

  it("falls back to remove by song id when index mismatches", () => {
    const next = removeQueueItem([10, 11, 12], 11, 0)
    expect(next).toEqual([10, 12])
  })

  it("formats queue position label", () => {
    expect(queuePositionLabel(0, 12)).toBe("1/12")
    expect(queuePositionLabel(-1, 12)).toBe("0/12")
    expect(queuePositionLabel(3, 0)).toBe("4/0")
  })
})
