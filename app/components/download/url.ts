export interface DownloadUrlInfo {
  isSpotify: boolean
  isYouTube: boolean
  isSoundCloud: boolean
  hasPlaylistParam: boolean
  detectedPlatform: "Spotify" | "YouTube" | "SoundCloud" | null
}

export function getDownloadUrlInfo(url: string): DownloadUrlInfo {
  const normalizedUrl = url.trim().toLowerCase()
  const isSpotify = normalizedUrl.includes("spotify.com")
  const isYouTube = normalizedUrl.includes("youtube.com") || normalizedUrl.includes("youtu.be")
  const isSoundCloud =
    normalizedUrl.includes("soundcloud.com") || normalizedUrl.includes("on.soundcloud.com")

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
        : null

  return { isSpotify, isYouTube, isSoundCloud, hasPlaylistParam, detectedPlatform }
}
