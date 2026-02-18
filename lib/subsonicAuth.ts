import { NextRequest } from "next/server"
import prisma from "./prisma"
import { verifyPassword } from "./auth"
import { checkRateLimit } from "./rateLimit"
import { getClientIdentifier } from "./clientIdentity"
import {
  createSubsonicTokenFromPassword,
  decryptSubsonicPassword,
  encryptSubsonicPassword,
} from "./subsonicPassword"

export type SubsonicUser = {
  id: number
  username: string
}

export type SubsonicAuthResult =
  | { ok: true; user: SubsonicUser }
  | { ok: false; rateLimited: false }
  | { ok: false; rateLimited: true; retryAfterSeconds: number }

const SUBSONIC_MAX_FAILED_ATTEMPTS_PER_ACCOUNT = 20
const SUBSONIC_MAX_FAILED_ATTEMPTS_PER_CLIENT = 80
const SUBSONIC_WINDOW_MS = 15 * 60 * 1000

function decodePassword(raw: string): string {
  if (raw.startsWith("enc:")) {
    const hex = raw.slice(4)
    return Buffer.from(hex, "hex").toString("utf8")
  }
  return raw
}

export async function authenticateSubsonicRequest(
  request: NextRequest
): Promise<SubsonicAuthResult> {
  const username = request.nextUrl.searchParams.get("u")?.trim() || ""
  const passwordRaw = request.nextUrl.searchParams.get("p") || ""
  const tokenRaw = request.nextUrl.searchParams.get("t") || ""
  const salt = request.nextUrl.searchParams.get("s") || ""
  if (!username || (!passwordRaw && !(tokenRaw && salt))) return { ok: false, rateLimited: false }

  const user = await prisma.user.findUnique({
    where: { username },
    select: {
      id: true,
      username: true,
      passwordHash: true,
      subsonicToken: true,
      subsonicPasswordEnc: true,
      disabledAt: true,
    },
  })
  if (!user || user.disabledAt) return { ok: false, rateLimited: false }

  let valid = false
  if (passwordRaw) {
    const password = decodePassword(passwordRaw)
    valid = await verifyPassword(password, user.passwordHash)
    if (valid && !user.subsonicPasswordEnc) {
      const encrypted = encryptSubsonicPassword(password)
      if (encrypted) {
        await prisma.user.update({
          where: { id: user.id },
          data: { subsonicPasswordEnc: encrypted },
        }).catch(() => {})
      }
    }
  } else if (tokenRaw && salt) {
    const storedPassword = decryptSubsonicPassword(user.subsonicPasswordEnc)
    if (storedPassword) {
      const expectedFromPassword = createSubsonicTokenFromPassword(storedPassword, salt)
      valid = expectedFromPassword.toLowerCase() === tokenRaw.toLowerCase()
    }

    if (!valid && user.subsonicToken) {
      const expectedFromLegacyToken = createSubsonicTokenFromPassword(user.subsonicToken, salt)
      valid = expectedFromLegacyToken.toLowerCase() === tokenRaw.toLowerCase()
    }
  }

  if (!valid) {
    const client = getClientIdentifier(request, "subsonic")
    const perClientLimit = await checkRateLimit(
      `subsonic:failed:client:${client}`,
      SUBSONIC_MAX_FAILED_ATTEMPTS_PER_CLIENT,
      SUBSONIC_WINDOW_MS
    )
    const accountKey = `subsonic:failed:account:${username.toLowerCase()}:${client}`
    const accountLimit = await checkRateLimit(
      accountKey,
      SUBSONIC_MAX_FAILED_ATTEMPTS_PER_ACCOUNT,
      SUBSONIC_WINDOW_MS
    )
    if (!perClientLimit.allowed || !accountLimit.allowed) {
      const retryAfterSeconds = Math.max(
        perClientLimit.retryAfterSeconds || 0,
        accountLimit.retryAfterSeconds || 0,
        1
      )
      return { ok: false, rateLimited: true, retryAfterSeconds }
    }
    return { ok: false, rateLimited: false }
  }

  return { ok: true, user: { id: user.id, username: user.username } }
}
