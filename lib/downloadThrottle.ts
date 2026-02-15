export function randomIntInRange(min: number, max: number): number {
  const safeMin = Math.floor(Math.min(min, max))
  const safeMax = Math.floor(Math.max(min, max))
  return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms))
  })
}

export async function waitRandomDelay(minMs: number, maxMs: number): Promise<number> {
  const delayMs = randomIntInRange(minMs, maxMs)
  await sleep(delayMs)
  return delayMs
}
