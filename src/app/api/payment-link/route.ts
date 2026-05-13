import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Creates a Razorpay Payment Link that can be sent via WhatsApp/SMS/email.
// The patient clicks the link and pays directly from their phone — no app needed.
// Razorpay then sends a webhook or we poll the status.

/**
 * Resolve UPI ID from clinic_settings (Supabase) based on billing context.
 * Fallback chain: context-specific → legacy upiId → env var.
 */
async function resolveUpiIdFromDB(context: 'opd' | 'ipd'): Promise<string> {
  const envFallback = process.env.NEXT_PUBLIC_UPI_ID ?? ''
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } }
    )
    const { data } = await supabase
      .from('clinic_settings')
      .select('value')
      .eq('key', 'hospital_settings')
      .maybeSingle()
    if (data?.value) {
      const settings = JSON.parse(data.value)
      if (context === 'ipd') return settings.upiIdIPD || settings.upiId || envFallback
      return settings.upiIdOPD || settings.upiId || envFallback
    }
  } catch { /* fall through to env */ }
  return envFallback
}

export async function POST(req: NextRequest) {
  try {
    const { patientName, mobile, email, amount, description, notes, billingContext } = await req.json()

    const keyId     = process.env.RAZORPAY_KEY_ID     ?? ''
    const keySecret = process.env.RAZORPAY_KEY_SECRET  ?? ''

    if (!keyId || keyId.includes('YOUR') || !keySecret || keySecret.includes('YOUR')) {
      // Return a WhatsApp-friendly UPI deeplink as fallback (no secret key needed)
      // This is a standard UPI payment URL that opens any UPI app
      const context = (billingContext === 'ipd') ? 'ipd' : 'opd' as const
      const upiId = await resolveUpiIdFromDB(context)
      const amtFmt = (amount / 100).toFixed(2)

      if (upiId && !upiId.includes('YOUR')) {
        const upiUrl = `upi://pay?pa=${upiId}&pn=${encodeURIComponent(patientName || 'Hospital')}&am=${amtFmt}&cu=INR&tn=${encodeURIComponent(description || 'Hospital Payment')}`
        const waText = `Hello ${patientName},\n\nPlease complete your payment of ₹${amtFmt} to ${process.env.NEXT_PUBLIC_HOSPITAL_NAME || 'our hospital'}.\n\nClick to pay via UPI:\n${upiUrl}\n\nOr use UPI ID: ${upiId}\n\nThank you!`
        return NextResponse.json({ type: 'upi', url: upiUrl, whatsappText: waText, amount: amtFmt })
      }

      return NextResponse.json({
        type: 'manual',
        message: 'Configure RAZORPAY_KEY_SECRET and RAZORPAY_KEY_ID in .env.local for payment links, or set UPI IDs in Settings.',
        whatsappText: `Hello ${patientName},\n\nYour registration at our hospital is complete.\n\nPlease visit the reception to complete payment of ₹${(amount/100).toFixed(2)} before your consultation.\n\nThank you!`
      })
    }

    // Create Razorpay Payment Link via their API
    const body = {
      amount,                // in paise
      currency: 'INR',
      accept_partial: false,
      description: description || 'Hospital Payment',
      customer: {
        name:    patientName || 'Patient',
        contact: mobile      || '',
        email:   email       || '',
      },
      notify: {
        sms:   !!mobile,
        email: !!email,
      },
      reminder_enable: true,
      notes:   notes || {},
      callback_url:    process.env.NEXT_PUBLIC_SITE_URL ? `${process.env.NEXT_PUBLIC_SITE_URL}/payment-success` : undefined,
      callback_method: 'get',
    }

    const resp = await fetch('https://api.razorpay.com/v1/payment_links', {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64'),
      },
      body: JSON.stringify(body),
    })

    const data = await resp.json()
    if (!resp.ok) {
      throw new Error(data.error?.description || 'Razorpay API error')
    }

    const shortUrl = data.short_url || data.id
    const amtFmt   = (amount / 100).toFixed(2)
    const waText   = `Hello ${patientName},\n\nThank you for registering at ${process.env.NEXT_PUBLIC_HOSPITAL_NAME || 'our hospital'}.\n\nPlease complete your payment of ₹${amtFmt} using the link below:\n\n${shortUrl}\n\nThe link is valid for 24 hours. For help, call us.\n\nThank you!`

    return NextResponse.json({ type: 'razorpay', url: shortUrl, whatsappText: waText, amount: amtFmt })

  } catch (err: any) {
    console.error('Payment link error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
