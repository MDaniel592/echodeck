import { execSync } from "child_process"
import fs from "fs"
import path from "path"

async function main() {
  console.log("Checking dependencies...\n")

  let allOk = true

  // Check yt-dlp (bundled in bin/)
  const ytdlpPath = path.join(process.cwd(), "bin", "yt-dlp")
  if (fs.existsSync(ytdlpPath)) {
    try {
      const version = execSync(`"${ytdlpPath}" --version`, { encoding: "utf-8" }).trim()
      console.log(`  yt-dlp: ${version} (bundled)`)
    } catch {
      console.log("  yt-dlp: binary exists but failed to run")
      allOk = false
    }
  } else {
    console.log("  yt-dlp: NOT FOUND — run: npm run setup")
    allOk = false
  }

  // Check ffmpeg (bundled via ffmpeg-static)
  try {
    const { default: ffmpegPath } = await import("ffmpeg-static")
    if (ffmpegPath && fs.existsSync(ffmpegPath)) {
      let ffmpegVersion = "unknown"
      try {
        const firstLine = execSync(`"${ffmpegPath}" -version`, { encoding: "utf-8" }).split("\n")[0]?.trim()
        if (firstLine) ffmpegVersion = firstLine
      } catch {
        // Keep path output even if -version cannot execute in this environment.
      }
      console.log(`  ffmpeg: ${ffmpegPath} (bundled)`)
      console.log(`          ${ffmpegVersion}`)
    } else {
      console.log("  ffmpeg: ffmpeg-static installed but binary missing")
      allOk = false
    }
  } catch {
    console.log("  ffmpeg: NOT FOUND — run: npm install ffmpeg-static")
    allOk = false
  }

  // Check spotdl (bundled in bin/)
  const spotdlPath = path.join(process.cwd(), "bin", "spotdl")
  if (fs.existsSync(spotdlPath)) {
    try {
      const version = execSync(`"${spotdlPath}" --version`, { encoding: "utf-8" }).trim()
      console.log(`  spotdl: ${version} (bundled)`)
    } catch {
      console.log("  spotdl: binary exists but failed to run")
      allOk = false
    }
  } else {
    console.log("  spotdl: NOT FOUND — run: npm run setup")
    allOk = false
  }

  console.log("")
  if (allOk) {
    console.log("All required dependencies are ready!")
  } else {
    console.log("Some dependencies are missing. Run: npm run setup")
    process.exit(1)
  }
}

main().catch((error) => {
  console.error("Dependency check failed:", error)
  process.exit(1)
})
