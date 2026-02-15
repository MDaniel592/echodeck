import { execSync } from "child_process"
import fs from "fs"
import path from "path"
import https from "https"
import http from "http"
import { createHash } from "crypto"

const BIN_DIR = path.join(process.cwd(), "bin")
const DOWNLOADS_DIR = path.join(process.cwd(), "downloads")
const PRISMA_SCHEMA_PATH = path.join(process.cwd(), "prisma", "schema.prisma")
const PRISMA_CONFIG_PATH = path.join(process.cwd(), "prisma.config.ts")

function normalizeVersion(value: string): string {
  return value.trim().replace(/^v/i, "")
}

function readOptionalVersionEnv(name: string): string | undefined {
  const raw = process.env[name]
  if (!raw) return undefined
  const normalized = normalizeVersion(raw)
  return normalized.length > 0 ? normalized : undefined
}

function sha256File(filePath: string): string {
  const hash = createHash("sha256")
  const data = fs.readFileSync(filePath)
  hash.update(data)
  return hash.digest("hex")
}

function verifyOptionalSha256(filePath: string, expectedSha256: string | undefined, label: string) {
  const expected = expectedSha256?.trim().toLowerCase()
  if (!expected) return
  const actual = sha256File(filePath)
  if (actual !== expected) {
    throw new Error(`${label} checksum mismatch. expected=${expected} actual=${actual}`)
  }
  console.log(`  ${label}: checksum verified`)
}

function follow(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http
    client.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const location = res.headers.location
        if (!location) return reject(new Error("Redirect with no location"))
        return follow(location, dest).then(resolve).catch(reject)
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`))
      }
      const file = fs.createWriteStream(dest)
      res.pipe(file)
      file.on("finish", () => { file.close(); resolve() })
      file.on("error", reject)
    }).on("error", reject)
  })
}

function fetchJson(url: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { "User-Agent": "music-player-setup" },
    }, (res) => {
      let data = ""
      res.on("data", (chunk) => data += chunk)
      res.on("end", () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`Failed to fetch ${url}: HTTP ${res.statusCode}`))
        }
        try {
          const json = JSON.parse(data) as Record<string, unknown>
          resolve(json)
        } catch {
          reject(new Error(`Failed to parse JSON from ${url}`))
        }
      })
    }).on("error", reject)
  })
}

async function fetchLatestReleaseTag(repo: string): Promise<string> {
  const json = await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`)
  const tag = json.tag_name
  if (typeof tag !== "string" || tag.trim().length === 0) {
    throw new Error(`Missing tag_name in latest release response for ${repo}`)
  }
  return tag.trim()
}

