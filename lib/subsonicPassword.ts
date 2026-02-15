import crypto from "crypto"

function getSecretMaterial(): string | null {
  return process.env.SUBSONIC_PASSWORD_KEY || process.env.JWT_SECRET || null
}

function getKey(): Buffer | null {
  const secret = getSecretMaterial()
  if (!secret) return null
  return crypto.createHash("sha256").update(secret).digest()
}

export function encryptSubsonicPassword(password: string): string | null {
  const key = getKey()
  if (!key) return null

  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)
  const ciphertext = Buffer.concat([cipher.update(password, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()

  return `${iv.toString("hex")}:${tag.toString("hex")}:${ciphertext.toString("hex")}`
}

export function decryptSubsonicPassword(payload: string | null | undefined): string | null {
  if (!payload) return null

  const key = getKey()
  if (!key) return null

  const parts = payload.split(":")
  if (parts.length !== 3) return null

  const [ivHex, tagHex, dataHex] = parts
  if (!ivHex || !tagHex || !dataHex) return null

  try {
    const iv = Buffer.from(ivHex, "hex")
    const tag = Buffer.from(tagHex, "hex")
    const ciphertext = Buffer.from(dataHex, "hex")
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return plaintext.toString("utf8")
  } catch {
    return null
  }
}

export function createSubsonicTokenFromPassword(password: string, salt: string): string {
  return crypto.createHash("md5").update(`${password}${salt}`).digest("hex")
}
