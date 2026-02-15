import { NextRequest } from "next/server"
import { GET as rootGet } from "../route"

function extractCommand(segments: string[] | undefined): string | null {
  if (!segments || segments.length === 0) return null
  const normalized = segments.filter(Boolean)
  if (normalized.length === 0) return null

  // Some clients call `/rest/<command>` while others call `/<command>.view`.
  const head = normalized[0].toLowerCase()
  const candidate = head === "rest" && normalized.length > 1 ? normalized[1] : normalized[0]
  if (!candidate) return null
  return candidate.replace(/\.view$/i, "")
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ command?: string[] }> }
) {
  const { command } = await params
  const extracted = extractCommand(command)
  if (!extracted) {
    return new Response("Invalid command", { status: 400 })
  }

  const target = new URL("/api/subsonic/rest", request.url)
  target.search = request.nextUrl.search
  target.searchParams.set("command", extracted)
  const forwarded = new NextRequest(target, request)
  return rootGet(forwarded)
}
