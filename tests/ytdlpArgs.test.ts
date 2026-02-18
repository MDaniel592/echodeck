import { afterEach, describe, expect, it, vi } from "vitest"
import { buildYtdlpArgs } from "../lib/ytdlp"

describe("buildYtdlpArgs", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("uses node runtime by default", () => {
    vi.stubEnv("YTDLP_JS_RUNTIMES", "")
    const args = buildYtdlpArgs(["--dump-single-json", "https://youtube.com/watch?v=test"])

    expect(args.slice(0, 2)).toEqual(["--js-runtimes", "node"])
    expect(args).toEqual([
      "--js-runtimes",
      "node",
      "--dump-single-json",
      "https://youtube.com/watch?v=test",
    ])
  })

  it("honors YTDLP_JS_RUNTIMES override", () => {
    vi.stubEnv("YTDLP_JS_RUNTIMES", "node:/usr/local/bin/node,deno")
    const args = buildYtdlpArgs(["--version"])

    expect(args).toEqual([
      "--js-runtimes",
      "node:/usr/local/bin/node,deno",
      "--version",
    ])
  })
})
