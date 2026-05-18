/**
 * src/app/api/payment-link/route.ts
 *
 * Generate a payment link for a patient (Razorpay payment link with UPI
 * fallback). Returns a WhatsApp-ready text snippet so reception can
 * paste it into chat.
 *
 * SECURITY/ROBUSTNESS CHANGES (this revision):
 *   1. Now requires an authenticated clinic user with role
 *      admin / doctor / receptionist / staff. The previous version was
 *      open to the public internet, allowing anyone to:
 *        - generate Razorpay payment links charged to your hospital
 *        - probe whether RAZORPAY_KEY_ID is configured
 *        - send arbitrary "Hello {patientName}" SMS/WhatsApp text
 *   2. Strict input validation:
 *        - amount in paise: integer, 1 ≤ amount ≤ 100_00_00_000  (₹1 cr cap)
 *        - mobile: optional, normalised to 10 digits (Razorpay needs E.164,
 *          callers can wrap in country code)
 *        - email: optional, basic shape check
 *        - patientName / description: capped at 200 chars to keep
 *          generated WhatsApp text bounded
 *        - billingContext: 'opd' | 'ipd' (others coerced to 'opd')
 *        - notes: must be a flat object of string values, capped at 15 keys
 *   3. The Razorpay error body is no longer echoed to the client (it can
 *      contain merchant info / debug strings); we log it server-side and
 *      return a generic 502.
 *   4. Service-role Supabase client only used inside the resolver, never
 *      surfaced to the response.
 *   5. runtime='nodejs' (Buffer/Basic auth header) and dynamic='force-dynamic'
 *      so this is never statically optimised.
 *
 * UI CONTRACT:
 *   The "patients/new" page now sends Authorization: Bearer <token>.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireRole }                from '@/lib/api-auth'
import { getSupabaseAdmin }           from '@/lib/supabase-admin'

export const runtime  = 'nodejs'
export const dynamic  = 'force-dynamic'

// ─── Constants ────────────────────────────────────────────────
const MAX_AMOUNT_PAISE = 100_00_00_000  // ₹1 crore — sane upper bound
const MAX_NAME_LEN     = 200
const MAX_DESC_LEN     = 200
const MAX_NOTE_KEYS    = 15
const MAX_NOTE_VAL_LEN = 500

// ─── Helpers ──────────────────────────────────────────────────
function logErr(scope: string, err: unknown) {
  const klass = (err as any)?.constructor?.name || 'Error'
  const msg   = (err as any)?.message            || String(err)
  console.error(`[payment-link] ${scope}: ${klass} ${msg}`)
}

function clipString(v: unknown, max: number): string {
  if (typeof v !== 'string') return ''
  return v.trim().slice(0, max)
}

// Light email shape check — Razorpay validates fully on its side.
function looksLikeEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254
}

// Normalise a mobile to digits-only. Returns '' if not 10–15 digits.
function normaliseMobile(s: unknown): string {
  if (typeof s !== 'string') return ''
  const digits = s.replace(/\D+/g, '')
  if (digits.length < 10 || digits.length > 15) return ''
  return digits
}

// Sanitise a free-form notes object → flat <string,string> map.
function sanitiseNotes(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const out: Record<string, string> = {}
  let count = 0
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (count >= MAX_NOTE_KEYS) break
    const key = String(k).slice(0, 64)
    const val = (v == null) ? '' : String(v).slice(0, MAX_NOTE_VAL_LEN)
    out[key] = val
    count++
  }
  return out
}

/**
 * Resolve UPI ID from clinic_settings (Supabase) based on billing context.
 * Fallback chain: context-specific → legacy upiId → env var.
 */
async function resolveUpiIdFromDB(context: 'opd' | 'ipd'): Promise<string> {
  const envFallback = process.env.NEXT_PUBLIC_UPI_ID ?? ''
  try {
    const supabase = getSupabaseAdmin()
    const { data } = await supabase
      .from('clinic_settings')
      .select('value')
      .eq('key', 'hospital_settings')
      .maybeSingle()
    if (data?.value) {
      const settings = typeof data.value === 'string' ? JSON.parse(data.value) : data.value
      if (context === 'ipd') return settings.upiIdIPD || settings.upiId || envFallback
      return settings.upiIdOPD || settings.upiId || envFallback
    }
  } catch (err) {
    logErr('resolveUpiId', err)
  }
  return envFallback
}

