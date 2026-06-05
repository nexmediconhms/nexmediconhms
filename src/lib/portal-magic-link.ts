/**
 * src/lib/portal-magic-link.ts  — SERVER ONLY
 *
 * Shared helper to generate a Patient-Portal magic link (one-tap login)
 * and resolve the live site origin from an incoming request.
 *
 * Used by:
 *   - /api/labs/notify        (staff saves a lab report → notify patient)
 *   - /api/labs/report-upload (lab partner uploads a report → notify patient)
 *
 * WHY A SHARED HELPER:
 *   Both flows need to (a) figure out the correct public URL of the
 *   current deployment, and (b) create a short-lived magic-link token so
 *   the patient can tap one link and land logged-in on their portal with
 *   the latest data. Keeping this in one place avoids the stale-env-var
 *   and double-slash bugs we fixed earlier (we always use the URL()
 *   constructor + request host).
 *
 * SAFE BY DESIGN:
 *   - Never throws. On any failure it returns null and the caller simply
 *     falls back to the existing behaviour (no portal link in the message).
 *   - Only touches the portal_otp table (created by migration 017).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { randomUUID, randomInt } from 'crypto'

export interface PortalMagicLink {
  /** Full URL the patient taps, e.g. https://host/portal/verify?token=… */
  portalUrl: string
  /** The raw magic-link token (also stored in portal_otp.token) */
  token: string
}

/** Minimal shape we need from a request — works with NextRequest. */
interface HeaderCarrier {
  headers: { get(name: string): string | null }
}

/**
 * Resolve the public origin of the CURRENT deployment.
 *
 * Priority:
 *   1. x-forwarded-host / host header  ← always the live deployment URL
 *   2. NEXT_PUBLIC_SITE_URL env var    ← fallback (may be stale)
 *   3. VERCEL_URL                      ← Vercel auto-injected
 *   4. hardcoded fallback
 *
 * Always returns an origin like "https://example.com" with NO trailing slash.
 */
export function resolvePortalOrigin(req: HeaderCarrier): string {
  const forwardedHost = req.headers.get('x-forwarded-host')
  const host = req.headers.get('host')
  const proto = req.headers.get('x-forwarded-proto') || 'https'
  const liveHost = forwardedHost || host

  if (liveHost) {
    try {
      return new URL(`${proto}://${liveHost}`).origin
    } catch {
      /* fall through */
    }
  }

  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL
  if (fromEnv && fromEnv.trim()) {
    try {
      return new URL(fromEnv.trim()).origin
    } catch {
      /* fall through */
    }
  }

  if (process.env.VERCEL_URL) {
    try {
      return new URL(`https://${process.env.VERCEL_URL}`).origin
    } catch {
      /* fall through */
    }
  }

  return 'https://your-domain.vercel.app'
}

/**
 * Build a portal URL safely (URL() constructor prevents double slashes).
 */
export function buildPortalPath(origin: string, path: string, params: Record<string, string> = {}): string {
  const u = new URL(path, origin)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  return u.toString()
}

/**
 * Create a magic-link token for a patient and return the tap-to-login URL.
 *
 * The link points at /portal/verify?token=… which, when opened, creates a
 * fresh 7-day portal session and lands the patient on their dashboard
 * showing the LATEST data (prescriptions, labs, bills, appointments).
 *
 * @returns PortalMagicLink, or null if the token could not be created.
 *          The caller should treat null as "no portal link available" and
 *          continue with its normal behaviour.
 */
export async function generatePortalMagicLink(
  supabase: SupabaseClient,
  origin: string,
  patient: { id: string; mrn?: string | null; mobile?: string | null },
  opts: { validHours?: number } = {}
): Promise<PortalMagicLink | null> {
  if (!patient?.id) return null

  const validHours = opts.validHours ?? 24
  const normalizedMobile = patient.mobile ? patient.mobile.replace(/\D/g, '').slice(-10) : ''
  const token = randomUUID()
  const expiresAt = new Date(Date.now() + validHours * 60 * 60 * 1000).toISOString()

  try {
    // ── BUG-PT01 fix: expire previous unverified links by PATIENT, not by mobile ──
    //
    // The previous behaviour was:
    //     .eq('mobile', normalizedMobile).eq('verified', false)
    //
    // In Indian clinics it is common for a single mobile number to be
    // shared across multiple patients in the same family (parent + minor
    // child, husband + wife who share a phone, etc.).  Each patient has
    // their OWN portal_otp records keyed on patient_id, but the previous
    // expiry query collapsed them by mobile alone — so generating a new
    // link for Patient B silently invalidated Patient A's still-valid,
    // unused link.  Patient A would tap the WhatsApp link and hit
    // "Invalid or expired link" through no fault of their own.
    //
    // New behaviour:
    //   - Always scope by patient_id (we always have it here).
    //   - As a defensive secondary scope we also include the mobile
    //     filter so a malformed row with a wrong patient_id can't
    //     accidentally have its sibling's lock cleared, BUT only when
    //     the mobile is non-empty.
    //   - Anything still considered "this patient's pending link" gets
    //     marked verified=true to retire it before we issue the new one.
    let expireQuery = supabase
      .from('portal_otp')
      .update({ verified: true })
      .eq('patient_id', patient.id)
      .eq('verified', false)
    if (normalizedMobile) {
      expireQuery = expireQuery.eq('mobile', normalizedMobile)
    }
    await expireQuery

    const otpCode = String(randomInt(100000, 999999))
    const { error } = await supabase.from('portal_otp').insert({
      mobile:     normalizedMobile || '',
      otp_code:   otpCode,
      token,
      patient_id: patient.id,
      mrn:        patient.mrn || null,
      expires_at: expiresAt,
    })

    if (error) {
      console.warn('[portal-magic-link] Could not create token:', error.message)
      return null
    }
  } catch (e: any) {
    console.warn('[portal-magic-link] Unexpected error:', e?.message)
    return null
  }

  const portalUrl = buildPortalPath(origin, '/portal/verify', { token })
  return { portalUrl, token }
}

/**
 * Build a wa.me deep link for a mobile number + message.
 * Returns null if the mobile is missing/invalid.
 */
export function buildWhatsAppLink(mobile: string | null | undefined, message: string): string | null {
  const digits = (mobile || '').replace(/\D/g, '')
  if (!digits) return null
  const full = digits.length === 10 ? `91${digits}` : digits
  return `https://wa.me/${full}?text=${encodeURIComponent(message)}`
}