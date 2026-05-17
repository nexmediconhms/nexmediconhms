/**
 * POST /api/lab-report-ingest
 *
 * Mailgun webhook endpoint for automatic lab report import.
 * Receives email from lab → extracts PDF → matches patient → stores in Supabase.
 *
 * Setup:
 *   1. Configure Mailgun Route to forward to this URL
 *   2. Email format: labreport@lab.yourhospital.com
 *   3. Subject should contain patient name or MRN for auto-matching
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

// Use service role for server-side operations (bypasses RLS)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseServiceKey)

const MAILGUN_SIGNING_KEY = process.env.MAILGUN_WEBHOOK_SIGNING_KEY || ''

/**
 * Verify Mailgun webhook signature to prevent spoofing
 */
function verifyMailgunSignature(timestamp: string, token: string, signature: string): boolean {
  if (!MAILGUN_SIGNING_KEY) {
    console.warn('[Lab Import] MAILGUN_WEBHOOK_SIGNING_KEY not set — skipping verification')
    return true // Allow in dev mode
  }

  const hmac = crypto.createHmac('sha256', MAILGUN_SIGNING_KEY)
  hmac.update(timestamp + token)
  const expected = hmac.digest('hex')
  return expected === signature
}

/**
 * Match patient from email subject/body text
 */
async function matchPatient(subject: string, body: string): Promise<{ id: string; full_name: string; mrn: string } | null> {
  const text = `${subject} ${body}`.toLowerCase()

  // Try MRN pattern first (most reliable)
  const mrnMatch = text.match(/mrn[- ]?([a-z0-9]+)/i)
  if (mrnMatch) {
    const { data } = await supabase
      .from('patients')
      .select('id, full_name, mrn')
      .ilike('mrn', `%${mrnMatch[1]}%`)
      .limit(1)
      .maybeSingle()
    if (data) return data
  }

  // Try mobile number match
  const mobileMatch = text.match(/(\d{10})/)
  if (mobileMatch) {
    const { data } = await supabase
      .from('patients')
      .select('id, full_name, mrn')
      .ilike('mobile', `%${mobileMatch[1]}%`)
      .limit(1)
      .maybeSingle()
    if (data) return data
  }

  // Try name matching against recent patients
  const { data: patients } = await supabase
    .from('patients')
    .select('id, full_name, mrn')
    .order('created_at', { ascending: false })
    .limit(200)

  if (patients) {
    // Try exact name match first
    for (const p of patients) {
      if (text.includes(p.full_name.toLowerCase())) {
        return p
      }
    }
    // Try partial match (first name + last name)
    for (const p of patients) {
      const nameParts = p.full_name.toLowerCase().split(' ')
      if (nameParts.length >= 2) {
        const firstName = nameParts[0]
        const lastName = nameParts[nameParts.length - 1]
        if (text.includes(firstName) && text.includes(lastName)) {
          return p
        }
      }
    }
  }

  return null
}

/**
 * Extract lab name from sender email or subject
 */
