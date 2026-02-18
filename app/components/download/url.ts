export interface DownloadUrlInfo {
  isSpotify: boolean
  isYouTube: boolean
  isSoundCloud: boolean
  isTidal: boolean
  isAmazonMusic: boolean
  hasPlaylistParam: boolean
  detectedPlatform: "Spotify" | "YouTube" | "SoundCloud" | "Tidal" | "Amazon Music" | null
}

export function getDownloadUrlInfo(url: string): DownloadUrlInfo {
  const normalizedUrl = url.trim().toLowerCase()
  const isSpotify = normalizedUrl.includes("spotify.com")
  const isYouTube = normalizedUrl.includes("youtube.com") || normalizedUrl.includes("youtu.be")
  const isSoundCloud =
    normalizedUrl.includes("soundcloud.com") || normalizedUrl.includes("on.soundcloud.com")
  const isTidal = normalizedUrl.includes("tidal.com")
  const isAmazonMusic = normalizedUrl.includes("music.amazon.com")

  let hasPlaylistParam = false
  if (isYouTube) {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        hasPlaylistParam = parsed.searchParams.has("list")
      }
    } catch {
      hasPlaylistParam = false
    }
  }

  const detectedPlatform = isSpotify
    ? "Spotify"
    : isYouTube
      ? "YouTube"
      : isSoundCloud
        ? "SoundCloud"
        : isTidal
          ? "Tidal"
          : isAmazonMusic
            ? "Amazon Music"
        : null

  return { isSpotify, isYouTube, isSoundCloud, isTidal, isAmazonMusic, hasPlaylistParam, detectedPlatform }
}
