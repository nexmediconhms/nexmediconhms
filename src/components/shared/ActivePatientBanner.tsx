'use client'
/**
 * src/components/shared/ActivePatientBanner.tsx
 *
 * Shows a small banner at the top of AppShell indicating the currently
 * active patient. Allows one-click navigation to any module for that patient
 * without re-searching. Staff can dismiss when done.
 */

import { usePatientContext } from '@/lib/patient-context'
import Link from 'next/link'
import {
  X, User, Stethoscope, FlaskConical, Receipt,
  Calendar, FileText, BedDouble
} from 'lucide-react'

export default function ActivePatientBanner() {
  const { activePatient, clearPatient, isPatientActive } = usePatientContext()

  if (!isPatientActive || !activePatient) return null

  const params = new URLSearchParams({
    patientId: activePatient.id,
    patientName: activePatient.full_name,
    mrn: activePatient.mrn,
  }).toString()

  const quickLinks = [
    { href: `/opd/new?patient=${activePatient.id}`, label: 'OPD', icon: Stethoscope },
    { href: `/labs?patient=${activePatient.id}&patientName=${encodeURIComponent(activePatient.full_name)}`, label: 'Lab', icon: FlaskConical },
    { href: `/billing?${params}`, label: 'Bill', icon: Receipt },
    { href: `/appointments?${params}`, label: 'Appt', icon: Calendar },
    { href: `/queue?patient=${activePatient.id}&patientName=${encodeURIComponent(activePatient.full_name)}&mrn=${encodeURIComponent(activePatient.mrn)}`, label: 'Queue', icon: FileText },
  ]

  return (
    <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-4 py-2 flex items-center gap-3 shadow-sm">
      {/* Patient info */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
          <User className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm truncate">{activePatient.full_name}</span>
            <span className="text-xs bg-white/20 px-1.5 py-0.5 rounded font-mono">
              {activePatient.mrn}
            </span>
            {activePatient.age && (
              <span className="text-xs opacity-80">
                {activePatient.age}y {activePatient.gender ? `· ${activePatient.gender}` : ''}
              </span>
            )}
            {activePatient.mobile && (
              <span className="text-xs opacity-70 hidden sm:inline">· {activePatient.mobile}</span>
            )}
          </div>
        </div>
      </div>

      {/* Quick links */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {quickLinks.map(link => (
          <Link
            key={link.label}
            href={link.href}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium
                       bg-white/10 hover:bg-white/20 transition-colors whitespace-nowrap"
            title={`Go to ${link.label} for ${activePatient.full_name}`}
          >
            <link.icon className="w-3 h-3" />
            <span className="hidden md:inline">{link.label}</span>
          </Link>
        ))}
      </div>

      {/* Dismiss */}
      <button
        onClick={clearPatient}
        className="p-1.5 rounded-lg hover:bg-white/20 transition-colors flex-shrink-0"
        title="Clear active patient"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
