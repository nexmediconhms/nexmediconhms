'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { BRAND } from '@/lib/constants'
import {
  LayoutDashboard, Users, Stethoscope, BedDouble,
  BarChart2, LogOut, Activity, ChevronRight,
  Baby, Settings, Clock, IndianRupee, FlaskConical,
  BookOpen, CalendarDays, TrendingUp, BarChart3,
  Search as SearchIcon, FileText, Sparkles, ClipboardList
} from 'lucide-react'

const NAV_GROUPS = [
  {
    label: 'Clinical',
    items: [
      { href: '/dashboard',        icon: LayoutDashboard, label: 'Dashboard'          },
      { href: '/patients',         icon: Users,           label: 'Patients'           },
      { href: '/opd',              icon: Stethoscope,     label: 'OPD Consultation'   },
      { href: '/queue',            icon: Clock,           label: 'OPD Queue'          },
      { href: '/appointments',     icon: CalendarDays,    label: 'Appointments'       },
      { href: '/beds',             icon: BedDouble,       label: 'Bed Management'     },
      { href: '/anc',              icon: Baby,            label: 'ANC Registry'       },
      { href: '/labs',             icon: FlaskConical,    label: 'Lab Results'        },
      { href: '/forms',            icon: ClipboardList,   label: 'Paper Forms'        },
    ],
  },
  {
    label: 'Finance',
    items: [
      { href: '/billing',          icon: IndianRupee,     label: 'Billing & Payments' },
      { href: '/reports/daily',    icon: TrendingUp,      label: 'Daily Report'       },
      { href: '/reports/monthly',  icon: BarChart3,       label: 'Monthly Report'     },
    ],
  },
  {
    label: 'Tools',
    items: [
      { href: '/reports',          icon: BarChart2,       label: 'Reports'            },
      { href: '/search',           icon: SearchIcon,      label: 'Global Search'      },
    ],
  },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router   = useRouter()

  async function logout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  function NavLink({ href, icon: Icon, label }: { href: string; icon: any; label: string }) {
    const active = pathname === href || pathname.startsWith(href + '/')
    return (
      <Link href={href}
        className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all group
          ${active
            ? 'bg-blue-50 text-blue-700 border-r-2 border-blue-600'
            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}`}>
        <Icon className={`w-4 h-4 flex-shrink-0 ${active ? 'text-blue-600' : 'text-gray-400 group-hover:text-gray-600'}`}/>
        <span className="truncate">{label}</span>
        {active && <ChevronRight className="w-3 h-3 ml-auto text-blue-400 flex-shrink-0"/>}
      </Link>
    )
  }

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-60 bg-white border-r border-gray-200 flex flex-col z-50 overflow-hidden">

      {/* Brand */}
      <div className="px-4 py-4 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <Activity className="w-4 h-4 text-white"/>
          </div>
          <div className="min-w-0">
            <div className="font-bold text-gray-900 text-sm leading-tight truncate">{BRAND.shortName} HMS</div>
            <div className="text-xs text-gray-400">Hospital Management</div>
          </div>
        </div>
      </div>

      {/* Nav — scrollable */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {NAV_GROUPS.map(group => (
          <div key={group.label}>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest px-3 mb-1">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map(item => (
                <NavLink key={item.href} {...item}/>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-gray-100 flex-shrink-0 space-y-0.5">
        <NavLink href="/ai-setup" icon={Sparkles}  label="AI Status"/>
        <NavLink href="/setup"    icon={BookOpen}  label="Setup Guide"/>
        <NavLink href="/settings" icon={Settings}  label="Settings"/>
        <button onClick={logout}
          className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 transition-colors">
          <LogOut className="w-4 h-4"/>
          Sign Out
        </button>
      </div>
    </aside>
  )
}
