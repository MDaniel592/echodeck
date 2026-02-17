import "dotenv/config"

interface EnvVar {
  name: string
  required: "always" | "production" | "never"
  description: string
}

const ENV_VARS: EnvVar[] = [
  { name: "DATABASE_URL", required: "always", description: "SQLite database path (e.g. file:./dev.db)" },
  { name: "JWT_SECRET", required: "always", description: "Secret for signing JWT tokens" },
  { name: "SETUP_SECRET", required: "production", description: "One-time setup secret for first-user creation in production" },
  { name: "TRUST_PROXY", required: "never", description: "Set to 1 only when behind a trusted reverse proxy" },
  { name: "DOWNLOAD_TASK_MAX_WORKERS", required: "never", description: "Max concurrent background download workers (1-20)" },
  { name: "TASK_SSE_POLL_MS", required: "never", description: "Task SSE snapshot poll interval in ms (minimum 2000)" },
  { name: "TASK_SSE_MAX_CLIENTS", required: "never", description: "Max concurrent clients for /api/tasks/stream" },
  { name: "TASK_DETAIL_SSE_MAX_CLIENTS", required: "never", description: "Max concurrent clients for /api/tasks/[id]/stream" },
  { name: "SPOTIFY_CLIENT_ID", required: "never", description: "Spotify API client ID" },
  { name: "SPOTIFY_CLIENT_SECRET", required: "never", description: "Spotify API client secret" },
  { name: "SPOTIFY_AUTH_TOKEN", required: "never", description: "Spotify auth token" },
  { name: "TIDAL_BASIC_AUTH", required: "never", description: "Tidal auth credential for provider matching" },
  { name: "TIDAL_TOKEN_HEADER", required: "never", description: "Tidal token header for provider matching" },
  { name: "QOBUZ_APP_ID", required: "never", description: "Qobuz app id for provider matching" },
  { name: "QOBUZ_LOGIN_EMAIL", required: "never", description: "Qobuz login email for provider matching" },
  { name: "QOBUZ_LOGIN_PASSWORD_MD5", required: "never", description: "Qobuz password hash for provider matching" },
  { name: "AMAZON_API_KEY", required: "never", description: "Amazon API key for provider matching" },
  { name: "YTDLP_VERSION", required: "never", description: "Pinned yt-dlp release version/tag (e.g. 2025.02.19)" },
  { name: "SPOTDL_VERSION", required: "never", description: "Pinned spotdl release version/tag (e.g. 4.2.11)" },
  { name: "FFMPEG_ARCHIVE_URL", required: "never", description: "Optional direct ffmpeg archive URL override (must include ffmpeg and ffprobe)" },
]

const nodeEnv = process.env.NODE_ENV || "development"
const isProduction = nodeEnv === "production"
let hasErrors = false

console.log(`Validating environment for NODE_ENV=${nodeEnv}\n`)

for (const v of ENV_VARS) {
  const value = process.env[v.name]
  const isSet = typeof value === "string" && value.length > 0
  const isRequired =
    v.required === "always" || (v.required === "production" && isProduction)

  if (isRequired && !isSet) {
    console.error(`  MISSING  ${v.name} — ${v.description}`)
    hasErrors = true
  } else if (isSet) {
    console.log(`  OK       ${v.name}`)
  } else {
    console.log(`  OPTIONAL ${v.name} (not set)`)
  }
}

function validateIntegerRange(name: string, min: number, max: number) {
  const raw = process.env[name]
  if (!raw) return
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    console.error(`  INVALID  ${name} — expected integer in range ${min}-${max}`)
    hasErrors = true
  }
}

function validateReleaseToken(name: string) {
  const raw = process.env[name]
  if (!raw) return
  if (!/^[A-Za-z0-9._-]+$/.test(raw)) {
    console.error(`  INVALID  ${name} — expected release token characters [A-Za-z0-9._-]`)
    hasErrors = true
  }
}

validateIntegerRange("DOWNLOAD_TASK_MAX_WORKERS", 1, 20)
validateIntegerRange("TASK_SSE_POLL_MS", 2000, 60000)
validateIntegerRange("TASK_SSE_MAX_CLIENTS", 1, 2000)
validateIntegerRange("TASK_DETAIL_SSE_MAX_CLIENTS", 1, 5000)
validateReleaseToken("YTDLP_VERSION")
validateReleaseToken("SPOTDL_VERSION")

if (isProduction && process.env.TRUST_PROXY !== "1") {
  console.log("  NOTE     TRUST_PROXY is not enabled. Enable only if behind a trusted reverse proxy.")
}

if (hasErrors) {
  console.error("\nEnvironment validation failed. Set the missing variables and try again.")
  process.exit(1)
} else {
  console.log("\nAll required environment variables are set.")
}
