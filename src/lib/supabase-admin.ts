/**
 * src/lib/supabase-admin.ts
 *
 * Lazy, memoized Supabase clients.  Replaces the anti-pattern of
 * instantiating createClient(...) at module top-level inside API
 * route files, which caused `next build` to fail with
 *     "Error: supabaseKey is required."
 * during the static page-data-collection phase whenever the env
 * was incomplete (e.g. SUPABASE_SERVICE_ROLE_KEY missing).
 *
 * Two helpers are exposed:
 *
 *   getSupabaseAdmin()  → service_role client.  REQUIRED for cron
 *                         jobs, webhooks, audit writes, RLS bypass.
 *                         Throws a clear error at *call time* (not
 *                         at module load) if the service-role key
 *                         is not configured.
 *
 *   getSupabaseAnon()   → anon-key client.  RLS is enforced.
 *                         Throws at call time if anon key is missing.
 *
 * Plus three Proxy exports for back-compat with the legacy pattern:
 *
 *   import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
 *
 *   await supabase.from('patients').select(...)
 *
 * The proxy forwards every property access to the real client,
 * constructing the client on first use only.  This is the
 * MINIMAL-DIFF migration path: each broken route file changes
 * exactly two lines (the import + removing the top-level
 * createClient block), and every existing `supabase.from(...)`
 * / `supabase.storage.*` / `supabase.auth.*` call site keeps working
 * unchanged.
 *
 * IMPORTANT:
 * - Routes that use the admin client should also `export const
 *   dynamic = 'force-dynamic'` so Next.js never tries to statically
 *   pre-render them.
 * - Never expose the admin client (or its proxy) to the browser.
 *   Anything imported here is server-only by virtue of being used
 *   from `src/app/api/*` route handlers.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { requireEnv, getEnvOrFallback } from '@/lib/env'

// ─── Lazy admin (service-role) singleton ────────────────────────────
let _admin: SupabaseClient | null = null

/**
 * Returns the service-role client.  Cached after first call.
 *
 * Throws an informative error if SUPABASE_SERVICE_ROLE_KEY is missing
 * or empty — DO NOT silently fall back to the anon key, because that
 * masks RLS-bypass requirements (cron jobs, webhooks, audit log
 * writes) and causes mysterious "row not found" errors at runtime.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (_admin) return _admin
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL', 'supabase-admin.ts (getSupabaseAdmin)')
  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY', 'supabase-admin.ts (getSupabaseAdmin)')
  _admin = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
  return _admin
}

// ─── Lazy anon singleton ────────────────────────────────────────────
let _anon: SupabaseClient | null = null

/**
 * Returns the anon-key client.  Cached after first call.
 * RLS is enforced on every query through this client.
 */
export function getSupabaseAnon(): SupabaseClient {
  if (_anon) return _anon
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL', 'supabase-admin.ts (getSupabaseAnon)')
  const key = requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'supabase-admin.ts (getSupabaseAnon)')
  _anon = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
  return _anon
}

// ─── Back-compat "service ?? anon" fallback ────────────────────────
let _adminOrAnon: SupabaseClient | null = null

/**
 * Mirrors the legacy pattern used in many existing route files:
 *
 *    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
 *
 * Prefer `getSupabaseAdmin()` going forward.  This helper exists ONLY
 * so the file-by-file migration is a 1:1 behavioural swap.  It emits
 * a one-time console.warn when it falls back to the anon key, so the
 * issue is visible in logs even though it no longer crashes the
 * build.
 */
export function getSupabaseAdminOrAnon(): SupabaseClient {
  if (_adminOrAnon) return _adminOrAnon
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL', 'supabase-admin.ts (getSupabaseAdminOrAnon)')
  const key = getEnvOrFallback(
    ['SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'],
    { usedBy: 'supabase-admin.ts (getSupabaseAdminOrAnon)', warnFallback: true }
  )
  _adminOrAnon = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
  return _adminOrAnon
}

// ─── Proxy exports for minimal-diff back-compat ────────────────────
/**
 * Build a transparent proxy over one of the lazy factories.  Property
 * access on the proxy triggers client construction at *call time*,
 * not module-load time — so `next build` no longer fails when env
 * vars are evaluated during page-data collection.
 *
 * Functions are bound to the underlying client so `this` is correct
 * for chained methods (e.g. `.from('x').select('y').eq('z', 1)`).
 */
function makeLazyProxy(getClient: () => SupabaseClient): SupabaseClient {
  return new Proxy({} as SupabaseClient, {
    get(_target, prop) {
      const client = getClient() as unknown as Record<string | symbol, unknown>
      const value = client[prop]
      return typeof value === 'function' ? (value as Function).bind(client) : value
    },
    has(_target, prop) {
      return prop in (getClient() as unknown as Record<string | symbol, unknown>)
    },
    ownKeys() {
      return Reflect.ownKeys(getClient() as unknown as object)
    },
    getOwnPropertyDescriptor(_target, prop) {
      return Object.getOwnPropertyDescriptor(getClient(), prop)
    },
  })
}

/**
 * Drop-in replacement for the legacy
 *   const supabase = createClient(URL, SERVICE_ROLE, ...)
 * pattern.  Use:
 *   import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
 */
export const supabaseAdmin: SupabaseClient = makeLazyProxy(getSupabaseAdmin)

/**
 * Drop-in replacement for the legacy
 *   const supabase = createClient(URL, ANON_KEY)
 * pattern (used by routes that operate under RLS).  Use:
 *   import { supabaseAnon as supabase } from '@/lib/supabase-admin'
 */
export const supabaseAnon: SupabaseClient = makeLazyProxy(getSupabaseAnon)

/**
 * Drop-in replacement for the legacy
 *   const supabase = createClient(URL, SERVICE_ROLE ?? ANON_KEY, ...)
 * pattern.  Prefer `supabaseAdmin` for new code.
 */
export const supabaseAdminOrAnon: SupabaseClient = makeLazyProxy(getSupabaseAdminOrAnon)