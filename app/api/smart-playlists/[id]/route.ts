import { NextRequest, NextResponse } from "next/server"
import prisma from "../../../../lib/prisma"
import { AuthError, requireAuth } from "../../../../lib/requireAuth"
import { parseSmartPlaylistRule, parseSmartPlaylistRuleJson } from "../../../../lib/organization"

async function loadForUser(userId: number, idRaw: string) {
  const id = Number.parseInt(idRaw, 10)
  if (!Number.isInteger(id) || id <= 0) return null
  return prisma.smartPlaylist.findFirst({ where: { id, userId } })
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(request)
    const { id } = await context.params
    const current = await loadForUser(auth.userId, id)

    if (!current) {
      return NextResponse.json({ error: "Smart playlist not found" }, { status: 404 })
    }

    const body = await request.json().catch(() => ({}))
    const nextName = typeof body?.name === "string" ? body.name.trim() : ""

    const updateData: Record<string, unknown> = {}

    if (body && Object.prototype.hasOwnProperty.call(body, "name")) {
      if (!nextName) {
        return NextResponse.json({ error: "Playlist name is required" }, { status: 400 })
      }
      if (nextName.length > 80) {
        return NextResponse.json({ error: "Playlist name is too long" }, { status: 400 })
      }
      updateData.name = nextName
    }

    if (body && Object.prototype.hasOwnProperty.call(body, "rule")) {
      const { rule, errors } = parseSmartPlaylistRule(body.rule)
      if (errors.length > 0) {
        return NextResponse.json({ error: "Invalid smart playlist rule", details: errors }, { status: 400 })
      }
      updateData.ruleJson = JSON.stringify(rule)
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "No changes requested" }, { status: 400 })
    }

    const updated = await prisma.smartPlaylist.update({
      where: { id: current.id },
      data: updateData,
    })
    const parsedRule = parseSmartPlaylistRuleJson(updated.ruleJson)

    return NextResponse.json({
      ...updated,
      rule: parsedRule.rule,
      ruleErrors: parsedRule.errors,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: "Smart playlist already exists" }, { status: 409 })
    }
    console.error("Error updating smart playlist:", error)
    return NextResponse.json({ error: "Failed to update smart playlist" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(request)
    const { id } = await context.params
    const current = await loadForUser(auth.userId, id)

    if (!current) {
      return NextResponse.json({ error: "Smart playlist not found" }, { status: 404 })
    }

    await prisma.smartPlaylist.delete({ where: { id: current.id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("Error deleting smart playlist:", error)
    return NextResponse.json({ error: "Failed to delete smart playlist" }, { status: 500 })
  }
}
