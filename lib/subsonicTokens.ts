import crypto from "crypto"
import prisma from "./prisma"

export async function ensureSubsonicTokens(): Promise<number> {
  const users = await prisma.user.findMany({
    where: { subsonicToken: null },
    select: { id: true },
  })

  if (users.length === 0) return 0

  await Promise.all(
    users.map((user) =>
      prisma.user.update({
        where: { id: user.id },
        data: { subsonicToken: crypto.randomBytes(24).toString("hex") },
      })
    )
  )

  return users.length
}
