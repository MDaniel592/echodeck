import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "EchoDeck",
  description: "Download and play music from YouTube and Spotify",
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/EchoDeck.png",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark overflow-hidden h-full">
      <body
        className="antialiased bg-black text-white h-full overflow-hidden font-sans"
      >
        {children}
      </body>
    </html>
  )
}
