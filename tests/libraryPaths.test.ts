import fs from "fs/promises"
import os from "os"
import path from "path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { validateLibraryPath } from "../lib/libraryPaths"

describe("libraryPaths", () => {
  let tempRoot = ""
  let downloadsRoot = ""
  let externalRoot = ""
  let cwdSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "echodeck-librarypaths-"))
    downloadsRoot = path.join(tempRoot, "downloads")
    externalRoot = path.join(tempRoot, "external")
    await fs.mkdir(downloadsRoot, { recursive: true })
    await fs.mkdir(externalRoot, { recursive: true })
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot)
    delete process.env.LIBRARY_ALLOWED_ROOTS
  })

  afterEach(async () => {
    cwdSpy.mockRestore()
    delete process.env.LIBRARY_ALLOWED_ROOTS
    await fs.rm(tempRoot, { recursive: true, force: true })
  })

  it("accepts directories under downloads by default", async () => {
    const musicDir = path.join(downloadsRoot, "music")
    await fs.mkdir(musicDir, { recursive: true })

    const result = await validateLibraryPath(musicDir)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.normalizedPath).toBe(await fs.realpath(musicDir))
    }
  })

  it("rejects directories outside allowed roots", async () => {
    const result = await validateLibraryPath(externalRoot)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain("outside allowed library roots")
    }
  })

  it("allows configured extra roots", async () => {
    process.env.LIBRARY_ALLOWED_ROOTS = externalRoot
    const result = await validateLibraryPath(externalRoot)
    expect(result.ok).toBe(true)
  })
})