async function main() {
  const lifecycleEvent = process.env.npm_lifecycle_event
  if (lifecycleEvent === "postinstall" && process.env.ENABLE_AUTO_SETUP !== "1") {
    console.log(
      "postinstall auto-setup is disabled by default for security. " +
      "Run `npm run setup` manually or set ENABLE_AUTO_SETUP=1 to allow it."
    )
    return
  }

  if (process.env.SKIP_SETUP === "1") {
    console.log("SKIP_SETUP=1, skipping binary downloads and db push.")
    return
  }

  // Ensure directories exist
  fs.mkdirSync(BIN_DIR, { recursive: true })
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true })

  const ytdlpPath = path.join(BIN_DIR, "yt-dlp")
  const requestedYtdlpVersion = readOptionalVersionEnv("YTDLP_VERSION")
  let installedYtdlpVersion: string | undefined

  // Check if yt-dlp already exists
  if (fs.existsSync(ytdlpPath)) {
    try {
      const version = execSync(`"${ytdlpPath}" --version`, { encoding: "utf-8" }).trim()
      installedYtdlpVersion = version
      console.log(`  yt-dlp: already installed (${version})`)
      if (requestedYtdlpVersion && normalizeVersion(version) !== requestedYtdlpVersion) {
        console.log(`  yt-dlp: installed version does not match YTDLP_VERSION=${requestedYtdlpVersion}, re-downloading...`)
        fs.unlinkSync(ytdlpPath)
      }
    } catch {
      console.log("  yt-dlp: exists but broken, re-downloading...")
      fs.unlinkSync(ytdlpPath)
    }
  }

  if (!fs.existsSync(ytdlpPath)) {
    const arch = process.arch === "arm64" ? "aarch64" : ""
    const asset = arch ? `yt-dlp_linux_${arch}` : "yt-dlp_linux"
    let releaseTag: string

    if (requestedYtdlpVersion) {
      releaseTag = requestedYtdlpVersion
      console.log(`  Using pinned yt-dlp release ${releaseTag} from YTDLP_VERSION`)
    } else {
      console.log("  Fetching latest yt-dlp release...")
      releaseTag = await fetchLatestReleaseTag("yt-dlp/yt-dlp")
    }

    const url = `https://github.com/yt-dlp/yt-dlp/releases/download/${releaseTag}/${asset}`
    console.log(`  Downloading yt-dlp ${releaseTag} (${asset})...`)
    await follow(url, ytdlpPath)
    verifyOptionalSha256(ytdlpPath, process.env.YTDLP_SHA256, "yt-dlp")
    fs.chmodSync(ytdlpPath, 0o755)

    const version = execSync(`"${ytdlpPath}" --version`, { encoding: "utf-8" }).trim()
    if (requestedYtdlpVersion && normalizeVersion(version) !== requestedYtdlpVersion) {
      throw new Error(`yt-dlp installed version mismatch. expected=${requestedYtdlpVersion} actual=${normalizeVersion(version)}`)
    }
    console.log(`  yt-dlp: installed (${version})`)
  } else if (requestedYtdlpVersion && installedYtdlpVersion) {
    console.log(`  yt-dlp: using pinned version ${requestedYtdlpVersion}`)
  }

  // Download spotdl
  const spotdlPath = path.join(BIN_DIR, "spotdl")
  const requestedSpotdlVersion = readOptionalVersionEnv("SPOTDL_VERSION")
  let installedSpotdlVersion: string | undefined

  if (fs.existsSync(spotdlPath)) {
    try {
      const version = execSync(`"${spotdlPath}" --version`, { encoding: "utf-8" }).trim()
      installedSpotdlVersion = version
      console.log(`  spotdl: already installed (${version})`)
      if (requestedSpotdlVersion && normalizeVersion(version) !== requestedSpotdlVersion) {
        console.log(`  spotdl: installed version does not match SPOTDL_VERSION=${requestedSpotdlVersion}, re-downloading...`)
        fs.unlinkSync(spotdlPath)
      }
    } catch {
      console.log("  spotdl: exists but broken, re-downloading...")
      fs.unlinkSync(spotdlPath)
    }
  }

  if (!fs.existsSync(spotdlPath)) {
    let spotdlTag: string
    if (requestedSpotdlVersion) {
      spotdlTag = `v${requestedSpotdlVersion}`
      console.log(`  Using pinned spotdl release ${spotdlTag} from SPOTDL_VERSION`)
    } else {
      console.log("  Fetching latest spotdl release...")
      spotdlTag = await fetchLatestReleaseTag("spotDL/spotify-downloader")
    }

    const spotdlVersion = normalizeVersion(spotdlTag)
    const spotdlAsset = `spotdl-${spotdlVersion}-linux`
    const spotdlUrl = `https://github.com/spotDL/spotify-downloader/releases/download/${spotdlTag}/${spotdlAsset}`
    console.log(`  Downloading spotdl ${spotdlTag} (${spotdlAsset})...`)
    await follow(spotdlUrl, spotdlPath)
    verifyOptionalSha256(spotdlPath, process.env.SPOTDL_SHA256, "spotdl")
    fs.chmodSync(spotdlPath, 0o755)

    const version = execSync(`"${spotdlPath}" --version`, { encoding: "utf-8" }).trim()
    if (requestedSpotdlVersion && normalizeVersion(version) !== requestedSpotdlVersion) {
      throw new Error(`spotdl installed version mismatch. expected=${requestedSpotdlVersion} actual=${normalizeVersion(version)}`)
    }
    console.log(`  spotdl: installed (${version})`)
  } else if (requestedSpotdlVersion && installedSpotdlVersion) {
    console.log(`  spotdl: using pinned version ${requestedSpotdlVersion}`)
  }

  // Check ffmpeg-static
  try {
    const { default: ffmpegPath } = await import("ffmpeg-static")
    if (!ffmpegPath) {
      throw new Error("ffmpeg-static returned no path")
    }
    console.log(`  ffmpeg: ${ffmpegPath}`)
  } catch {
    console.log("  ffmpeg: NOT FOUND - run: npm install ffmpeg-static")
  }

  // Keep local DB schema in sync for new installs when Prisma files are available.
  if (fs.existsSync(PRISMA_SCHEMA_PATH) && fs.existsSync(PRISMA_CONFIG_PATH)) {
    try {
      console.log("  Syncing database schema (prisma db push)...")
      execSync("npm run db:push", { stdio: "inherit" })
    } catch {
      console.log("  prisma: db push failed during setup; app startup will retry.")
    }
  } else {
    console.log("  prisma: schema/config not present yet, skipping db push")
  }

  console.log("\nSetup complete!")
}

main().catch((err) => {
  console.error("Setup failed:", err)
  process.exit(1)
})