function extractLabName(from: string, subject: string): string {
  const domainMatch = from.match(/@([^.]+)/)
  if (domainMatch) {
    const domain = domainMatch[1].toLowerCase()
    const commonProviders = ['gmail', 'yahoo', 'hotmail', 'outlook', 'rediffmail', 'aol']
    if (!commonProviders.includes(domain)) {
      return domain.charAt(0).toUpperCase() + domain.slice(1) + ' Lab'
    }
  }

  // Check known lab names in subject
  const knownLabs = ['metropolis', 'srl', 'thyrocare', 'lal path', 'dr lal', 'suburban', 'quest']
  const subjectLower = subject.toLowerCase()
  for (const lab of knownLabs) {
    if (subjectLower.includes(lab)) {
      return lab.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    }
  }

  return 'External Lab (Email Import)'
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()

    // Extract Mailgun fields
    const from = (formData.get('from') as string) || ''
    const subject = (formData.get('subject') as string) || ''
    const body = (formData.get('body-plain') as string) || ''
    const timestamp = (formData.get('timestamp') as string) || ''
    const token = (formData.get('token') as string) || ''
    const signature = (formData.get('signature') as string) || ''

    // Verify signature
    if (!verifyMailgunSignature(timestamp, token, signature)) {
      console.error('[Lab Import] Invalid Mailgun signature')
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
    }

    // Log the ingest
    console.log(`[Lab Import] Received email from: ${from}, subject: ${subject}`)

    // Extract attachment count
    const attachmentCount = parseInt((formData.get('attachment-count') as string) || '0')

    if (attachmentCount === 0) {
      // Still log the email even without attachments (might be a text-only report)
      console.log('[Lab Import] No attachments, checking body for report data...')

      // Try to create a basic entry from email body
      const patientMatch = await matchPatient(subject, body)
      if (patientMatch && body.trim().length > 50) {
        await supabase.from('lab_reports').insert({
          patient_id: patientMatch.id,
          report_date: new Date().toISOString().slice(0, 10),
          lab_name: extractLabName(from, subject),
          entries: [],
          notes: `Email report (no attachment).\nFrom: ${from}\nSubject: ${subject}\n\n${body.slice(0, 2000)}`,
        })
        return NextResponse.json({ status: 'ok', type: 'text_only', patient: patientMatch.full_name })
      }

      return NextResponse.json({ status: 'no_attachments' })
    }

    // Match patient
    const patientMatch = await matchPatient(subject, body)

    let imported = 0

    for (let i = 1; i <= Math.min(attachmentCount, 5); i++) {
      const attachment = formData.get(`attachment-${i}`) as File | null
      if (!attachment) continue

      // Only process relevant file types
      const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg', 'image/webp']
      if (!validTypes.includes(attachment.type)) {
        console.log(`[Lab Import] Skipping non-valid attachment: ${attachment.name} (${attachment.type})`)
        continue
      }

      // Generate unique filename
      const ext = attachment.name.split('.').pop() || 'pdf'
      const fileName = `lab-imports/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`

      // Upload to Supabase Storage
      const arrayBuffer = await attachment.arrayBuffer()
      const { error: uploadError } = await supabase.storage
        .from('patient-documents')
        .upload(fileName, arrayBuffer, {
          contentType: attachment.type,
          upsert: false,
        })

      if (uploadError) {
        console.error(`[Lab Import] Upload error for ${attachment.name}:`, uploadError.message)
        continue
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('patient-documents')
        .getPublicUrl(fileName)

      // Create lab report entry
      const reportPayload: Record<string, any> = {
        report_date: new Date().toISOString().slice(0, 10),
        lab_name: extractLabName(from, subject),
        entries: [],
        notes: [
          '🔄 Auto-imported from email',
          `From: ${from}`,
          `Subject: ${subject}`,
          `File: ${attachment.name}`,
          `Imported: ${new Date().toLocaleString('en-IN')}`,
          '',
          'Status: Pending AI parsing — values will be extracted automatically.',
        ].join('\n'),
      }

      if (patientMatch) {
        reportPayload.patient_id = patientMatch.id
      }

      const { error: insertError } = await supabase
        .from('lab_reports')
        .insert(reportPayload)

      if (insertError) {
        console.error(`[Lab Import] Insert error:`, insertError.message)
      } else {
        imported++
        console.log(`[Lab Import] ✅ Imported: ${attachment.name} → Patient: ${patientMatch?.full_name || 'UNMATCHED'}`)
      }
    }

    // Audit log
    await supabase.from('audit_log').insert({
      action: 'create',
      entity: 'lab_report',
      entity_id: null,
      description: `Auto-imported ${imported} lab report(s) from email. From: ${from}. Patient: ${patientMatch?.full_name || 'Unmatched'}`,
    }).then(() => {}).catch(() => {}) // Non-fatal

    return NextResponse.json({
      status: 'ok',
      imported,
      patient_matched: patientMatch ? patientMatch.full_name : null,
      total_attachments: attachmentCount,
    })
  } catch (err: any) {
    console.error('[Lab Import] Fatal error:', err.message, err.stack)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Allow GET for webhook verification (Mailgun sometimes sends GET to verify URL)
export async function GET() {
  return NextResponse.json({ status: 'ok', endpoint: 'lab-report-ingest', version: '2.0' })
}
