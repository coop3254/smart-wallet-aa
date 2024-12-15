'use client'

import { WagmiProvider } from 'wagmi'
import { config } from '@/lib/wagmi-config'
import './globals.css'

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <WagmiProvider config={config}>
          {children}
        </WagmiProvider>
      </body>
    </html>
  )
}