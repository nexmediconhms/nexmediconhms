import type { Metadata, Viewport } from 'next'
import './globals.css'

export const viewport: Viewport = {
  themeColor: '#2563eb',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export const metadata: Metadata = {
  title: 'NexMedicon HMS',
  description: 'NexMedicon — Gynecology & Multi-specialty Hospital Management',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'NexMedicon HMS',
  },
  formatDetection: { telephone: false },
  openGraph: {
    type: 'website',
    title: 'NexMedicon HMS',
    description: 'Hospital Management System',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.json"/>
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png"/>
        <meta name="apple-mobile-web-app-capable" content="yes"/>
        <meta name="apple-mobile-web-app-status-bar-style" content="default"/>
        <meta name="apple-mobile-web-app-title" content="NexMedicon"/>
        <meta name="mobile-web-app-capable" content="yes"/>
        <meta name="theme-color" content="#2563eb"/>
      </head>
      <body>{children}</body>
    </html>
  )
}
