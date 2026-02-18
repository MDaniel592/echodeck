import { NextRequest, NextResponse } from "next/server"
import { AuthError, requireAuth } from "../../../../lib/requireAuth"
import { searchSpotifyTracks } from "../../../../lib/spotdl"
import { searchAudioSource } from "../../../../lib/ytdlp"
import { redactSensitiveText } from "../../../../lib/sanitize"

type UnifiedSearchResult = {
  provider: "youtube" | "soundcloud" | "spotify"
  title: string
  artist: string | null
  url: string
  duration: number | null
  thumbnail: string | null
  album?: string | null
}

export async function GET(request: NextRequest) {
  try {
    await requireAuth(request)

    const q = (request.nextUrl.searchParams.get("q") || "").trim()
    if (q.length < 2) {
      return NextResponse.json({ error: "q must contain at least 2 characters" }, { status: 400 })
    }

    const parsedLimit = Number.parseInt(request.nextUrl.searchParams.get("limit") || "", 10)
    const limit = Number.isInteger(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 12) : 5
    const providerRaw = (request.nextUrl.searchParams.get("providers") || "youtube,soundcloud,spotify")
      .split(",")
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean)
    const providerSet = new Set(providerRaw)

    const tasks: Array<Promise<UnifiedSearchResult[]>> = []
    if (providerSet.has("youtube")) {
      tasks.push(searchAudioSource("youtube", q, limit))
    }
    if (providerSet.has("soundcloud")) {
      tasks.push(searchAudioSource("soundcloud", q, limit))
    }
    if (providerSet.has("spotify")) {
      tasks.push(searchSpotifyTracks(q, limit))
    }

    const settled = await Promise.allSettled(tasks)
    const results: UnifiedSearchResult[] = []
    const errors: string[] = []
    for (const item of settled) {
      if (item.status === "fulfilled") {
        results.push(...item.value)
      } else {
        errors.push(redactSensitiveText(item.reason instanceof Error ? item.reason.message : "Search failed"))
      }
    }

    return NextResponse.json({
      query: q,
      limit,
      results,
      errors,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const message = redactSensitiveText(error instanceof Error ? error.message : "Failed to run source search")
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
