'use client'
/**
 * src/components/layout/NotificationPanel.tsx
 *
 * Global Notification Panel — accessible from anywhere in the application.
 *
 * Shows real-time notifications for:
 *  - Lab reports uploaded by lab partners
 *  - Patient discharge events
 *  - Insurance claim status changes
 *  - Appointment confirmations/cancellations
 *  - Billing alerts (pending bills, payments received)
 *  - System alerts (abnormal lab values, overdue follow-ups)
 *
 * Integrated into AppShell header — visible as a bell icon with badge count.
 * Uses polling (every 30s) + Supabase Realtime for instant updates.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import {
  Bell, X, Check, CheckCheck, FlaskConical, BedDouble,
  IndianRupee, Calendar, AlertTriangle, FileText,
  Shield, Clock, ChevronRight, Loader2, RefreshCw,
} from 'lucide-react'

interface Notification {
  id: string
  title: string
  message: string
  type: string
  severity: string
  source: string | null
  entity_type: string | null
  entity_id: string | null
  patient_id: string | null
  patient_name: string | null
  mrn: string | null
  is_read: boolean
  created_at: string
  metadata: any
}

const TYPE_CONFIG: Record<string, { icon: any; color: string; bg: string }> = {
  lab_report:   { icon: FlaskConical,  color: 'text-purple-600', bg: 'bg-purple-50' },
  discharge:    { icon: BedDouble,     color: 'text-red-600',    bg: 'bg-red-50' },
  billing:      { icon: IndianRupee,   color: 'text-green-600',  bg: 'bg-green-50' },
  appointment:  { icon: Calendar,      color: 'text-blue-600',   bg: 'bg-blue-50' },
  insurance:    { icon: Shield,        color: 'text-indigo-600', bg: 'bg-indigo-50' },
  system:       { icon: AlertTriangle, color: 'text-amber-600',  bg: 'bg-amber-50' },
  info:         { icon: FileText,      color: 'text-gray-600',   bg: 'bg-gray-50' },
}

function getTimeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diffSec = Math.floor((now - then) / 1000)

  if (diffSec < 60) return 'Just now'
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
  if (diffSec < 172800) return 'Yesterday'
  return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

export default function NotificationPanel() {
  const { user } = useAuth()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function getToken(): Promise<string | null> {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      return session?.access_token || null
    } catch {
      return null
    }
  }

  const fetchNotifications = useCallback(async () => {
    if (!user) return
    try {
      const token = await getToken()
      if (!token) return
      const res = await fetch(`/api/notifications?role=${user.role}&limit=30`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setNotifications(data.notifications || [])
        setUnreadCount(data.unread_count || 0)
      }
    } catch {
      // Silent fail — non-critical
    }
  }, [user])

  // Initial load + polling every 30 seconds
  useEffect(() => {
    fetchNotifications()
    pollRef.current = setInterval(fetchNotifications, 30000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [fetchNotifications])

  // Supabase Realtime subscription for instant updates
  useEffect(() => {
    if (!user) return

    const channel = supabase
      .channel('clinic_notifications_realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'clinic_notifications' },
        () => {
          // Refetch on new notification
          fetchNotifications()
        }
      )
      .subscribe()

    return () => {
      channel.unsubscribe()
    }
  }, [user, fetchNotifications])

  // Close panel on outside click
  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleOutsideClick)
      return () => document.removeEventListener('mousedown', handleOutsideClick)
    }
  }, [open])

  // Mark single as read
  async function markRead(id: string) {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
    setUnreadCount(prev => Math.max(0, prev - 1))
    const _tk = await getToken()
    if (_tk) await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${_tk}` },
      body: JSON.stringify({ ids: [id], read_by: user?.full_name || user?.role }),
    })
  }

  // Mark all as read
  async function markAllRead() {
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
    setUnreadCount(0)
    const _tk2 = await getToken()
    if (_tk2) await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${_tk2}` },
      body: JSON.stringify({ mark_all: true, role: user?.role, read_by: user?.full_name }),
    })
  }

  // Navigate to relevant page based on notification type
  function handleNotificationClick(notif: Notification) {
    if (!notif.is_read) markRead(notif.id)

    // Navigate based on entity
    if (notif.patient_id) {
      router.push(`/patients/${notif.patient_id}`)
    } else if (notif.type === 'lab_report') {
      router.push('/labs')
    } else if (notif.type === 'billing') {
      router.push('/billing')
    } else if (notif.type === 'insurance') {
      router.push('/insurance')
    } else if (notif.type === 'appointment') {
      router.push('/appointments')
    } else if (notif.type === 'discharge') {
      router.push('/ipd')
    }

    setOpen(false)
  }

  if (!user) return null

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell Icon Button */}
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 rounded-xl text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center
            bg-red-500 text-white text-[10px] font-bold rounded-full px-1 animate-pulse">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Notification Dropdown Panel */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-[380px] max-h-[520px] bg-white rounded-2xl shadow-2xl
          border border-gray-200 z-50 flex flex-col overflow-hidden animate-in fade-in slide-in-from-top-2">

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50/80 flex-shrink-0">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-gray-600" />
              <h3 className="text-sm font-bold text-gray-800">Notifications</h3>
              {unreadCount > 0 && (
                <span className="text-[10px] font-bold bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">
                  {unreadCount} new
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium px-2 py-1 rounded-lg hover:bg-blue-50 flex items-center gap-1"
                >
                  <CheckCheck className="w-3 h-3" /> Read all
                </button>
              )}
              <button
                onClick={() => fetchNotifications()}
                className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Notification List */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                <Bell className="w-8 h-8 mb-2 opacity-30" />
                <p className="text-sm font-medium">No notifications yet</p>
                <p className="text-xs mt-1">Activity will appear here</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {notifications.map(notif => {
                  const config = TYPE_CONFIG[notif.type] || TYPE_CONFIG.info
                  const Icon = config.icon
                  return (
                    <div
                      key={notif.id}
                      onClick={() => handleNotificationClick(notif)}
                      className={`flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors
                        ${notif.is_read ? 'bg-white hover:bg-gray-50' : 'bg-blue-50/40 hover:bg-blue-50/70'}`}
                    >
                      {/* Icon */}
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${config.bg}`}>
                        <Icon className={`w-4 h-4 ${config.color}`} />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className={`text-sm leading-tight ${notif.is_read ? 'text-gray-700' : 'text-gray-900 font-semibold'}`}>
                            {notif.title}
                          </p>
                          {!notif.is_read && (
                            <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 mt-1.5" />
                          )}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{notif.message}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] text-gray-400 flex items-center gap-1">
                            <Clock className="w-2.5 h-2.5" />
                            {getTimeAgo(notif.created_at)}
                          </span>
                          {notif.patient_name && (
                            <span className="text-[10px] text-gray-400">
                              · {notif.patient_name}{notif.mrn ? ` (${notif.mrn})` : ''}
                            </span>
                          )}
                        </div>
                      </div>

                      <ChevronRight className="w-3.5 h-3.5 text-gray-300 flex-shrink-0 mt-1" />
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="border-t border-gray-100 px-4 py-2.5 bg-gray-50/50 flex-shrink-0">
              <button
                onClick={() => { router.push('/notifications'); setOpen(false) }}
                className="w-full text-center text-xs font-semibold text-blue-600 hover:text-blue-800 py-1"
              >
                View All Notifications →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}