import type { Metadata } from 'next'
import { Space_Mono, Cormorant_Garamond } from 'next/font/google'
import { Providers } from './providers'
import './globals.css'

const mono = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-mono',
})

const display = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-display',
})

export const metadata: Metadata = {
  title: 'ens-intent-bus — Intent-Based Swaps',
  description: 'Trade by publishing your intent via ENS. An AI agent reads your name, verifies your identity, and executes the best swap via Uniswap.',
  icons: { icon: '/favicon.ico' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${mono.variable} ${display.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
