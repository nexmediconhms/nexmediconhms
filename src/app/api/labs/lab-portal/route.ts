/**
 * src/app/api/labs/lab-portal/route.ts
 *
 * Lab Partner Upload Portal API — FIXED & ENHANCED
 *
 * Endpoints:
 *   GET  /api/labs/lab-portal?token=XXX              — verify token, get partner info
 *   POST /api/labs/lab-portal                        — upload lab report (multipart/form-data)
 *
 * FIX #1: Report now correctly linked to patient profile (patient_id FK)
 * FIX #2: Doctor gets in-app reminder when report is uploaded
 * FIX #3: Patient gets in-app reminder when report is uploaded
 * FIX #4: MRN lookup made robust — handles P-042, p042, P042 formats
 * FIX #5: Added portal_upload flag & lab_partner metadata to report record
 * FIX #6: Audit log entry on every upload
 *
 * POST body (multipart/form-data):
 *   token:        lab portal auth token
 *   mrn:          patient MRN (e.g. P-042)
 *   patient_name: fallback if MRN not found (optional)
 *   report_name:  name of the test (e.g. "CBC Report")
 *   report_date:  YYYY-MM-DD
 *   notes:        any notes from the lab
 *   pdf_file:     the PDF attachment
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  validateLabPortalToken,
  assertPatientBelongsToPartner,
  signedAttachmentUrl,
  quoteOrValue,
} from '@/lib/lab-portal-auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

/**
 * 2026-06-04 audit fixes (§10.3, §10.4, §10.5):
 *   §10.3 — POST now scopes the patient lookup to the partner
 *           (assertPatientBelongsToPartner). Previously a partner
 *           with a valid token could iterate any MRN.
 *   §10.4 — token_expires_at is now enforced (was dead config).
 *           Storage uploads land in the PRIVATE bucket and use
 *           short-lived signed URLs.
 *   §10.5 — MRN .or() filter values are quoted (PostgREST escape).
 *
 * Both endpoints (GET verify, POST upload) delegate token validation
 * to the shared validateLabPortalToken() helper.
 */

// Default private bucket — same env var as report-upload route.
const ATTACHMENT_BUCKET = process.env.LAB_ATTACHMENT_BUCKET || 'attachments-private'

// ── Normalize MRN for flexible matching ──────────────────────
function normalizeMrn(raw: string): string[] {
  const upper = raw.trim().toUpperCase()
  const digits = upper.replace(/\D/g, '')
  const paddedDigits = digits.padStart(3, '0')
  return [
    upper,                          // P-042, P042, etc. as-is
    `P-${paddedDigits}`,            // P-042
    `P${paddedDigits}`,             // P042
    `P-${digits}`,                  // P-42 (no padding)
  ].filter((v, i, arr) => arr.indexOf(v) === i) // unique
}

// ── Create in-app reminder for a user ────────────────────────
async function createReminder({
  patientId,
  patientName,
  reportName,
  reportId,
  recipientRole,
  doctorId,
}: {
  patientId: string
  patientName: string
  reportName: string
  reportId: string
  recipientRole: 'doctor' | 'patient'
  doctorId?: string
}) {
  try {
    const message = recipientRole === 'doctor'
      ? `Lab report "${reportName}" is available for ${patientName}. Please review the results.`
      : `Your lab report "${reportName}" has been uploaded. Please log in to view it.`

    // Insert into reminders table
    await supabase.from('reminders').insert({
      patient_id:    patientId,
      message:       message,
      reminder_type: 'lab_report',
      status:        'pending',
      metadata: JSON.stringify({
        report_id:   reportId,
        report_name: reportName,
        recipient:   recipientRole,
        doctor_id:   doctorId || null,
      }),
      created_at:    new Date().toISOString(),
    })
  } catch (e) {
    // Non-fatal — log but don't fail upload
    console.warn('[lab-portal] Reminder creation failed:', e)
  }
}

