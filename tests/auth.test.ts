import { describe, it, expect, beforeEach, vi } from "vitest"

// Mock jsonwebtoken and bcryptjs before importing the module
vi.mock("jsonwebtoken", () => ({
  default: {
    sign: vi.fn(() => "mock-token"),
    verify: vi.fn((token: string) => {
      if (token === "valid-token") return { userId: 1, tokenVersion: 2 }
      throw new Error("invalid token")
    }),
  },
}))

vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn(async (password: string) => `hashed:${password}`),
    compare: vi.fn(async (password: string, hash: string) => hash === `hashed:${password}`),
  },
}))

describe("auth", () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  it("validateAuthConfig throws if JWT_SECRET is missing", async () => {
    vi.stubEnv("JWT_SECRET", "")
    // Re-import to get fresh module
    const { validateAuthConfig } = await import("../lib/auth")
    expect(() => validateAuthConfig()).toThrow("JWT_SECRET")
  })

  it("validateAuthConfig succeeds with JWT_SECRET set", async () => {
    vi.stubEnv("JWT_SECRET", "test-secret-123")
    const { validateAuthConfig } = await import("../lib/auth")
    expect(() => validateAuthConfig()).not.toThrow()
  })

  it("hashPassword returns a hashed value", async () => {
    vi.stubEnv("JWT_SECRET", "test-secret")
    const { hashPassword } = await import("../lib/auth")
    const hash = await hashPassword("mypassword")
    expect(hash).toBe("hashed:mypassword")
  })

  it("verifyPassword returns true for correct password", async () => {
    vi.stubEnv("JWT_SECRET", "test-secret")
    const { verifyPassword } = await import("../lib/auth")
    const result = await verifyPassword("mypassword", "hashed:mypassword")
    expect(result).toBe(true)
  })

  it("verifyPassword returns false for wrong password", async () => {
    vi.stubEnv("JWT_SECRET", "test-secret")
    const { verifyPassword } = await import("../lib/auth")
    const result = await verifyPassword("wrong", "hashed:mypassword")
    expect(result).toBe(false)
  })

  it("createToken returns a token string", async () => {
    vi.stubEnv("JWT_SECRET", "test-secret")
    const { createToken } = await import("../lib/auth")
    const token = createToken(1)
    expect(token).toBe("mock-token")
  })

  it("verifyToken returns payload for valid token", async () => {
    vi.stubEnv("JWT_SECRET", "test-secret")
    const { verifyToken } = await import("../lib/auth")
    const result = verifyToken("valid-token")
    expect(result).toEqual({ userId: 1, tokenVersion: 2 })
  })

  it("verifyToken returns null for invalid token", async () => {
    vi.stubEnv("JWT_SECRET", "test-secret")
    const { verifyToken } = await import("../lib/auth")
    const result = verifyToken("invalid-token")
    expect(result).toBeNull()
  })
})
