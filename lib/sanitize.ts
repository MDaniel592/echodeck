/**
 * Strip internal fields (filePath, coverPath) from song objects
 * before returning them to clients.
 */
export function sanitizeSong<T extends Record<string, unknown>>(
  song: T
): Omit<T, "filePath" | "coverPath"> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { filePath, coverPath, ...safe } = song
  return safe as Omit<T, "filePath" | "coverPath">
}

const SENSITIVE_ENV_NAMES = [
  "JWT_SECRET",
  "SETUP_SECRET",
  "SPOTIFY_CLIENT_SECRET",
  "SPOTIFY_AUTH_TOKEN",
  "TIDAL_BASIC_AUTH",
  "TIDAL_TOKEN_HEADER",
  "QOBUZ_APP_ID",
  "QOBUZ_LOGIN_EMAIL",
  "QOBUZ_LOGIN_PASSWORD_MD5",
  "AMAZON_API_KEY",
]

const SENSITIVE_LABEL_PATTERN = new RegExp(
  `\\b(${SENSITIVE_ENV_NAMES.join("|")})\\s*=\\s*([^\\s"'\\x60]+)`,
  "gi"
)
const AUTH_HEADER_PATTERN = /\b(authorization\s*:\s*(?:bearer|basic)\s+)([^\s"'`]+)/gi

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function isLikelySecretValue(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length < 8) return false
  if (/^\d+$/.test(trimmed)) return false
  if (/^[A-Za-z]+$/.test(trimmed) && trimmed.length < 20) return false
  return true
}

const SENSITIVE_ENV_VALUES = Array.from(
  new Set(
    SENSITIVE_ENV_NAMES.map((name) => process.env[name]?.trim())
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .filter((value) => isLikelySecretValue(value))
      .sort((a, b) => b.length - a.length)
  )
)

export function redactSensitiveText(input: string): string {
  if (!input) return input

  let redacted = input

  for (const value of SENSITIVE_ENV_VALUES) {
    redacted = redacted.replace(new RegExp(escapeRegex(value), "g"), "[REDACTED]")
  }

  redacted = redacted.replace(SENSITIVE_LABEL_PATTERN, "$1=[REDACTED]")
  redacted = redacted.replace(AUTH_HEADER_PATTERN, "$1[REDACTED]")
  return redacted
}
