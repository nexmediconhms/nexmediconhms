/**
 * src/lib/query-helpers.ts
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE:
 * ────────
 * Provides error handling wrappers for Supabase database queries.
 * 
 * THE BUG (Bug #12):
 * ──────────────────
 * Every supabase.from(...).select(...) call in the app has ZERO error handling.
 * The code destructures only `{ data }` and ignores `{ error }` completely.
 * 
 * What happens when Supabase is down, internet is lost, or a table doesn't exist?
 * → The UI shows a blank/empty screen with NO feedback to the user
 * → In a hospital setting, staff may think "no patients today" when actually
 *   the system is broken
 * → Doctor misses critical patient data because screen looks "empty"
 * 
 * WHAT THIS FILE DOES:
 * ────────────────────
 * 1. `safeQuery()` — wraps any Supabase query and returns a clean result
 *    with user-friendly error messages instead of cryptic database errors
 * 2. Categorizes errors (network, auth expired, table missing, etc.)
 * 3. Provides retry guidance to the UI
 * 
 * WHERE IT'S USED:
 * ────────────────
 * - src/app/dashboard/page.tsx (all stat queries)
 * - src/app/patients/page.tsx (patient list)
 * - Any page that loads data from Supabase
 * 
 * DOES IT BREAK ANYTHING?
 * ───────────────────────
 * No. It's a NEW utility file. The existing queries continue to work exactly
 * as before. We gradually apply safeQuery() to existing pages. Pages that
 * haven't been updated yet still work — they just don't show error messages.
 * 
 * HOW TO USE:
 * ───────────
 * BEFORE (no error handling):
 *   const { data } = await supabase.from('patients').select('*').limit(100)
 *   setPatients(data || [])
 * 
 * AFTER (with error handling):
 *   const result = await safeQuery(
 *     supabase.from('patients').select('*').limit(100)
 *   )
 *   if (result.error) { setFetchError(result.error); return }
 *   setPatients(result.data || [])
 */

/**
 * Result type returned by safeQuery.
 * 
 * @property data - The query result (null if error occurred)
 * @property error - User-friendly error message (null if successful)
 * @property isOffline - True if the error is a network/connectivity issue
 * @property isAuthError - True if session expired (user needs to re-login)
 */
export interface SafeQueryResult<T> {
  data: T | null
  error: string | null
  isOffline: boolean
  isAuthError: boolean
}

/**
 * Wraps a Supabase query with proper error handling.
 * 
 * Translates technical database errors into simple messages that
 * a receptionist or nurse can understand.
 * 
 * @param queryPromise - The Supabase query (don't await it, pass the promise)
 * @returns SafeQueryResult with data or user-friendly error
 * 
 * @example
 * const result = await safeQuery(
 *   supabase.from('patients').select('*').order('created_at', { ascending: false }).limit(100)
 * )
 * 
 * if (result.error) {
 *   setErrorMessage(result.error)  // Shows: "Unable to connect. Check internet."
 *   return
 * }
 * 
 * setPatients(result.data || [])
 */
export async function safeQuery<T>(
  queryPromise: PromiseLike<{ data: T | null; error: any; count?: number | null }>
): Promise<SafeQueryResult<T> & { count?: number | null }> {
  try {
    const { data, error, count } = await queryPromise

    if (error) {
      const msg = error.message || String(error) || 'Unknown database error'

      // Network errors
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('ERR_')) {
        return {
          data: null,
          error: 'Unable to connect to the server. Please check your internet connection and try again.',
          isOffline: true,
          isAuthError: false,
          count: null,
        }
      }

      // Authentication errors
      if (msg.includes('JWT expired') || msg.includes('invalid claim') || msg.includes('not authenticated')) {
        return {
          data: null,
          error: 'Your session has expired. Please log in again.',
          isOffline: false,
          isAuthError: true,
          count: null,
        }
      }

      // Table/schema errors
      if (msg.includes('relation') && msg.includes('does not exist')) {
        return {
          data: null,
          error: 'Database table not found. Please contact the administrator.',
          isOffline: false,
          isAuthError: false,
          count: null,
        }
      }

      // Permission errors (RLS)
      if (msg.includes('permission denied') || msg.includes('row-level security')) {
        return {
          data: null,
          error: 'You do not have permission to access this data. Please contact admin.',
          isOffline: false,
          isAuthError: false,
          count: null,
        }
      }

      // Timeout errors
      if (msg.includes('timeout') || msg.includes('statement timeout')) {
        return {
          data: null,
          error: 'The request took too long. Please try again or use a more specific search.',
          isOffline: false,
          isAuthError: false,
          count: null,
        }
      }

      // Generic database error — show abbreviated technical message
      return {
        data: null,
        error: `Data load failed: ${msg.slice(0, 100)}`,
        isOffline: false,
        isAuthError: false,
        count: null,
      }
    }

    // Success
    return { data, error: null, isOffline: false, isAuthError: false, count }
  } catch (e: any) {
    // JavaScript-level error (fetch itself threw, AbortController, etc.)
    const errMsg = e?.message || 'Unknown error'
    
    if (errMsg.includes('fetch') || errMsg.includes('network') || errMsg.includes('abort')) {
      return {
        data: null,
        error: 'Connection lost. Please check your internet and try again.',
        isOffline: true,
        isAuthError: false,
        count: null,
      }
    }

    return {
      data: null,
      error: `Something went wrong: ${errMsg.slice(0, 80)}`,
      isOffline: false,
      isAuthError: false,
      count: null,
    }
  }
}
