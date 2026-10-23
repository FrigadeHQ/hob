import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL('https://hob.chat'),
  title: 'Hob: your private AI, right on your computer',
  description: 'A free, open-source AI assistant that runs on your computer. Your chats and files never leave it.',
  icons: { icon: '/marketing/assets/hob-favicon.svg' },
  openGraph: { title: 'Hob', description: 'Your private AI, right on your computer.', images: ['/screenshot.png'] },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
