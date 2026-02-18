import { describe, expect, it } from "vitest"
import packageJson from "../package.json"

describe("runtime dependencies", () => {
  it("keeps tsx in production dependencies for detached workers", () => {
    expect(packageJson.dependencies?.tsx).toBeTruthy()
  })
})
