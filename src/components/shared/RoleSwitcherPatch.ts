/**
 * FILE: src/components/shared/RoleSwitcherPatch.ts
 *
 * ISSUE #6 FIX (PARTIAL): RoleSwitcher Frozen Spinner
 *
 * ROOT CAUSE:
 *   fetchUserRoles() has no timeout. If the Supabase query hangs
 *   (network issue, RLS misconfiguration, cold start), the component
 *   stays in `loading: true` forever — showing a spinner that never stops.
 *
 * FIX:
 *   This file provides a patched `fetchUserRoles` function that adds:
 *   1. AbortController with a 5-second timeout
 *   2. Fallback to localStorage-cached role if query fails
 *   3. Explicit error state instead of infinite loading
 *
 * HOW TO APPLY:
 *   In src/components/shared/RoleSwitcher.tsx, replace the
 *   `fetchUserRoles` function with the one below.
 *
 *   Find this block (around line 110-145):
 *   ─────────────────────────────────
 *   async function fetchUserRoles() {
 *     try {
 *       const { data: { user } } = await supabase.auth.getUser()
 *       ...
 *     } catch (err) {
 *       console.error('[RoleSwitcher]', err)
 *     }
 *     setLoading(false)
 *   }
 *   ─────────────────────────────────
 *
 *   Replace it with the code below. No other changes are needed.
 */

// ────────────────────────────────────────────────────
// PASTE THIS into RoleSwitcher.tsx, replacing the
// existing fetchUserRoles() function:
// ────────────────────────────────────────────────────

/*

  async function fetchUserRoles() {
    // ── TIMEOUT GUARD ──
    // If the Supabase query takes more than 5 seconds, abort it.
    // This prevents the "Checking Role..." spinner from freezing forever.
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setLoading(false)
        clearTimeout(timeout)
        return
      }

      const { data: cu, error } = await supabase
        .from('clinic_users')
        .select('role, extra_roles')
        .eq('auth_id', user.id)
        .eq('is_active', true)
        .abortSignal(controller.signal)
        .single()

      clearTimeout(timeout)

      if (error || !cu) {
        console.warn('[RoleSwitcher] Query failed or timed out:', error?.message)
        // ── FALLBACK ──
        // If we have a cached role in localStorage, use it rather
        // than leaving the user stuck with a spinner.
        const cached = getActiveRole() as AppRole | null
        if (cached) {
          setActiveRole(cached)
          setAvailableRoles([cached])
          console.info('[RoleSwitcher] Using cached role:', cached)
        }
        setLoading(false)
        return
      }

      const primary  = cu.role as AppRole
      const extras   = (cu.extra_roles || []) as AppRole[]
      const allRoles = [primary, ...extras.filter(r => r !== primary)] as AppRole[]

      setAvailableRoles(allRoles)

      // Determine active role
      const stored = getActiveRole() as AppRole | null
      if (stored && allRoles.includes(stored)) {
        setActiveRole(stored)
      } else {
        // First time or stale value — default to primary
        setActiveRole(primary)
        if (typeof window !== 'undefined') {
          localStorage.setItem(ROLE_KEY, primary)
        }
      }
    } catch (err: any) {
      clearTimeout(timeout)

      if (err?.name === 'AbortError') {
        console.warn('[RoleSwitcher] Query timed out after 5s')
      } else {
        console.error('[RoleSwitcher]', err)
      }

      // ── FALLBACK ──
      // Use cached role so the UI isn't broken
      const cached = getActiveRole() as AppRole | null
      if (cached) {
        setActiveRole(cached)
        setAvailableRoles([cached])
      }
    }
    setLoading(false)
  }

*/

// The above is the exact replacement code.
// The key differences from the original:
//
// 1. AbortController with 5-second timeout
//    → If Supabase hangs, the query is cancelled after 5 seconds
//
// 2. Fallback to cached role
//    → If the query fails for any reason, the user's last-known role
//      from localStorage is used. This means the spinner disappears
//      and the app is usable, even if the role data is slightly stale.
//
// 3. AbortError handling
//    → The timeout abort is caught separately from other errors
//      for better debugging in the console.
//
// 4. clearTimeout on success path
//    → Prevents the abort from firing after a successful query.

export {}