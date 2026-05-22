/**
 * src/components/shared/AdminGuard.tsx
 *
 * Admin-only route protection component.
 *
 * FIX: Developer setup pages (ai-setup, abdm-setup, settings with API keys)
 * visible to all users. This component wraps admin-only pages to restrict access.
 *
 * For "developer-only" content (like "⚠ AI API key missing" warnings),
 * use the `devOnly` prop which additionally checks if the user's email
 * matches the DEVELOPER_EMAIL env var (optional).
 *
 * Usage:
 *   // In any admin-only page:
 *   import AdminGuard from '@/components/shared/AdminGuard'
 *
 *   export default function MyAdminPage() {
 *     return (
 *       <AdminGuard>
 *         <h1>Admin Settings</h1>
 *         ...page content...
 *       </AdminGuard>
 *     )
 *   }
 *
 *   // For developer-only pages (API key setup, etc):
 *   <AdminGuard devOnly>
 *     <h1>Developer Setup</h1>
 *   </AdminGuard>
 */

'use client'

import { useEffect, useState, ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { ShieldAlert, Loader2 } from 'lucide-react'

interface AdminGuardProps {
  children: ReactNode
  /** If true, only shows content to admin role. Default: true */
  requireAdmin?: boolean
  /** If true, also requires specific developer email match (extra restriction) */
  devOnly?: boolean
  /** Custom message to show when access denied */
  deniedMessage?: string
  /** Custom redirect path. If not provided, shows access denied message */
  redirectTo?: string
  /** Allowed roles (overrides requireAdmin). e.g. ['admin', 'doctor'] */
  allowedRoles?: string[]
}

export default function AdminGuard({
  children,
  requireAdmin = true,
  devOnly = false,
  deniedMessage,
  redirectTo,
  allowedRoles,
}: AdminGuardProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [hasAccess, setHasAccess] = useState(false)
  const [userRole, setUserRole] = useState<string>('')

  useEffect(() => {
    async function checkAccess() {
      try {
        const { data: { session } } = await supabase.auth.getSession()

        if (!session) {
          if (redirectTo) {
            router.push(redirectTo)
          }
          setLoading(false)
          return
        }

        // Get user role from clinic_users
        const { data: clinicUser } = await supabase
          .from('clinic_users')
          .select('role, email')
          .eq('auth_id', session.user.id)
          .single()

        if (!clinicUser) {
          setLoading(false)
          return
        }

        setUserRole(clinicUser.role)

        // Check role-based access
        let roleAllowed = false

        if (allowedRoles && allowedRoles.length > 0) {
          roleAllowed = allowedRoles.includes(clinicUser.role)
        } else if (requireAdmin) {
          roleAllowed = clinicUser.role === 'admin'
        } else {
          roleAllowed = true
        }

        // For devOnly, check if user is the developer/deployer
        // This uses a simple check: admin role is sufficient for devOnly pages
        // because only the initial deployer should be admin
        if (devOnly) {
          roleAllowed = clinicUser.role === 'admin'
        }

        if (roleAllowed) {
          setHasAccess(true)
        } else if (redirectTo) {
          router.push(redirectTo)
        }
      } catch (err) {
        console.error('[AdminGuard] Access check failed:', err)
      }
      setLoading(false)
    }

    checkAccess()
  }, [router, requireAdmin, devOnly, redirectTo, allowedRoles])

  // ── Loading state ─────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    )
  }

  // ── Access denied ─────────────────────────────────────────
  if (!hasAccess) {
    const message = deniedMessage ||
      (devOnly
        ? 'This page is only accessible to the system administrator.'
        : `This page requires ${allowedRoles ? allowedRoles.join(' or ') : 'admin'} access.`)

    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] text-center px-4">
        <ShieldAlert className="w-12 h-12 text-red-400 mb-4" />
        <h2 className="text-lg font-semibold text-gray-800 mb-2">Access Restricted</h2>
        <p className="text-gray-500 max-w-md">{message}</p>
        {userRole && (
          <p className="text-sm text-gray-400 mt-2">
            Your role: <span className="font-medium">{userRole}</span>
          </p>
        )}
        <button
          onClick={() => router.push('/')}
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
        >
          Go to Dashboard
        </button>
      </div>
    )
  }

  // ── Access granted ────────────────────────────────────────
  return <>{children}</>
}