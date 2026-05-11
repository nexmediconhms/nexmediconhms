/**
 * src/app/portal/layout.tsx
 *
 * Portal Layout — No AppShell (sidebar/nav)
 * Patient portal pages are standalone, mobile-first PWA pages.
 * They don't use the clinic staff navigation.
 */

import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Patient Portal | NexMedicon',
  description: 'View your prescriptions, lab reports, bills, and book appointments',
  viewport: 'width=device-width, initial-scale=1, viewport-fit=cover',
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
