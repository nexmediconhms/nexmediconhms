'use client'
/**
 * src/components/layout/Sidebar.tsx
 *
 * UPDATED for v11 — adds nav items for:
 *   - IPD Management       (/ipd)
 *   - Video Consultations  (/video)
 *   - Hospital Fund        (/fund)
 *   - Patient Portal links (/settings/doctors for doctor management)
 *
 * Drop-in replacement for the existing Sidebar.tsx.
 * All original logic is preserved; only NAV_GROUPS is extended.
 */
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
  // ── v11 additions ──────────────────────────────────────
  BedSingle,        // IPD admissions
  Video,            // Video consultations
  PiggyBank,        // Hospital fund
  UserCog,          // Doctor management
  ExternalLink,     // Patient portal (external)
} from 'lucide-react'

interface NavItemDef {
  href:        string
  icon:        any
  label:       string
  permission?: Permission
  badge?:      number
  external?:   boolean   // opens in new tab (patient portal link)
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
    Clinical:   true,
    IPD:        true,
    Finance:    true,
    Tools:      true,
    Admin:      false,
  })

  // Live badge count — urgent + today reminders
  const [reminderBadge, setReminderBadge] = useState(0)

  useEffect(() => {
    async function fetchBadge() {
      try {
        const res = await fetch('/api/reminders')
        if (!res.ok) return
        const data = await res.json()
        const count = (data.reminders || []).filter(
          (r: any) => r.priority === 'urgent' || r.priority === 'today'
        ).length
        setReminderBadge(count)
      } catch {}
    }
    fetchBadge()
    const t = setInterval(fetchBadge, 5 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

  const NAV_GROUPS: NavGroupDef[] = [
    // ── CLINICAL ──────────────────────────────────────────
    {
      label: 'Clinical',
      emoji: '🏥',
      items: [
        { href: '/dashboard',    icon: LayoutDashboard, label: 'Dashboard'                                           },
        { href: '/patients',     icon: Users,           label: 'Patients',          permission: 'patients.view'      },
        { href: '/opd',          icon: Stethoscope,     label: 'OPD Consultation',  permission: 'encounters.view'    },
        { href: '/queue',        icon: Clock,           label: 'OPD Queue',         permission: 'queue.view'         },
        { href: '/appointments', icon: CalendarDays,    label: 'Appointments'                                        },
        { href: '/reminders',    icon: BellRing,        label: 'Reminders',         badge: reminderBadge             },
        { href: '/anc',          icon: Baby,            label: 'ANC Registry',      permission: 'anc.view'           },
        { href: '/labs',         icon: FlaskConical,    label: 'Lab Results',       permission: 'labs.view'          },
        { href: '/forms',        icon: ClipboardList,   label: 'Patient Intake',    permission: 'forms.view'         },
      ],
    },

    // ── IPD (IN-PATIENT DEPARTMENT) ────────────────────────   ← NEW v11
    {
      label: 'IPD',
      emoji: '🛏️',
      items: [
        { href: '/beds',  icon: BedDouble,  label: 'Bed Management',   permission: 'beds.view'     },
        { href: '/ipd',   icon: BedSingle,  label: 'IPD Admissions',   permission: 'ipd.view'      },
        { href: '/video', icon: Video,      label: 'Video Consult',    permission: 'video.view'    },
      ],
    },

    // ── FINANCE ───────────────────────────────────────────
    {
      label: 'Finance',
      emoji: '💰',
      items: [
        { href: '/billing',          icon: IndianRupee, label: 'Billing',          permission: 'billing.view'       },
        { href: '/fund',             icon: PiggyBank,   label: 'Hospital Fund',    permission: 'fund.view'          }, // ← NEW v11
        { href: '/reports/daily',    icon: TrendingUp,  label: 'Daily Report',     permission: 'reports.view'       },
        { href: '/reports/monthly',  icon: BarChart3,   label: 'Monthly Report',   permission: 'reports.view'       },
        { href: '/reports/payments', icon: IndianRupee, label: 'Payment Report',   permission: 'reports.financial'  },
      ],
    },

    // ── TOOLS ─────────────────────────────────────────────
    {
      label: 'Tools',
      emoji: '🔧',
      items: [
        { href: '/reports', icon: BarChart2,   label: 'Reports',       permission: 'reports.view' },
        { href: '/search',  icon: SearchIcon,  label: 'Global Search'                             },
      ],
    },

    // ── ADMIN ─────────────────────────────────────────────  ← NEW v11 (admin only)
    {
      label: 'Admin',
      emoji: '⚙️',
      items: [
        { href: '/settings/doctors', icon: UserCog,      label: 'Doctor Management', permission: 'settings.edit'    }, // ← NEW v11
        { href: '/audit-log',        icon: Shield,       label: 'Audit Log',         permission: 'audit.view'       },
      ],
    },
  ]

  const FOOTER_LINKS: NavItemDef[] = [
    { href: '/ai-setup',   icon: Sparkles,      label: 'AI Status'                               },
    { href: '/abdm-setup', icon: Shield,        label: 'ABDM / FHIR'                             },
    { href: '/setup',      icon: BookOpen,      label: 'Setup Guide'                             },
    { href: '/settings',   icon: Settings,      label: 'Settings',   permission: 'settings.view' },
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

  function NavLink({ href, icon: Icon, label, badge, external }: NavItemDef) {
    const active = isActive(href)
    const baseClass = `flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all
      ${active
        ? 'bg-blue-50 text-blue-700'
        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}`

    const inner = (
      <>
        <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${active ? 'text-blue-600' : 'text-gray-400'}`}/>
        <span className="truncate flex-1">{label}</span>
        {badge != null && badge > 0 && (
          <span
            className="flex-shrink-0 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white font-bold px-1"
            style={{ fontSize: '10px' }}>
            {badge > 99 ? '99+' : badge}
          </span>
        )}
        {active && (badge == null || badge === 0) && (
          <div className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-600 flex-shrink-0"/>
        )}
        {external && <ExternalLink className="w-3 h-3 text-gray-300 flex-shrink-0"/>}
      </>
    )

    if (external) {
      return (
        <a href={href} target="_blank" rel="noreferrer" className={baseClass}>
          {inner}
        </a>
      )
    }

    return (
      <Link href={href} className={baseClass}>
        {inner}
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
                  ? <ChevronDown className="w-3 h-3 text-gray-400"/>
                  : <ChevronRight className="w-3 h-3 text-gray-400"/>}
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

      {/* Footer */}
      <div className="border-t border-gray-100 px-2 py-2 flex-shrink-0 space-y-0.5">
        {FOOTER_LINKS.filter(l => !l.permission || can(l.permission)).map(item => (
          <NavLink key={item.href} {...item}/>
        ))}
        <button
          onClick={logout}
          className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:bg-red-50 transition-all">
          <LogOut className="w-3.5 h-3.5 flex-shrink-0"/>
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  )
}