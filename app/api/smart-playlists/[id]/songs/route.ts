import { NextRequest, NextResponse } from "next/server"
import prisma from "../../../../../lib/prisma"
import { AuthError, requireAuth } from "../../../../../lib/requireAuth"
import { sanitizeSong } from "../../../../../lib/sanitize"
import {
  buildSmartPlaylistWhere,
  parseSmartPlaylistRuleJson,
  resolveSmartPlaylistLimit,
  resolveSmartPlaylistOrder,
} from "../../../../../lib/organization"

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(request)
    const { id } = await context.params
    const parsedId = Number.parseInt(id, 10)

    if (!Number.isInteger(parsedId) || parsedId <= 0) {
      return NextResponse.json({ error: "Invalid smart playlist id" }, { status: 400 })
    }

    const list = await prisma.smartPlaylist.findFirst({
      where: { id: parsedId, userId: auth.userId },
    })
    if (!list) {
      return NextResponse.json({ error: "Smart playlist not found" }, { status: 404 })
    }

    const parsedRule = parseSmartPlaylistRuleJson(list.ruleJson)
    if (parsedRule.invalidJson) {
      return NextResponse.json(
        { error: "Smart playlist rule is invalid", details: parsedRule.errors },
        { status: 422 }
      )
    }
    const rule = parsedRule.rule

    const searchParams = request.nextUrl.searchParams
    const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1)
    const limit = Math.min(
      1000,
      Math.max(1, Number.parseInt(searchParams.get("limit") || String(resolveSmartPlaylistLimit(rule)), 10) || resolveSmartPlaylistLimit(rule))
    )
    const skip = (page - 1) * limit

    const where = buildSmartPlaylistWhere(auth.userId, rule)
    const orderBy = resolveSmartPlaylistOrder(rule)

    const [songs, total] = await Promise.all([
      prisma.song.findMany({
        where,
        orderBy,
        skip,
        take: limit,
      }),
      prisma.song.count({ where }),
    ])

    return NextResponse.json({
      smartPlaylist: {
        id: list.id,
        name: list.name,
        rule,
        ruleErrors: parsedRule.errors,
      },
      songs: songs.map(sanitizeSong),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Error resolving smart playlist songs:", error)
    return NextResponse.json({ error: "Failed to resolve smart playlist songs" }, { status: 500 })
  }
}
