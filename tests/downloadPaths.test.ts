import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { resolveSafeDownloadPathForDelete } from "../lib/downloadPaths"

describe("downloadPaths", () => {
  let tempRoot = ""
  let cwdSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "echodeck-downloadpaths-"))
    await fs.mkdir(path.join(tempRoot, "downloads"), { recursive: true })
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot)
  })

  afterEach(async () => {
    cwdSpy.mockRestore()
    await fs.rm(tempRoot, { recursive: true, force: true })
  })

  it("returns the real validated path for delete", async () => {
    const filePath = path.join(tempRoot, "downloads", "song.mp3")
    await fs.writeFile(filePath, "test")

    const resolved = resolveSafeDownloadPathForDelete(filePath)

    expect(resolved).toBe(await fs.realpath(filePath))
  })

  it("rejects paths outside downloads root", () => {
    const outside = path.join(tempRoot, "outside.txt")
    const resolved = resolveSafeDownloadPathForDelete(outside)
    expect(resolved).toBeNull()
  })
})
