'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Users, Stethoscope,
  IndianRupee, Clock
} from 'lucide-react'

const MOBILE_NAV = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Home'     },
  { href: '/patients',  icon: Users,            label: 'Patients' },
  { href: '/opd',       icon: Stethoscope,      label: 'OPD'      },
  { href: '/queue',     icon: Clock,            label: 'Queue'    },
  { href: '/billing',   icon: IndianRupee,      label: 'Billing'  },
]

export default function MobileNav() {
  const pathname = usePathname()
  // Don't show on login page
  if (pathname === '/login' || pathname === '/') return null

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50 safe-area-bottom"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="flex items-stretch">
        {MOBILE_NAV.map(({ href, icon: Icon, label }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link key={href} href={href}
              className={`flex-1 flex flex-col items-center justify-center py-2 px-1 transition-colors min-h-[56px]
                ${active ? 'text-blue-600 bg-blue-50' : 'text-gray-500 hover:text-gray-700'}`}>
              <Icon className={`w-5 h-5 mb-0.5 ${active ? 'text-blue-600' : 'text-gray-400'}`}/>
              <span className="text-xs font-medium">{label}</span>
              {active && <div className="w-1 h-1 rounded-full bg-blue-600 mt-0.5"/>}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
