import { createClient, SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Optional read replica URL (configure in env for failover)
const replicaUrl = process.env.NEXT_PUBLIC_SUPABASE_REPLICA_URL || ''

// Client-side Supabase client (uses anon key, respects RLS)
export const supabase = createClient(supabaseUrl, supabaseKey)

// ─── Read Replica Support ─────────────────────────────────────

let _replicaClient: SupabaseClient | null = null

/**
 * Get a read-only Supabase client pointing to the replica.
 * Falls back to primary if no replica is configured.
 */
export function getReplicaClient(): SupabaseClient {
  if (!replicaUrl) return supabase

  if (!_replicaClient) {
    _replicaClient = createClient(replicaUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  }
  return _replicaClient
}

// ─── Connection Health Monitoring ─────────────────────────────

let _connectionHealthy = true
let _lastHealthCheck = 0
const HEALTH_CHECK_INTERVAL = 30000 // 30 seconds

/**
 * Check if the primary Supabase connection is healthy.
 * Caches result for 30 seconds to avoid excessive checks.
 */
export async function isConnectionHealthy(): Promise<boolean> {
  const now = Date.now()
  if (now - _lastHealthCheck < HEALTH_CHECK_INTERVAL) {
    return _connectionHealthy
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const { error } = await supabase
      .from('clinic_settings')
      .select('key')
      .limit(1)
      .abortSignal(controller.signal)

    clearTimeout(timeout)
    _connectionHealthy = !error
    _lastHealthCheck = now
    return _connectionHealthy
  } catch {
    _connectionHealthy = false
    _lastHealthCheck = now
    return false
  }
}

/**
 * Execute a query with automatic retry and failover.
 * Tries primary first, then replica for reads, with exponential backoff.
 */
export async function withRetry<T>(
  operation: (client: SupabaseClient) => Promise<{ data: T | null; error: any }>,
  options: { maxRetries?: number; isReadOnly?: boolean } = {}
): Promise<{ data: T | null; error: any }> {
  const { maxRetries = 3, isReadOnly = false } = options

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await operation(supabase)
      if (!result.error) {
        _connectionHealthy = true
        return result
      }

      // If primary fails and this is a read operation, try replica
      if (isReadOnly && replicaUrl && attempt === 0) {
        const replicaResult = await operation(getReplicaClient())
        if (!replicaResult.error) return replicaResult
      }

      // Exponential backoff before retry
      if (attempt < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000))
      }
    } catch (err) {
      if (attempt === maxRetries - 1) {
        return { data: null, error: err }
      }
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000))
    }
  }

  return { data: null, error: new Error('All retry attempts failed') }
}

// ─── Admin Client ─────────────────────────────────────────────

/**
 * Server-side Supabase admin client (uses service_role key).
 * Only use in API routes — NEVER expose to the browser.
 * Required for:
 *   - Creating new auth users (invite flow)
 *   - Admin operations that bypass RLS
 *   - Password reset emails
 */
export function getAdminClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. ' +
      'Add it to your .env.local or Vercel environment variables. ' +
      'Find it in Supabase → Project Settings → API → service_role key.'
    )
  }
  return createClient(supabaseUrl, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
