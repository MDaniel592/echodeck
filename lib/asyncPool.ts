export async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
) {
  const total = items.length
  if (total === 0) return

  const limit = Math.max(1, Math.floor(concurrency))
  const workerCount = Math.min(limit, total)

  let nextIndex = 0
  let firstError: unknown = null

  const runWorker = async () => {
    while (true) {
      if (firstError) return

      const index = nextIndex
      if (index >= total) return
      nextIndex += 1

      try {
        await worker(items[index], index)
      } catch (error) {
        if (!firstError) {
          firstError = error
        }
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()))

  if (firstError) {
    throw firstError
  }
}
