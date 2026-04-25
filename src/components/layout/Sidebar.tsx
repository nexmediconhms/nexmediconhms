'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { BRAND } from '@/lib/constants'
import { useAuth } from '@/lib/auth'
import type { Permission } from '@/lib/auth'
import {
  LayoutDashboard, Users, Stethoscope, BedDouble,
  BarChart2, LogOut, Activity, ChevronDown, ChevronRight,
  Baby, Settings, Clock, IndianRupee, FlaskConical,
  BookOpen, CalendarDays, TrendingUp, BarChart3,
  Search as SearchIcon, Sparkles, ClipboardList, Shield,
  BellRing,
} from 'lucide-react'

interface NavItemDef {
  href:       string
  icon:       any
  label:      string
  permission?: Permission
  badge?:     number   // live badge count
}

interface NavGroupDef {
  label: string
  emoji: string
  items: NavItemDef[]
}

export default function Sidebar() {
  const pathname = usePathname()
  const router   = useRouter()
  const { user, can } = useAuth()

  const [open, setOpen] = useState<Record<string, boolean>>({
    Clinical: true,
    Finance:  true,
    Tools:    true,
  })

  // Live urgent reminder count — fetched once on mount, refreshed every 5 minutes
  const [urgentCount, setUrgentCount] = useState(0)

  useEffect(() => {
    async function fetchUrgentCount() {
      try {
        const res  = await fetch('/api/reminders')
        if (!res.ok) return
        const data = await res.json()
        const urgent = (data.reminders || []).filter(
          (r: any) => r.priority === 'urgent' || r.priority === 'today'
        ).length
        setUrgentCount(urgent)
      } catch {}
    }
    fetchUrgentCount()
    const interval = setInterval(fetchUrgentCount, 5 * 60 * 1000) // refresh every 5 min
    return () => clearInterval(interval)
  }, [])

  const NAV_GROUPS: NavGroupDef[] = [
    {
      label: 'Clinical',
      emoji: '🏥',
      items: [
        { href: '/dashboard',    icon: LayoutDashboard, label: 'Dashboard'        },
        { href: '/patients',     icon: Users,           label: 'Patients',         permission: 'patients.view'      },
        { href: '/opd',          icon: Stethoscope,     label: 'OPD Consultation', permission: 'encounters.view'    },
        { href: '/queue',        icon: Clock,           label: 'OPD Queue',        permission: 'queue.view'         },
        { href: '/appointments', icon: CalendarDays,    label: 'Appointments'      },
        { href: '/reminders',    icon: BellRing,        label: 'Reminders',        badge: urgentCount               },
        { href: '/beds',         icon: BedDouble,       label: 'Bed Management',   permission: 'beds.view'          },
        { href: '/anc',          icon: Baby,            label: 'ANC Registry',     permission: 'anc.view'           },
        { href: '/labs',         icon: FlaskConical,    label: 'Lab Results',      permission: 'labs.view'          },
        { href: '/forms',        icon: ClipboardList,   label: 'Patient Intake',   permission: 'forms.view'         },
      ],
    },
    {
      label: 'Finance',
      emoji: '💰',
      items: [
        { href: '/billing',          icon: IndianRupee, label: 'Billing',          permission: 'billing.view'       },
        { href: '/reports/daily',    icon: TrendingUp,  label: 'Daily Report',     permission: 'reports.view'       },
        { href: '/reports/monthly',  icon: BarChart3,   label: 'Monthly Report',   permission: 'reports.view'       },
        { href: '/reports/payments', icon: IndianRupee, label: 'Payment Report',   permission: 'reports.financial'  },
      ],
    },
    {
      label: 'Tools',
      emoji: '🔧',
      items: [
        { href: '/reports', icon: BarChart2,   label: 'Reports',       permission: 'reports.view' },
        { href: '/search',  icon: SearchIcon,  label: 'Global Search'  },
      ],
    },
  ]

  const FOOTER_LINKS: NavItemDef[] = [
    { href: '/ai-setup',   icon: Sparkles, label: 'AI Status'    },
    { href: '/abdm-setup', icon: Shield,   label: 'ABDM / FHIR' },
    { href: '/setup',      icon: BookOpen, label: 'Setup Guide'  },
    { href: '/settings',   icon: Settings, label: 'Settings',    permission: 'settings.view' },
  ]

  function toggle(label: string) {
    setOpen(prev => ({ ...prev, [label]: !prev[label] }))
  }

  async function logout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  function isActive(href: string) {
    return pathname === href || (href !== '/dashboard' && pathname.startsWith(href + '/'))
  }

  function filterItems(items: NavItemDef[]): NavItemDef[] {
    return items.filter(item => {
      if (!item.permission) return true
      return can(item.permission)
    })
  }

  function NavLink({ href, icon: Icon, label, badge }: NavItemDef) {
    const active = isActive(href)
    return (
      <Link href={href}
        className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all
          ${active
            ? 'bg-blue-50 text-blue-700'
            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}`}>
        <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${active ? 'text-blue-600' : 'text-gray-400'}`}/>
        <span className="truncate flex-1">{label}</span>
        {/* Live badge — shows urgent+today count */}
        {badge != null && badge > 0 && (
          <span className="flex-shrink-0 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1 animate-pulse">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
        {active && (!badge || badge === 0) && (
          <div className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-600 flex-shrink-0"/>
        )}
      </Link>
    )
  }

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-56 bg-white border-r border-gray-200 flex flex-col z-50">

      {/* Brand */}
      <div className="px-4 py-3 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <Activity className="w-3.5 h-3.5 text-white"/>
          </div>
          <div className="min-w-0">
            <div className="font-bold text-gray-900 text-xs leading-tight truncate">{BRAND.shortName} HMS</div>
            <div className="text-xs text-gray-400" style={{ fontSize: '9px' }}>
              {user
                ? `${user.role === 'admin' ? '👑' : user.role === 'doctor' ? '🩺' : '📋'} ${user.full_name}`
                : 'Hospital Management'}
            </div>
          </div>
        </div>
      </div>

      {/* Nav — scrollable */}
      <nav className="flex-1 overflow-y-auto px-2 py-2">
        {NAV_GROUPS.map(group => {
          const filteredItems = filterItems(group.items)
          if (filteredItems.length === 0) return null

          const isOpen    = open[group.label] ?? true
          const hasActive = filteredItems.some(i => isActive(i.href))

          return (
            <div key={group.label} className="mb-1">
              <button
                onClick={() => toggle(group.label)}
                className="w-full flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-gray-50 transition-colors mb-0.5">
                <span className="text-sm">{group.emoji}</span>
                <span className="text-xs font-bold text-gray-500 uppercase tracking-widest flex-1 text-left">
                  {group.label}
                </span>
                {hasActive && !isOpen && (
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-600 mr-1"/>
                )}
                {isOpen
                  ? <ChevronDown className="w-3 h-3 text-gray-400 flex-shrink-0"/>
                  : <ChevronRight className="w-3 h-3 text-gray-400 flex-shrink-0"/>}
              </button>

              {isOpen && (
                <div className="space-y-0.5 ml-1">
                  {filteredItems.map(item => (
                    <NavLink key={item.href} {...item}/>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {/* Footer — always visible */}
      <div className="px-2 py-2 border-t border-gray-100 flex-shrink-0">
        <div className="space-y-0.5">
          {filterItems(FOOTER_LINKS).map(item => (
            <NavLink key={item.href} {...item}/>
          ))}
          <button onClick={logout}
            className="flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-600 hover:bg-red-50 transition-colors">
            <LogOut className="w-3.5 h-3.5"/>
            Sign Out
          </button>
        </div>
      </div>
    </aside>
  )
}