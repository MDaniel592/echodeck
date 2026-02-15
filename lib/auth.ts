import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"

const SALT_ROUNDS = 12

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error(
      "JWT_SECRET environment variable is not set. " +
      "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    )
  }
  return secret
}

/**
 * Call at application startup to fail fast if JWT_SECRET is missing.
 * Throws with a descriptive message.
 */
export function validateAuthConfig(): void {
  getJwtSecret()
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS)
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export function createToken(userId: number, tokenVersion = 0): string {
  return jwt.sign({ userId, tokenVersion }, getJwtSecret(), { expiresIn: "7d" })
}

export function verifyToken(token: string): { userId: number; tokenVersion?: number } | null {
  try {
    const payload = jwt.verify(token, getJwtSecret()) as { userId: number; tokenVersion?: number }
    return payload
  } catch {
    return null
  }
}
