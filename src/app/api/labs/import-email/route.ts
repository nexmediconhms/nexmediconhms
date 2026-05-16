/**
 * src/app/api/labs/import-email/route.ts
 *
 * Lab Report Auto-Import Webhook
 *
 * This endpoint receives incoming lab report data from:
 *   1. Email parsing service (SendGrid Inbound Parse / Mailgun Routes)
 *   2. Lab partner API integration (direct POST)
 *   3. Manual upload from staff via the Labs page
 *
 * Flow:
 *   Lab sends email with PDF → Email service forwards to this webhook →
 *   Parse patient info (MRN/name from subject) → Attach to patient →
 *   Notify doctor via Supabase Realtime
 *
 * POST /api/labs/import-email
 * Body (multipart/form-data from email parser OR JSON from lab API):
 *   - from: sender email
 *   - subject: email subject (contains patient MRN or name)
 *   - text: email body text
 *   - attachments: PDF files (base64 or multipart)
 *   - patientId: (optional) direct patient UUID
 *   - reportName: (optional) report name override
 *
 * Auth: API_SECRET header for email webhooks, or standard auth for staff
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

// Validate webhook secret (for email parser integrations)
function validateWebhookAuth(req: NextRequest): boolean {
  const secret = process.env.LAB_IMPORT_SECRET || process.env.CRON_SECRET
  if (!secret) return true // Allow in dev

  const authHeader = req.headers.get('x-webhook-secret') ||
    req.headers.get('authorization')?.replace('Bearer ', '') || ''
  return authHeader === secret
}

// Extract patient MRN or name from email subject
// Common patterns: "Report for P-042", "Lab Results - Priya Sharma (P-042)"
function extractPatientInfo(subject: string): { mrn?: string; name?: string } {
  // Try MRN pattern: P-001, P-042, etc.
  const mrnMatch = subject.match(/P-(\d{3,})/i)
  if (mrnMatch) return { mrn: `P-${mrnMatch[1]}` }

  // Try "for <name>" pattern
  const forMatch = subject.match(/(?:for|patient|report)\s*[-:]\s*(.+?)(?:\s*\(|$)/i)
  if (forMatch) return { name: forMatch[1].trim() }

  // Try just a name at the end
  const nameMatch = subject.match(/[-–]\s*(.+?)(?:\s*\(|$)/)
  if (nameMatch) return { name: nameMatch[1].trim() }

  return {}
}

// Extract report name from subject
function extractReportName(subject: string): string {
  // Common patterns: "CBC Report for...", "Blood Sugar - P-042"
  const patterns = [
    /^(.+?)\s+(?:report|result|test)/i,
    /^(?:report|result|test)\s*[-:]\s*(.+?)(?:\s+for|\s+patient|\s*[-–])/i,
  ]
  for (const pat of patterns) {
    const match = subject.match(pat)
    if (match) return match[1].trim()
  }
  return subject.slice(0, 100) // Fallback: use subject as report name
}

interface ImportResult {
  success: boolean
  reportId?: string
  patientId?: string
  patientName?: string
  reportName?: string
  error?: string
}

export async function POST(req: NextRequest) {
  // Validate auth
  if (!validateWebhookAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    let body: any

    // Handle both JSON and form-data
    const contentType = req.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      body = await req.json()
    } else if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      body = {
        from: formData.get('from')?.toString() || '',
        subject: formData.get('subject')?.toString() || '',
        text: formData.get('text')?.toString() || '',
        patientId: formData.get('patientId')?.toString() || '',
        reportName: formData.get('reportName')?.toString() || '',
        attachmentData: formData.get('attachment')?.toString() || '', // base64
        attachmentName: formData.get('attachmentName')?.toString() || 'report.pdf',
      }
    } else {
      body = await req.json().catch(() => ({}))
    }

    const {
      from = '',
      subject = '',
      text = '',
      patientId: directPatientId,
      reportName: directReportName,
      attachmentData,
      attachmentName = 'report.pdf',
      labPartnerName,
    } = body

    // ── Step 1: Identify the patient ──────────────────────────
    let patientId = directPatientId || ''
    let patientName = ''

    if (!patientId && subject) {
      const { mrn, name } = extractPatientInfo(subject)

      if (mrn) {
        const { data: patient } = await supabase
          .from('patients')
          .select('id, full_name')
          .eq('mrn', mrn)
          .maybeSingle()

        if (patient) {
          patientId = patient.id
          patientName = patient.full_name
        }
      }

      if (!patientId && name) {
        const { data: patients } = await supabase
          .from('patients')
          .select('id, full_name')
          .ilike('full_name', `%${name}%`)
          .limit(1)

        if (patients && patients.length > 0) {
          patientId = patients[0].id
          patientName = patients[0].full_name
        }
      }
    }

    if (!patientId) {
      return NextResponse.json({
        success: false,
        error: 'Could not identify patient. Include MRN (e.g., P-042) in subject line or provide patientId.',
        hint: 'Email subject should be like: "CBC Report for P-042" or "Lab Results - Patient Name (P-042)"',
      }, { status: 400 })
    }

    // ── Step 2: Determine report name ─────────────────────────
    const reportName = directReportName || extractReportName(subject) || 'Lab Report'

    // ── Step 3: Store attachment (if provided) ────────────────
    let attachmentUrl: string | null = null

    if (attachmentData) {
      // Try uploading to Supabase Storage
      try {
        const fileName = `lab-reports/${Date.now()}_${attachmentName.replace(/[^a-zA-Z0-9._-]/g, '_')}`
        const buffer = Buffer.from(attachmentData, 'base64')

        const { data: uploadData, error: uploadErr } = await supabase.storage
          .from('consultation-files')
          .upload(fileName, buffer, {
            contentType: 'application/pdf',
            upsert: false,
          })

        if (!uploadErr && uploadData) {
          const { data: urlData } = supabase.storage
            .from('consultation-files')
            .getPublicUrl(fileName)
          attachmentUrl = urlData?.publicUrl || null
        }
      } catch (e) {
        console.warn('[lab-import] Storage upload failed, saving without attachment URL')
      }
    }

    // ── Step 4: Create lab report record ──────────────────────
    const { data: report, error: insertErr } = await supabase
      .from('lab_reports')
      .insert({
        patient_id: patientId,
        report_name: reportName,
        report_date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
        status: 'completed',
        notes: text ? text.slice(0, 500) : `Imported from ${from || labPartnerName || 'lab partner'}`,
        attachment_url: attachmentUrl,
        source: 'auto_import',
        lab_partner_name: labPartnerName || from || null,
      })
      .select('id')
      .single()

    if (insertErr) {
      return NextResponse.json({
        success: false,
        error: `Failed to save report: ${insertErr.message}`,
      }, { status: 500 })
    }

    // ── Step 5: Log the import ────────────────────────────────
    await supabase.from('audit_log').insert({
      action: 'lab_report_imported',
      entity_type: 'lab_report',
      entity_id: report.id,
      entity_label: `${reportName} for ${patientName || patientId}`,
      changes: JSON.stringify({ from, subject, labPartnerName }),
      user_id: 'system',
      user_email: 'auto-import',
      user_role: 'system',
    }).catch(() => {}) // Non-fatal

    const result: ImportResult = {
      success: true,
      reportId: report.id,
      patientId,
      patientName,
      reportName,
    }

    return NextResponse.json(result)

  } catch (err: any) {
    console.error('[lab-import] Error:', err)
    return NextResponse.json({
      success: false,
      error: err.message || 'Internal error',
    }, { status: 500 })
  }
}
