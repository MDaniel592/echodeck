type JsonRecord = Record<string, unknown>

const BASE_URL = (process.env.BASE_URL || "http://127.0.0.1:3000").replace(/\/+$/, "")
const USERNAME = process.env.ITEST_USERNAME || "ci-admin"
const PASSWORD = process.env.ITEST_PASSWORD || "ci-password-123"
const SETUP_SECRET = process.env.ITEST_SETUP_SECRET || ""
const TIMEOUT_MS = Number.parseInt(process.env.ITEST_TIMEOUT_MS || "120000", 10)

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function parseAuthCookie(setCookie: string | null): string {
  if (!setCookie) return ""
  const parts = setCookie.split(",")
  for (const part of parts) {
    const trimmed = part.trim()
    if (trimmed.startsWith("auth_token=")) {
      return trimmed.split(";")[0]
    }
  }
  return ""
}

async function requestJson(
  path: string,
  init: RequestInit = {}
): Promise<{ status: number; body: JsonRecord; setCookie: string | null }> {
  const res = await fetch(`${BASE_URL}${path}`, init)
  const body = (await res.json().catch(() => ({}))) as JsonRecord
  return {
    status: res.status,
    body,
    setCookie: res.headers.get("set-cookie"),
  }
}

async function waitForServer(): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < TIMEOUT_MS) {
    try {
      const res = await fetch(`${BASE_URL}/api/auth/check`, { cache: "no-store" })
      if (res.ok) return
    } catch {
      // server not ready yet
    }
    await sleep(1000)
  }
  throw new Error(`Server not ready within ${TIMEOUT_MS}ms at ${BASE_URL}`)
}

async function main() {
  console.log(`Integration smoke: waiting for server at ${BASE_URL}`)
  await waitForServer()

  console.log("Integration smoke: checking unauthenticated setup state")
  const checkBefore = await requestJson("/api/auth/check")
  assert(checkBefore.status === 200, `Expected 200 for auth check, got ${checkBefore.status}`)
  assert(checkBefore.body.authenticated === false, "Expected unauthenticated before setup")
  let authCookie = ""

  if (checkBefore.body.needsSetup === true) {
    console.log("Integration smoke: creating first user via setup")
    const setup = await requestJson("/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: USERNAME,
        password: PASSWORD,
        ...(SETUP_SECRET ? { setupSecret: SETUP_SECRET } : {}),
      }),
    })
    assert(setup.status === 200, `Expected 200 for setup, got ${setup.status}`)
    assert(setup.body.success === true, "Expected setup success=true")
    authCookie = parseAuthCookie(setup.setCookie)
    assert(authCookie.length > 0, "Expected auth_token cookie after setup")
  } else {
    console.log("Integration smoke: setup already complete, using login flow")
    const login = await requestJson("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: USERNAME,
        password: PASSWORD,
      }),
    })
    assert(login.status === 200, `Expected 200 for login, got ${login.status}`)
    assert(login.body.success === true, "Expected login success=true")
    authCookie = parseAuthCookie(login.setCookie)
    assert(authCookie.length > 0, "Expected auth_token cookie after login")
  }

  const cookieHeaders = { Cookie: authCookie }

  console.log("Integration smoke: verifying authenticated session")
  const checkAfter = await requestJson("/api/auth/check", { headers: cookieHeaders })
  assert(checkAfter.status === 200, `Expected 200 for auth check after setup, got ${checkAfter.status}`)
  assert(checkAfter.body.authenticated === true, "Expected authenticated=true after setup")
  assert((checkAfter.body.user as JsonRecord | undefined)?.username === USERNAME, "Unexpected user after setup")

  console.log("Integration smoke: reading protected songs endpoint")
  const songs = await requestJson("/api/songs?page=1&limit=5", { headers: cookieHeaders })
  assert(songs.status === 200, `Expected 200 for /api/songs, got ${songs.status}`)
  assert(Array.isArray(songs.body.songs), "Expected songs array in /api/songs response")

  console.log("Integration smoke: logout and verify unauthenticated")
  const logout = await requestJson("/api/auth/logout", { method: "POST", headers: cookieHeaders })
  assert(logout.status === 200, `Expected 200 for logout, got ${logout.status}`)

  const checkLoggedOut = await requestJson("/api/auth/check")
  assert(checkLoggedOut.status === 200, `Expected 200 for auth check after logout, got ${checkLoggedOut.status}`)
  assert(checkLoggedOut.body.authenticated === false, "Expected authenticated=false after logout")

  console.log("Integration smoke: success")
}

main().catch((error) => {
  console.error("Integration smoke failed:", error instanceof Error ? error.message : String(error))
  process.exit(1)
})