// ──────────────────────────────────────────────────────────────
// POST handler
// ──────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // Anyone with a clinic role can request a link — patients still pay
  // through Razorpay/UPI on the other end. We just don't want random
  // internet traffic generating payment requests through us.
  const auth = await requireRole(req, ['admin', 'doctor', 'receptionist', 'staff'])
  if (auth instanceof Response) return auth

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (!raw || typeof raw !== 'object') {
    return NextResponse.json({ error: 'Request body is required.' }, { status: 400 })
  }
  const body = raw as Record<string, unknown>

  // ── Validate amount (in paise) ──────────────────────────────
  const amountNum = Number(body.amount)
  if (!Number.isFinite(amountNum) || !Number.isInteger(amountNum) || amountNum <= 0) {
    return NextResponse.json(
      { error: 'amount must be a positive integer in paise.' },
      { status: 400 }
    )
  }
  if (amountNum > MAX_AMOUNT_PAISE) {
    return NextResponse.json(
      { error: 'amount exceeds the per-link limit.' },
      { status: 400 }
    )
  }

  // ── Validate / sanitise other fields ────────────────────────
  const patientName = clipString(body.patientName, MAX_NAME_LEN) || 'Patient'
  const description = clipString(body.description, MAX_DESC_LEN) || 'Hospital Payment'
  const mobile      = normaliseMobile(body.mobile)
  const emailRaw    = clipString(body.email, 254)
  const email       = emailRaw && looksLikeEmail(emailRaw) ? emailRaw : ''
  const notes       = sanitiseNotes(body.notes)
  const billingCtx  = (body.billingContext === 'ipd') ? 'ipd' : 'opd' as 'opd' | 'ipd'

  // ── Razorpay credentials gate ───────────────────────────────
  const keyId     = process.env.RAZORPAY_KEY_ID     ?? ''
  const keySecret = process.env.RAZORPAY_KEY_SECRET ?? ''
  const razorpayConfigured =
    !!keyId && !keyId.includes('YOUR') && !!keySecret && !keySecret.includes('YOUR')

  const amtFmt   = (amountNum / 100).toFixed(2)
  const hospital = process.env.NEXT_PUBLIC_HOSPITAL_NAME || 'our hospital'

  // ── Razorpay NOT configured → UPI / manual fallback ─────────
  if (!razorpayConfigured) {
    const upiId = await resolveUpiIdFromDB(billingCtx)

    if (upiId && !upiId.includes('YOUR')) {
      const upiUrl =
        `upi://pay?pa=${encodeURIComponent(upiId)}` +
        `&pn=${encodeURIComponent(patientName)}` +
        `&am=${amtFmt}` +
        `&cu=INR` +
        `&tn=${encodeURIComponent(description)}`
      const waText =
        `Hello ${patientName},\n\n` +
        `Please complete your payment of ₹${amtFmt} to ${hospital}.\n\n` +
        `Click to pay via UPI:\n${upiUrl}\n\n` +
        `Or use UPI ID: ${upiId}\n\n` +
        `Thank you!`
      return NextResponse.json({
        type: 'upi',
        url: upiUrl,
        whatsappText: waText,
        amount: amtFmt,
      })
    }

    return NextResponse.json({
      type: 'manual',
      message:
        'Configure RAZORPAY_KEY_SECRET and RAZORPAY_KEY_ID in env, or set UPI IDs in Settings.',
      whatsappText:
        `Hello ${patientName},\n\n` +
        `Your registration at ${hospital} is complete.\n\n` +
        `Please visit reception to complete payment of ₹${amtFmt} before your consultation.\n\n` +
        `Thank you!`,
    })
  }

  // ── Razorpay configured → call Razorpay payment-links API ───
  try {
    const callbackBase = process.env.NEXT_PUBLIC_SITE_URL
    const rzpBody = {
      amount:           amountNum,
      currency:         'INR',
      accept_partial:   false,
      description,
      customer:         { name: patientName, contact: mobile, email },
      notify:           { sms: !!mobile, email: !!email },
      reminder_enable:  true,
      notes,
      ...(callbackBase ? {
        callback_url:    `${callbackBase}/payment-success`,
        callback_method: 'get' as const,
      } : {}),
    }

    const resp = await fetch('https://api.razorpay.com/v1/payment_links', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64'),
      },
      body: JSON.stringify(rzpBody),
    })

    const data = await resp.json().catch(() => ({} as Record<string, unknown>))

    if (!resp.ok) {
      // Don't leak Razorpay's error body to the client — it can include
      // merchant identifiers and partial PII echoed back from our request.
      logErr('razorpay.create', new Error(`status=${resp.status} body=${JSON.stringify(data).slice(0, 500)}`))
      return NextResponse.json(
        { error: 'Could not create payment link upstream. Please retry.' },
        { status: 502 }
      )
    }

    const shortUrl = (data as { short_url?: string; id?: string }).short_url
                  || (data as { id?: string }).id
                  || ''
    if (!shortUrl) {
      logErr('razorpay.create', new Error('Missing short_url/id in Razorpay response'))
      return NextResponse.json(
        { error: 'Payment link upstream returned an unexpected response.' },
        { status: 502 }
      )
    }

    const waText =
      `Hello ${patientName},\n\n` +
      `Thank you for registering at ${hospital}.\n\n` +
      `Please complete your payment of ₹${amtFmt} using the link below:\n\n` +
      `${shortUrl}\n\n` +
      `The link is valid for 24 hours. For help, call us.\n\n` +
      `Thank you!`

    return NextResponse.json({
      type:         'razorpay',
      url:          shortUrl,
      whatsappText: waText,
      amount:       amtFmt,
    })
  } catch (err) {
    logErr('razorpay.exception', err)
    return NextResponse.json(
      { error: 'Could not create payment link. Please retry.' },
      { status: 500 }
    )
  }
}
