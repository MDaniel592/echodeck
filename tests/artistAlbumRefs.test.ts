import { beforeEach, describe, expect, it, vi } from "vitest"

const prismaMock = vi.hoisted(() => ({
  artist: {
    upsert: vi.fn(),
  },
  album: {
    upsert: vi.fn(),
  },
}))

vi.mock("../lib/prisma", () => ({
  default: prismaMock,
}))

describe("ensureArtistAlbumRefs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.album.upsert.mockResolvedValue({ id: 45 })
  })

  it("normalizes nullable albumArtist to empty string for album upsert identity", async () => {
    const { ensureArtistAlbumRefs } = await import("../lib/artistAlbumRefs")

    const result = await ensureArtistAlbumRefs({
      userId: 7,
      album: "Unknown Album",
      albumArtist: null,
    })

    expect(prismaMock.album.upsert).toHaveBeenCalledWith({
      where: {
        userId_title_albumArtist: {
          userId: 7,
          title: "Unknown Album",
          albumArtist: "",
        },
      },
      update: {
        artistId: null,
        year: null,
      },
      create: {
        userId: 7,
        title: "Unknown Album",
        albumArtist: "",
        artistId: null,
        year: null,
      },
      select: { id: true },
    })

    expect(result.albumId).toBe(45)
    expect(result.albumArtist).toBeNull()
  })
})
