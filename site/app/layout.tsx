import type { Metadata } from 'next'
import { Hanken_Grotesk } from 'next/font/google'
import './globals.css'

const hanken = Hanken_Grotesk({ subsets: ['latin'], weight: ['400', '500', '600'] })

export const metadata: Metadata = {
  metadataBase: new URL('https://hob.chat'),
  title: 'Hob: your private AI, right on your computer',
  description: 'A free, open-source AI assistant that runs on your computer. Your chats and files never leave it.',
  icons: { icon: '/favicon.png' },
  openGraph: { title: 'Hob', description: 'Your private AI, right on your computer.', images: ['/screenshot.png'] },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={hanken.className}>{children}</body>
    </html>
  )
}
