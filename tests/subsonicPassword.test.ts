import { describe, expect, it, vi, beforeEach } from "vitest"
import {
  createSubsonicTokenFromPassword,
  decryptSubsonicPassword,
  encryptSubsonicPassword,
} from "../lib/subsonicPassword"

describe("subsonicPassword", () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  it("encrypts and decrypts with configured key", () => {
    vi.stubEnv("JWT_SECRET", "test-jwt-secret")
    const encrypted = encryptSubsonicPassword("pass123")
    expect(encrypted).toBeTypeOf("string")

    const decrypted = decryptSubsonicPassword(encrypted)
    expect(decrypted).toBe("pass123")
  })

  it("returns null without key material", () => {
    vi.stubEnv("JWT_SECRET", "")
    vi.stubEnv("SUBSONIC_PASSWORD_KEY", "")
    expect(encryptSubsonicPassword("pass123")).toBeNull()
    expect(decryptSubsonicPassword("deadbeef")).toBeNull()
  })

  it("creates md5 token from password+salt", () => {
    const token = createSubsonicTokenFromPassword("pass", "salt")
    expect(token).toBe("83234657c5df8232839ac8c0572e158d")
  })
})
