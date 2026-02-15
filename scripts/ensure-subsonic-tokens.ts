import { ensureSubsonicTokens } from "../lib/subsonicTokens"
import prisma from "../lib/prisma"

async function main() {
  const updated = await ensureSubsonicTokens()
  console.log(`Subsonic token ensure complete: generated=${updated}`)
}

main()
  .catch((error) => {
    console.error("Failed to ensure Subsonic tokens:", error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
