import { NextRequest, NextResponse } from "next/server"
import prisma from "../../../lib/prisma"
import { AuthError, requireAuth } from "../../../lib/requireAuth"
import {
  buildSmartPlaylistWhere,
  parseSmartPlaylistRule,
  parseSmartPlaylistRuleJson,
  resolveSmartPlaylistLimit,
  resolveSmartPlaylistOrder,
} from "../../../lib/organization"
import { runWithConcurrency } from "../../../lib/asyncPool"

const SMART_PLAYLIST_COUNT_CONCURRENCY = 4

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request)
    const includeCounts = request.nextUrl.searchParams.get("includeCounts") !== "0"
    const lists = await prisma.smartPlaylist.findMany({
      where: { userId: auth.userId },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    })

    const normalized = lists.map((list) => {
      const parsed = parseSmartPlaylistRuleJson(list.ruleJson)
      return {
        ...list,
        rule: parsed.rule,
        ruleErrors: parsed.errors,
        estimatedSongCount: null as number | null,
      }
    })

    if (includeCounts && normalized.length > 0) {
      await runWithConcurrency(normalized, SMART_PLAYLIST_COUNT_CONCURRENCY, async (list, index) => {
        const where = buildSmartPlaylistWhere(auth.userId, list.rule)
        const total = await prisma.song.count({ where })
        normalized[index].estimatedSongCount = total
      })
    }

    return NextResponse.json(normalized)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Error fetching smart playlists:", error)
    return NextResponse.json({ error: "Failed to fetch smart playlists" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request)
    const body = await request.json().catch(() => ({}))
    const name = typeof body?.name === "string" ? body.name.trim() : ""

    if (!name) {
      return NextResponse.json({ error: "Playlist name is required" }, { status: 400 })
    }
    if (name.length > 80) {
      return NextResponse.json({ error: "Playlist name is too long" }, { status: 400 })
    }

    const { rule, errors } = parseSmartPlaylistRule(body?.rule)
    if (errors.length > 0) {
      return NextResponse.json({ error: "Invalid smart playlist rule", details: errors }, { status: 400 })
    }

    const where = buildSmartPlaylistWhere(auth.userId, rule)
    const [created, estimatedSongCount] = await Promise.all([
      prisma.smartPlaylist.create({
        data: {
          userId: auth.userId,
          name,
          ruleJson: JSON.stringify(rule),
        },
      }),
      prisma.song.count({ where }),
    ])

    return NextResponse.json(
      {
        ...created,
        rule,
        estimatedSongCount,
        defaultOrder: resolveSmartPlaylistOrder(rule),
        defaultLimit: resolveSmartPlaylistLimit(rule),
      },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: "Smart playlist already exists" }, { status: 409 })
    }
    console.error("Error creating smart playlist:", error)
    return NextResponse.json({ error: "Failed to create smart playlist" }, { status: 500 })
  }
}
