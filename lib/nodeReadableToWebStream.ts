import type { Readable } from "node:stream"

function toUint8Array(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) return chunk

  if (ArrayBuffer.isView(chunk)) {
    return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
  }

  if (chunk instanceof ArrayBuffer) {
    return new Uint8Array(chunk)
  }

  if (typeof chunk === "string") {
    return new TextEncoder().encode(chunk)
  }

  throw new TypeError("Unsupported stream chunk type")
}

export function nodeReadableToWebStream(
  readable: Readable
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      let settled = false

      const cleanup = () => {
        readable.off("data", onData)
        readable.off("end", onEnd)
        readable.off("close", onClose)
        readable.off("error", onError)
      }

      const closeSafely = () => {
        if (settled) return
        settled = true
        cleanup()
        controller.close()
      }

      const errorSafely = (error: unknown) => {
        if (settled) return
        settled = true
        cleanup()
        controller.error(
          error instanceof Error ? error : new Error(String(error))
        )
      }

      const onData = (chunk: unknown) => {
        if (settled) return

        try {
          controller.enqueue(toUint8Array(chunk))
        } catch (error) {
          errorSafely(error)
          readable.destroy(
            error instanceof Error ? error : new Error(String(error))
          )
        }
      }

      const onEnd = () => closeSafely()
      const onClose = () => closeSafely()
      const onError = (error: unknown) => errorSafely(error)

      readable.on("data", onData)
      readable.once("end", onEnd)
      readable.once("close", onClose)
      readable.once("error", onError)
    },
    cancel(reason) {
      readable.destroy(reason instanceof Error ? reason : undefined)
    },
  })
}
