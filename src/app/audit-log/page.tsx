'use client'
/**
 * src/app/audit-log/page.tsx
 * E. Audit Log — Admin-only viewer
 *
 * Shows who did what, when. Searchable, filterable by action/entity.
 * Only visible to admin role (enforced in sidebar + this page).
 */
import { useEffect, useState } from 'react'
import AppShell                from '@/components/layout/AppShell'
import { supabase }            from '@/lib/supabase'
import { formatDateTime }      from '@/lib/utils'
import {
  Shield, Search, X, ChevronDown, ChevronUp,
  AlertTriangle, Loader2, Filter,
} from 'lucide-react'

interface AuditEntry {
  id:           string
  user_email:   string | null
  user_role:    string | null
  action:       string
  entity_type:  string
  entity_id:    string | null
  entity_label: string | null
  changes:      any
  ip_address:   string | null
  created_at:   string
}

const ACTION_COLORS: Record<string, string> = {
  create:  'bg-green-100 text-green-800',
  update:  'bg-blue-100 text-blue-800',
  delete:  'bg-red-100 text-red-800',
  view:    'bg-gray-100 text-gray-600',
  print:   'bg-purple-100 text-purple-800',
  login:   'bg-teal-100 text-teal-800',
  logout:  'bg-gray-100 text-gray-500',
  export:  'bg-orange-100 text-orange-800',
  scan:    'bg-indigo-100 text-indigo-800',
}

const ACTIONS    = ['create','update','delete','view','print','login','logout','export','scan']
const ENTITIES   = ['patient','encounter','bill','lab_report','prescription','attachment','user','settings','discharge']
const PAGE_SIZE  = 50

