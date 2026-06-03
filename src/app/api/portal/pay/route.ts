/**
 * src/app/api/portal/pay/route.ts
 *
 * Patient Portal — Pay Invoice
 *
 * POST { bill_id, payment_mode: "upi" | "card" }
 * Header: X-Portal-Session: <session_token>
 *
 * Generates a payment link (Razorpay or UPI deeplink) for the bill.
 * On successful payment callback, marks bill as paid.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY!
const hospitalName = process.env.NEXT_PUBLIC_HOSPITAL_NAME || 'NexMedicon Hospital'

async function validatePortalSession(supabase: any, token: string) {
  if (!token) return null
  const { data } = await supabase
    .from('portal_sessions')
    .select('patient_id, mrn, mobile, expires_at, is_active')
    .eq('session_token', token)
    .eq('is_active', true)
    .single()
  if (!data || new Date(data.expires_at) < new Date()) return null
  return data
}

export async function POST(req: NextRequest) {
  try {
    const sessionToken = req.headers.get('x-portal-session') || ''
    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

    const session = await validatePortalSession(supabase, sessionToken)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { bill_id, payment_mode } = await req.json()

    if (!bill_id) {
      return NextResponse.json({ error: 'bill_id is required' }, { status: 400 })
    }

    // Fetch the bill (ensure it belongs to this patient)
    const { data: bill, error: billErr } = await supabase
      .from('bills')
      .select('*')
      .eq('id', bill_id)
      .eq('patient_id', session.patient_id)
      .single()

    if (billErr || !bill) {
      return NextResponse.json({ error: 'Bill not found' }, { status: 404 })
    }

    if (bill.status === 'paid') {
      return NextResponse.json({ error: 'Bill is already paid' }, { status: 400 })
    }

    const amount = Number(bill.net_amount)
    const amountPaise = Math.round(amount * 100)

    // Try Razorpay first
    const keyId     = process.env.RAZORPAY_KEY_ID ?? ''
    const keySecret = process.env.RAZORPAY_KEY_SECRET ?? ''

    if (keyId && !keyId.includes('YOUR') && keySecret && !keySecret.includes('YOUR')) {
      // Create Razorpay payment link
      const rpBody = {
        amount: amountPaise,
        currency: 'INR',
        accept_partial: false,
        description: `Bill Payment - ${bill.mrn}`,
        customer: {
          name:    bill.patient_name || 'Patient',
          contact: session.mobile ? `+91${session.mobile}` : '',
        },
        notify: { sms: true },
        reminder_enable: true,
        notes: { bill_id: bill.id, mrn: bill.mrn, patient_id: session.patient_id },
        callback_url: `${(process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/+$/, '')}/portal/dashboard?payment=success&bill_id=${bill.id}`,
        callback_method: 'get',
      }

      const resp = await fetch('https://api.razorpay.com/v1/payment_links', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64'),
        },
        body: JSON.stringify(rpBody),
      })

      const rpData = await resp.json()
      if (resp.ok && rpData.short_url) {
        // Update bill with payment link
        await supabase
          .from('bills')
          .update({ payment_link_url: rpData.short_url, payment_link_type: 'razorpay' })
          .eq('id', bill.id)

        return NextResponse.json({
          success: true,
          type: 'razorpay',
          payment_url: rpData.short_url,
          amount: amount.toFixed(2),
        })
      }
    }

    // Fallback: UPI deeplink — resolve from clinic_settings based on bill context
    // Determine context: if bill items contain IPD-related labels → ipd, else opd
    const billItems = Array.isArray(bill.items) ? bill.items : []
    const isIPD = billItems.some((item: any) =>
      /ipd|admission|bed|nursing/i.test(item.label || '')
    )
    const upiContext = isIPD ? 'ipd' : 'opd'

    let upiId = ''
    try {
      const { data: settingsRow } = await supabase
        .from('clinic_settings')
        .select('value')
        .eq('key', 'hospital_settings')
        .maybeSingle()
      if (settingsRow?.value) {
        const settings = JSON.parse(settingsRow.value)
        upiId = upiContext === 'ipd'
          ? (settings.upiIdIPD || settings.upiId || '')
          : (settings.upiIdOPD || settings.upiId || '')
      }
    } catch { /* fall through */ }
    // Final fallback to env var
    if (!upiId) upiId = process.env.NEXT_PUBLIC_UPI_ID ?? ''

    if (upiId && !upiId.includes('YOUR')) {
      const upiUrl = `upi://pay?pa=${upiId}&pn=${encodeURIComponent(hospitalName)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(`Bill ${bill.mrn}`)}`

      await supabase
        .from('bills')
        .update({ payment_link_url: upiUrl, payment_link_type: 'upi' })
        .eq('id', bill.id)

      return NextResponse.json({
        success: true,
        type: 'upi',
        payment_url: upiUrl,
        upi_id: upiId,
        amount: amount.toFixed(2),
      })
    }

    // No payment gateway configured
    return NextResponse.json({
      success: false,
      type: 'manual',
      message: 'Online payment is not configured. Please visit the hospital to pay.',
      amount: amount.toFixed(2),
    })

  } catch (err: any) {
    console.error('Portal pay error:', err)
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
  }
}

/**
 * PATCH — Mark bill as paid (called after payment confirmation)
 * In production, this would be a Razorpay webhook. For now, patient confirms.
 */
export async function PATCH(req: NextRequest) {
  try {
    const sessionToken = req.headers.get('x-portal-session') || ''
    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

    const session = await validatePortalSession(supabase, sessionToken)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { bill_id, payment_mode, transaction_id } = await req.json()

    const { error } = await supabase
      .from('bills')
      .update({
        status: 'paid',
        payment_mode: payment_mode || 'upi',
        paid_at: new Date().toISOString(),
        razorpay_payment_id: transaction_id || null,
      })
      .eq('id', bill_id)
      .eq('patient_id', session.patient_id)

    if (error) {
      return NextResponse.json({ error: 'Failed to update bill' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}