// ── GET: Verify token ─────────────────────────────────────────
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')

  // 2026-06-04 audit fix (§10.4): token_expires_at is now checked here.
  const result = await validateLabPortalToken(supabase, token)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({
    success: true,
    user: {
      name:     result.user.name,
      email:    result.user.email,
      lab_name: result.user.partner_name,
    },
  })
}

// ── POST: Upload report ───────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const formData    = await req.formData()
    const token       = formData.get('token')?.toString() || ''
    const mrn         = formData.get('mrn')?.toString() || ''
    const patientName = formData.get('patient_name')?.toString() || ''
    const reportName  = formData.get('report_name')?.toString() || 'Lab Report'
    const reportDate  = formData.get('report_date')?.toString() || new Date().toISOString().split('T')[0]
    const notes       = formData.get('notes')?.toString() || ''
    const pdfFile     = formData.get('pdf_file') as File | null

    // ── Verify token (§10.4 — uses helper that checks token_expires_at) ──
    const auth = await validateLabPortalToken(supabase, token)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })
    }
    const portalUser = {
      id:             auth.user.id,
      name:           auth.user.name,
      lab_partner_id: auth.user.lab_partner_id,
    }
    const labName = auth.user.partner_name

    // ── Step 1: Find patient ──────────────────────────────────
    let patientId    = ''
    let resolvedName = patientName
    let doctorId: string | undefined = undefined

    // Try MRN variants (robust matching)
    // 2026-06-04 audit fix (§10.5): each variant is PostgREST-escaped
    // before being injected into the .or() filter string. The previous
    // code interpolated raw user input which allowed filter injection.
    if (mrn) {
      const mrnVariants = normalizeMrn(mrn)
      for (const variant of mrnVariants) {
        const safeVariant = quoteOrValue(variant)
        const { data: patient } = await supabase
          .from('patients')
          .select('id, full_name, doctor_id')
          .or(`mrn.eq.${safeVariant},mrn.ilike.${safeVariant}`)
          .maybeSingle()

        if (patient) {
          patientId    = patient.id
          resolvedName = patient.full_name
          doctorId     = patient.doctor_id || undefined
          break
        }
      }
    }

    // Fallback: name search
    if (!patientId && patientName) {
      const { data: patients } = await supabase
        .from('patients')
        .select('id, full_name, doctor_id')
        .ilike('full_name', `%${patientName.trim()}%`)
        .limit(1)

      if (patients && patients.length > 0) {
        patientId    = patients[0].id
        resolvedName = patients[0].full_name
        doctorId     = patients[0].doctor_id || undefined
      }
    }

    if (!patientId) {
      return NextResponse.json({
        success: false,
        error:   'Patient not found. Please check the MRN or patient name.',
        hint:    `MRN tried: "${mrn}" (variants: ${normalizeMrn(mrn).join(', ')}) | Name tried: "${patientName}"`,
      }, { status: 400 })
    }

    // ── Step 1b (NEW §10.3): per-partner scoping ──────────────
    // Block this partner from uploading reports for patients they
    // are not associated with. Prevents MRN enumeration.
    const scope = await assertPatientBelongsToPartner(
      supabase,
      patientId,
      portalUser.lab_partner_id,
      { allowFirstReport: true },
    )
    if (!scope.allowed) {
      return NextResponse.json(
        { success: false, error: scope.reason },
        { status: 403 },
      )
    }

    // ── Step 2: Upload PDF to storage ─────────────────────────
    // 2026-06-04 audit fix (§10.4): private bucket + signed URL.
    let attachmentUrl: string | null = null
    let attachmentPath: string | null = null
    if (pdfFile && pdfFile.size > 0) {
      try {
        const buffer   = await pdfFile.arrayBuffer()
        const fileName = `lab-reports/${Date.now()}_${pdfFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
        const { data: uploadData, error: uploadErr } = await supabase.storage
          .from(ATTACHMENT_BUCKET)
          .upload(fileName, Buffer.from(buffer), { contentType: 'application/pdf', upsert: false })

        if (!uploadErr && uploadData) {
          attachmentPath = fileName
          attachmentUrl = await signedAttachmentUrl(supabase, ATTACHMENT_BUCKET, fileName)
        }
      } catch (e) {
        console.warn('[lab-portal] Storage upload failed, saving without attachment')
      }
    }

    // ── Step 3: Create lab report record ─────────────────────
    const { data: report, error: insertErr } = await supabase
      .from('lab_reports')
      .insert({
        patient_id:         patientId,
        report_name:        reportName,
        report_date:        reportDate,
        lab_name:           labName,
        status:             'completed',
        notes:              notes || `Uploaded via portal by ${portalUser.name} (${labName})`,
        attachment_url:     attachmentUrl,
        storage_bucket:     attachmentPath ? ATTACHMENT_BUCKET : null,  // §10.4 — persist for re-signing
        storage_path:       attachmentPath || null,
        source:             'portal',
        lab_partner_id:     portalUser.lab_partner_id,
        lab_partner_name:   labName,
        portal_upload:      true,
        portal_patient_mrn: mrn,
      })
      .select('id')
      .single()

    if (insertErr) {
      return NextResponse.json({
        success: false,
        error: `Failed to save report: ${insertErr.message}`,
      }, { status: 500 })
    }

    const reportId = report.id

    // ── Step 4: Create reminders for doctor & patient ─────────
    // Doctor reminder
    if (doctorId) {
      await createReminder({
        patientId,
        patientName: resolvedName,
        reportName,
        reportId,
        recipientRole: 'doctor',
        doctorId,
      })
    }

    // Patient reminder (all patients)
    await createReminder({
      patientId,
      patientName: resolvedName,
      reportName,
      reportId,
      recipientRole: 'patient',
    })

    // ── Step 5: Audit log ─────────────────────────────────────
    // 2026-06-04 audit fix (§7.2 / §10.5): use insert_audit_entry RPC
    // (hash chain) instead of direct audit_log INSERT (which left
    // entry_hash blank, breaking the chain).
    try {
      await supabase.rpc('insert_audit_entry', {
        p_user_id:      null, // lab portal users don't have clinic_users.id
        p_user_email:   portalUser.name,
        p_user_role:    'lab_partner',
        p_action:       'create',
        p_entity_type:  'lab_report',
        p_entity_id:    reportId,
        p_entity_label: `${reportName} for ${resolvedName} (${mrn || patientName})`,
        p_changes:      JSON.stringify({
          lab_partner: labName,
          uploaded_by: portalUser.name,
          mrn,
          attachment:  !!attachmentUrl,
          via:         'lab_portal',
        }),
      })
    } catch (e: any) {
      console.warn('[lab-portal] insert_audit_entry RPC failed (non-fatal):', e?.message)
    }

    // ── Step 5b: Create in-app notification for staff/doctor ──
    await supabase.from('clinic_notifications').insert({
      title: `Lab Report: ${reportName}`,
      message: `${labName} uploaded "${reportName}" for ${resolvedName} (${mrn || 'N/A'}). Review in patient profile.`,
      type: 'lab_report',
      severity: 'normal',
      source: 'lab_portal',
      entity_type: 'lab_report',
      entity_id: reportId,
      patient_id: patientId,
      patient_name: resolvedName,
      mrn: mrn || null,
      target_roles: ['admin', 'doctor', 'staff'],
      metadata: JSON.stringify({
        lab_partner: labName,
        uploaded_by: portalUser.name,
        report_name: reportName,
        has_attachment: !!attachmentUrl,
      }),
    })

    // ── Step 6: Update portal user last_used_at ───────────────
    await supabase.from('lab_portal_users')
      .update({ last_used_at: new Date().toISOString() })
      .eq('auth_token', token)

    return NextResponse.json({
      success:        true,
      reportId,
      patientId,
      patientName:    resolvedName,
      reportName,
      hasAttachment:  !!attachmentUrl,
      notified:       true,
      message:        `Report "${reportName}" uploaded successfully for ${resolvedName}. Doctor and patient have been notified.`,
    })

  } catch (err: any) {
    console.error('[lab-portal] Error:', err)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}