export default function AuditLogPage() {
  const [entries,     setEntries]     = useState<AuditEntry[]>([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState('')
  const [search,      setSearch]      = useState('')
  const [filterAction,setFilterAction]= useState('')
  const [filterEntity,setFilterEntity]= useState('')
  const [expandedId,  setExpandedId]  = useState<string | null>(null)
  const [page,        setPage]        = useState(0)
  const [hasMore,     setHasMore]     = useState(false)
  const [isAdmin,     setIsAdmin]     = useState<boolean | null>(null)

  // Check admin role
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { setIsAdmin(false); return }
      const { data } = await supabase
        .from('clinic_users').select('role').eq('auth_id', user.id).single()
      setIsAdmin(data?.role === 'admin')
    })
  }, [])

  useEffect(() => {
    if (isAdmin === true) load(0)
  }, [isAdmin, filterAction, filterEntity])

  async function load(p: number) {
    setLoading(true); setError('')
    try {
      let q = supabase
        .from('audit_log')
        .select('*')
        .order('created_at', { ascending: false })
        .range(p * PAGE_SIZE, (p + 1) * PAGE_SIZE - 1)

      if (filterAction) q = q.eq('action', filterAction)
      if (filterEntity) q = q.eq('entity_type', filterEntity)

      const { data, error: e } = await q
      if (e) {
        if (e.message.includes('permission') || e.message.includes('policy')) {
          setIsAdmin(false)
          setError('Access denied. Audit log is visible to admins only.')
        } else throw e
        return
      }

      if (p === 0) setEntries(data ?? [])
      else setEntries(prev => [...prev, ...(data ?? [])])

      setHasMore((data?.length ?? 0) === PAGE_SIZE)
      setPage(p)
    } catch (e: any) {
      setError(`Failed to load: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  const filtered = entries.filter(e => {
    if (!search) return true
    const s = search.toLowerCase()
    return (
      e.user_email?.toLowerCase().includes(s)     ||
      e.entity_label?.toLowerCase().includes(s)   ||
      e.entity_type?.toLowerCase().includes(s)    ||
      e.action?.toLowerCase().includes(s)         ||
      e.entity_id?.toLowerCase().includes(s)
    )
  })

  if (isAdmin === null) {
    return <AppShell><div className="flex items-center justify-center py-20 text-gray-400"><Loader2 className="w-6 h-6 animate-spin mr-2"/> Checking permissions…</div></AppShell>
  }

  if (isAdmin === false) {
    return (
      <AppShell>
        <div className="max-w-xl mx-auto px-4 py-16 text-center">
          <Shield className="w-12 h-12 mx-auto text-red-400 mb-4"/>
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Admin Only</h2>
          <p className="text-gray-500 text-sm">The audit log is only accessible to admin accounts. Contact your system administrator.</p>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Shield className="w-5 h-5 text-gray-600"/> Audit Log
          </h1>
          <p className="text-sm text-gray-500">Every create, edit, delete, print and login — who did what, when.</p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-4">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by user, patient, entity…" className="input pl-9 text-sm"/>
          </div>
          <select className="input text-sm w-36" value={filterAction} onChange={e => { setFilterAction(e.target.value); setPage(0) }}>
            <option value="">All actions</option>
            {ACTIONS.map(a => <option key={a} value={a}>{a.charAt(0).toUpperCase() + a.slice(1)}</option>)}
          </select>
          <select className="input text-sm w-40" value={filterEntity} onChange={e => { setFilterEntity(e.target.value); setPage(0) }}>
            <option value="">All entities</option>
            {ENTITIES.map(e => <option key={e} value={e}>{e.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>)}
          </select>
          {(filterAction || filterEntity) && (
            <button onClick={() => { setFilterAction(''); setFilterEntity(''); setPage(0) }}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-red-600">
              <X className="w-4 h-4"/> Clear
            </button>
          )}
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0"/>
            {error}
          </div>
        )}

        {/* Summary bar */}
        {!loading && (
          <div className="text-xs text-gray-400 mb-3">
            Showing {filtered.length} of {entries.length} entries
            {(filterAction || filterEntity) && ' (filtered)'}
          </div>
        )}

        {/* Table */}
        {loading && page === 0 ? (
          <div className="flex items-center justify-center py-12 text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin mr-2"/> Loading audit log…
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400 border-2 border-dashed border-gray-100 rounded-xl">
            <Shield className="w-10 h-10 mx-auto mb-3 opacity-30"/>
            <p className="font-medium">No entries found</p>
            <p className="text-sm mt-1">Audit entries are created as the system is used</p>
          </div>
        ) : (
          <div className="space-y-1">
            {filtered.map(entry => (
              <div key={entry.id} className="border border-gray-100 rounded-xl hover:border-gray-200 transition-colors bg-white">
                {/* Main row */}
                <div className="flex items-center gap-3 px-4 py-3">
                  {/* Action badge */}
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${ACTION_COLORS[entry.action] ?? 'bg-gray-100 text-gray-600'}`}>
                    {entry.action}
                  </span>

                  {/* What */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-900 truncate">
                      <span className="font-medium capitalize">{entry.entity_type?.replace('_', ' ')}</span>
                      {entry.entity_label && <span className="text-gray-600"> — {entry.entity_label}</span>}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {entry.user_email ?? 'Unknown user'}
                      {entry.user_role && <span className="ml-1 text-gray-300">({entry.user_role})</span>}
                      <span className="mx-1">·</span>
                      {formatDateTime(entry.created_at)}
                    </div>
                  </div>

                  {/* Expand button (if has changes) */}
                  {entry.changes && (
                    <button
                      onClick={() => setExpandedId(v => v === entry.id ? null : entry.id)}
                      className="p-1.5 text-gray-400 hover:text-gray-600 flex-shrink-0"
                    >
                      {expandedId === entry.id ? <ChevronUp className="w-4 h-4"/> : <ChevronDown className="w-4 h-4"/>}
                    </button>
                  )}
                </div>

                {/* Expanded changes */}
                {expandedId === entry.id && entry.changes && (
                  <div className="border-t border-gray-100 px-4 py-3 bg-gray-50 rounded-b-xl">
                    <p className="text-xs font-semibold text-gray-500 mb-2">Changes</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {entry.changes.before && (
                        <div>
                          <p className="text-xs text-red-600 font-medium mb-1">Before</p>
                          <pre className="text-xs bg-white border border-gray-200 rounded-lg p-2 overflow-x-auto text-gray-700 max-h-40">
                            {JSON.stringify(entry.changes.before, null, 2)}
                          </pre>
                        </div>
                      )}
                      {entry.changes.after && (
                        <div>
                          <p className="text-xs text-green-600 font-medium mb-1">After</p>
                          <pre className="text-xs bg-white border border-gray-200 rounded-lg p-2 overflow-x-auto text-gray-700 max-h-40">
                            {JSON.stringify(entry.changes.after, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                    {entry.entity_id && (
                      <p className="text-xs text-gray-400 mt-2">Entity ID: {entry.entity_id}</p>
                    )}
                  </div>
                )}
              </div>
            ))}

            {hasMore && (
              <button
                onClick={() => load(page + 1)}
                disabled={loading}
                className="w-full py-3 text-sm text-indigo-600 hover:text-indigo-700 font-medium border border-dashed border-indigo-200 rounded-xl hover:border-indigo-300 transition-colors disabled:opacity-50"
              >
                {loading ? 'Loading…' : 'Load more entries'}
              </button>
            )}
          </div>
        )}
      </div>
    </AppShell>
  )
}