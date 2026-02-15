import { NextRequest } from "next/server"

function extractCommand(segments: string[] | undefined): string | null {
  if (!segments || segments.length === 0) return null
  const first = segments[0] || ""
  if (!first) return null
  return first.replace(/\.view$/i, "")
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

  return Response.redirect(target, 307)
}
