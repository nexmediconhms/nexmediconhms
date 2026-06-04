/**
 * src/app/api/labs/report-upload/route.ts
 *
 * Lab Report Upload with Auto-Binding & Finance Trigger
 *
 * When a lab partner uploads a report:
 *   1. Auto-binds to the patient profile document store
 *   2. Updates the centralized Lab Results dashboard state
 *   3. Triggers an auto-calculated financial line item in Billing/Finance
 *      (accounting for the partner's test-specific commission percentage)
 *   4. Creates audit trail entry
 *   5. Notifies doctor and patient
 *
 * ENDPOINT:
 *   POST /api/labs/report-upload (multipart/form-data)
 *
 * FORM FIELDS:
 *   partner_id:    Lab partner UUID
 *   patient_id:    Patient UUID (or mrn for lookup)
 *   mrn:           Patient MRN (alternative to patient_id)
 *   report_name:   Name of the test/report
 *   report_date:   YYYY-MM-DD
 *   test_results:  JSON array of test entries (optional)
 *   notes:         Free-text notes
 *   total_amount:  Total charge for this test (optional — will use base_price from config)
 *   pdf_file:      The PDF report file
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { resolvePortalOrigin, generatePortalMagicLink, buildWhatsAppLink } from '@/lib/portal-magic-link'
import { requireAuth } from '@/lib/api-auth'
import {
  validateLabPortalToken,
  assertPatientBelongsToPartner,
  signedAttachmentUrl,
} from '@/lib/lab-portal-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 2026-06-04 audit fix (§10.1, §10.3, §10.4, §10.5):
 *   §10.1 — auth is now MANDATORY. Two acceptable paths:
 *           A) Lab partner calling from the partner portal: include
 *              their lab_portal_users token as form field `token`.
 *           B) A logged-in clinic user (admin/doctor/staff) recording
 *              an in-house lab report: send a Bearer Authorization
 *              header (the standard /api auth flow).
 *           Previously this route trusted ANY caller and used the
 *           service-role client to write reports for ANY patient.
 *   §10.3 — when called via partner token, the patient_id resolved
 *           from the supplied mrn / patient_id MUST belong to that
 *           partner (per `assertPatientBelongsToPartner`). Otherwise
 *           a partner could enumerate every clinic patient by trying
 *           sequential MRNs.
 *   §10.4 — attachment URLs are now SHORT-LIVED SIGNED URLs from a
 *           PRIVATE bucket. The previous `getPublicUrl` call leaked
 *           PHI documents to anyone who knew the path.
 *   §10.5 — finance entry submitted_by is derived from the validated
 *           identity, not from request input.
 */

// Default private bucket (override with LAB_ATTACHMENT_BUCKET env if needed)
const ATTACHMENT_BUCKET = process.env.LAB_ATTACHMENT_BUCKET || 'attachments-private'

// ── POST: Upload lab report with auto-binding ────────────────────
export async function POST(req: NextRequest) {
  let sb: ReturnType<typeof getSupabaseAdmin>
  try {
    sb = getSupabaseAdmin()
  } catch {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  try {
    const formData = await req.formData()

    const partnerId = formData.get('partner_id') as string || ''
    const patientIdDirect = formData.get('patient_id') as string || ''
    const mrn = formData.get('mrn') as string || ''
    const reportName = formData.get('report_name') as string || ''
    const reportDate = formData.get('report_date') as string || new Date().toISOString().split('T')[0]
    const testResultsStr = formData.get('test_results') as string || '[]'
    const notes = formData.get('notes') as string || ''
    const totalAmountStr = formData.get('total_amount') as string || ''
    const pdfFile = formData.get('pdf_file') as File | null
    const portalToken = formData.get('token') as string || ''

    // ──────────────────────────────────────────────────────────────
    // 2026-06-04 audit fix (§10.1): require either a portal token OR
    // a logged-in clinic user. No more anonymous uploads.
    // ──────────────────────────────────────────────────────────────
    let viaPartnerToken: { lab_partner_id: string; partner_name: string; user_name: string; user_email: string | null } | null = null
    let viaClinicUser: { email: string; role: string; clinicUserId: string; fullName: string } | null = null

    if (portalToken && portalToken.trim().length > 0) {
      // Partner portal flow
      const tok = await validateLabPortalToken(sb, portalToken)
      if (!tok.ok) {
        return NextResponse.json({ error: tok.error, code: tok.code }, { status: tok.status })
      }
      viaPartnerToken = {
        lab_partner_id: tok.user.lab_partner_id,
        partner_name:   tok.user.partner_name,
        user_name:      tok.user.name,
        user_email:     tok.user.email,
      }
    } else {
      // Clinic-user flow (in-house lab entry from staff)
      const auth = await requireAuth(req)
      if (auth instanceof Response) return auth
      viaClinicUser = {
        email:        auth.email,
        role:         auth.role,
        clinicUserId: auth.clinicUserId,
        fullName:     auth.fullName,
      }
    }

    // ── Validate required fields ─────────────────────────────────
    if (!reportName.trim()) {
      return NextResponse.json({ error: 'report_name is required' }, { status: 400 })
    }
    if (!patientIdDirect && !mrn) {
      return NextResponse.json({ error: 'patient_id or mrn is required' }, { status: 400 })
    }

    // §10.5: when authenticating via portal token, force partner_id to the
    // token-bound partner — the request body's `partner_id` is ignored to
    // prevent a partner from impersonating another partner.
    let effectivePartnerId = partnerId
    if (viaPartnerToken) {
      effectivePartnerId = viaPartnerToken.lab_partner_id
    }

    // ── Resolve patient ID from MRN if needed ────────────────────
    let patientId = patientIdDirect
    let patientName = ''
    let patientMrn = mrn

    if (!patientId && mrn) {
      // Normalize MRN for flexible matching
      const normalizedMrns = normalizeMrn(mrn)
      let found = false
      for (const candidate of normalizedMrns) {
        const { data: patient } = await sb
          .from('patients')
          .select('id, full_name, mrn')
          .ilike('mrn', candidate)
          .limit(1)
          .maybeSingle()

        if (patient) {
          patientId = patient.id
          patientName = patient.full_name
          patientMrn = patient.mrn
          found = true
          break
        }
      }
      if (!found) {
        return NextResponse.json({
          error: `Patient not found with MRN: ${mrn}`,
          tried_formats: normalizedMrns,
        }, { status: 404 })
      }
    } else if (patientId) {
      const { data: patient } = await sb
        .from('patients')
        .select('id, full_name, mrn')
        .eq('id', patientId)
        .single()

      if (!patient) {
        return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
      }
      patientName = patient.full_name
      patientMrn = patient.mrn
    }

    // ──────────────────────────────────────────────────────────────
    // 2026-06-04 audit fix (§10.3): per-partner scoping for portal flow.
    // A partner with a valid token can only upload reports for patients
    // they're already associated with (via patients.lab_partner_id, prior
    // lab_reports, or first-contact). This blocks MRN enumeration.
    // ──────────────────────────────────────────────────────────────
    if (viaPartnerToken) {
      const scope = await assertPatientBelongsToPartner(
        sb,
        patientId,
        viaPartnerToken.lab_partner_id,
        { allowFirstReport: true },
      )
      if (!scope.allowed) {
        return NextResponse.json(
          { error: scope.reason },
          { status: 403 },
        )
      }
    }

    // ── Parse test results ───────────────────────────────────────
    let testResults: any[] = []
    try {
      testResults = JSON.parse(testResultsStr)
      if (!Array.isArray(testResults)) testResults = []
    } catch {
      testResults = []
    }

    // ── Get lab partner info for commission calculation ───────────
    let partner: any = null
    let hospitalPct = 30
    let labPct = 70
    let basePrice = 0

    if (effectivePartnerId) {
      const { data: p } = await sb
        .from('lab_partners')
        .select('*')
        .eq('id', effectivePartnerId)
        .single()

      if (p) {
        partner = p
        hospitalPct = Number(p.default_hospital_pct || p.hospital_share || 30)
        labPct = Number(p.default_lab_pct || p.lab_share || 70)

        // Check for test-specific commission
        const testCommissions = parseTestCommissions(p.test_commissions)
        const testConfig = testCommissions.find(
          (tc: any) => tc.test_name.toLowerCase() === reportName.trim().toLowerCase()
        )
        if (testConfig) {
          hospitalPct = Number(testConfig.hospital_pct) || hospitalPct
          labPct = Number(testConfig.lab_pct) || labPct
          basePrice = Number(testConfig.base_price) || 0
        }
      }
    }

    // Calculate financial amounts
    const totalAmount = Number(totalAmountStr) || basePrice || 0
    const hospitalAmount = Math.round(totalAmount * hospitalPct / 100 * 100) / 100
    const labAmount = Math.round(totalAmount * labPct / 100 * 100) / 100

    // ── Upload PDF to Supabase Storage ───────────────────────────
    // 2026-06-04 audit fix (§10.4): write to a PRIVATE bucket and
    // return a SHORT-LIVED SIGNED URL. The previous getPublicUrl call
    // exposed PHI documents to anyone who knew (or guessed) the path.
    let attachmentUrl: string | null = null
    let storagePath: string | null = null
    if (pdfFile && pdfFile.size > 0) {
      const fileExt = pdfFile.name.split('.').pop() || 'pdf'
      const filePath = `lab-reports/${patientId}/${Date.now()}_${reportName.replace(/[^a-zA-Z0-9]/g, '_')}.${fileExt}`

      const fileBuffer = Buffer.from(await pdfFile.arrayBuffer())

      const { data: uploadData, error: uploadErr } = await sb.storage
        .from(ATTACHMENT_BUCKET)
        .upload(filePath, fileBuffer, {
          contentType: pdfFile.type || 'application/pdf',
          upsert: false,
        })

      if (uploadErr) {
        console.error('[report-upload] Storage upload error:', uploadErr)
        // Non-fatal — continue without attachment
      } else {
        storagePath = filePath
        attachmentUrl = await signedAttachmentUrl(sb, ATTACHMENT_BUCKET, filePath)
      }
    }

    // ── §1: Insert lab report (binds to patient profile) ─────────
    const reportPayload: Record<string, any> = {
      patient_id: patientId,
      report_name: reportName.trim(),
      report_date: reportDate,
      lab_name: partner?.name || (viaPartnerToken?.partner_name) || 'External Lab',
      entries: testResults,
      notes: notes.trim() || null,
      status: 'completed',
      attachment_url: attachmentUrl,
      storage_bucket: storagePath ? ATTACHMENT_BUCKET : null,  // §10.4: persist for re-signing
      storage_path:   storagePath || null,
      lab_partner_id: effectivePartnerId || null,
      total_amount: totalAmount || null,
      hospital_amount: hospitalAmount || null,
      lab_amount: labAmount || null,
      payment_mode: 'pending',
      portal_upload: !!viaPartnerToken,
      created_at: new Date().toISOString(),
    }

    const { data: newReport, error: reportErr } = await sb
      .from('lab_reports')
      .insert(reportPayload)
      .select('id')
      .single()

    if (reportErr) {
      console.error('[report-upload] Report insert error:', reportErr)
      return NextResponse.json({ error: reportErr.message }, { status: 500 })
    }

    // ── §2: Also create an attachment record (patient document store) ─
    if (attachmentUrl) {
      await sb.from('attachments').insert({
        patient_id: patientId,
        type: 'lab_report',
        name: `Lab: ${reportName}`,
        url: attachmentUrl,
        storage_bucket: ATTACHMENT_BUCKET,    // §10.4: persist for re-signing
        storage_path:   storagePath,
        uploaded_by: viaPartnerToken?.user_name || viaClinicUser?.fullName || 'Unknown',
        metadata: JSON.stringify({
          report_id: newReport.id,
          lab_partner_id: effectivePartnerId,
          report_date: reportDate,
        }),
      }).then(() => {})
    }

    // ── §3: Trigger financial line item in Billing/Finance ────────
    if (totalAmount > 0) {
      // Create a finance entry for the lab revenue (hospital's share)
      // §10.5: submitted_by from validated identity, not user input
      await sb.from('hospital_fund').insert({
        type: 'income',
        amount: hospitalAmount,
        category: 'lab_revenue',
        description: `Lab: ${reportName} — ${patientName} (${patientMrn}) | Partner: ${partner?.name || 'External'} | Hospital ${hospitalPct}%`,
        submitted_by: viaPartnerToken?.partner_name || viaClinicUser?.email || 'Lab Portal',
        status: 'approved',
      }).then(() => {})
    }

    // ── §4: Audit log entry ──────────────────────────────────────
    // §10.5: identity comes from validated source, not request body.
    await sb.rpc('insert_audit_entry', {
      p_user_id:      viaClinicUser?.clinicUserId || null,
      p_user_email:   viaPartnerToken?.user_email || viaClinicUser?.email || 'lab-portal',
      p_user_role:    viaPartnerToken ? 'lab_partner' : (viaClinicUser?.role || 'staff'),
      p_action:       'create',
      p_entity_type:  'lab_report',
      p_entity_id:    newReport.id,
      p_entity_label: `Lab report "${reportName}" for ${patientName}`,
      p_changes:      JSON.stringify({
        after: {
          patient_id: patientId,
          report_name: reportName,
          partner: partner?.name,
          amount: totalAmount,
          hospital_share: hospitalAmount,
          lab_share: labAmount,
          via: viaPartnerToken ? 'partner_token' : 'clinic_user',
        },
      }),
    }) // Non-fatal

    // ── §5: Notify doctor and patient ────────────────────────────
    // ENHANCEMENT: generate a one-tap portal magic link so the patient
    // can open the report online with the latest data. Also fetch the
    // patient's mobile to queue a "report ready" WhatsApp notification.
    let portalUrl = ''
    let patientMobile = ''
    try {
      const { data: pat } = await sb
        .from('patients')
        .select('mobile')
        .eq('id', patientId)
        .single()
      patientMobile = pat?.mobile || ''

      const origin = resolvePortalOrigin(req)
      const magic = await generatePortalMagicLink(
        sb,
        origin,
        { id: patientId, mrn: patientMrn, mobile: patientMobile },
        { validHours: 24 }
      )
      if (magic) portalUrl = magic.portalUrl
    } catch (e: any) {
      console.warn('[report-upload] portal link generation failed (non-fatal):', e?.message)
    }

    // Doctor notification
    await sb.from('reminders').insert({
      patient_id: patientId,
      patient_name: patientName,
      type: 'lab_report',
      message: `Lab report "${reportName}" is available for ${patientName} (${patientMrn}). Please review.`,
      status: 'pending',
      metadata: JSON.stringify({
        report_id: newReport.id,
        report_name: reportName,
        lab_partner: partner?.name,
        recipient: 'doctor',
      }),
    })

    // Patient notification (now includes the one-tap portal link)
    await sb.from('reminders').insert({
      patient_id: patientId,
      patient_name: patientName,
      type: 'lab_report',
      message: `Your lab report "${reportName}" has been uploaded.${portalUrl ? ` View it online: ${portalUrl}` : ' Please check with your doctor.'}`,
      status: 'pending',
      metadata: JSON.stringify({
        report_id: newReport.id,
        report_name: reportName,
        recipient: 'patient',
        portal_url: portalUrl || null,
      }),
    })

    // Queue a "report ready" WhatsApp notification for staff to forward
    // (the deep-link is pre-filled with the portal login link).
    if (patientMobile) {
      const waMessage =
        `Namaste ${patientName.split(' ')[0]} ji,\n\n` +
        `Your lab report "${reportName}" is ready! 🧪\n\n` +
        (portalUrl ? `▶ View it online now:\n${portalUrl}\n\n` : '') +
        `You can view prescriptions, lab reports, bills and book a follow-up in your portal.`
      const waLink = buildWhatsAppLink(patientMobile, waMessage)
      await sb.from('whatsapp_notifications').insert({
        patient_id: patientId,
        patient_name: patientName,
        mobile: patientMobile,
        notification_type: 'report_ready',
        message_preview: waMessage.slice(0, 200),
        recipient_type: 'patient',
        status: 'queued',
        metadata: {
          report_id: newReport.id,
          report_name: reportName,
          portal_url: portalUrl || null,
          whatsapp_link: waLink,
        },
      }).then(() => {})
    }

    return NextResponse.json({
      success: true,
      report_id: newReport.id,
      patient_id: patientId,
      patient_name: patientName,
      mrn: patientMrn,
      invoice: {
        total_amount: totalAmount,
        hospital_amount: hospitalAmount,
        lab_amount: labAmount,
        hospital_pct: hospitalPct,
        lab_pct: labPct,
      },
      attachment_url: attachmentUrl,
      message: `Lab report "${reportName}" uploaded and linked to ${patientName}`,
    })
  } catch (err: any) {
    console.error('[report-upload] Unexpected error:', err)
    return NextResponse.json({ error: err.message || 'Upload failed' }, { status: 500 })
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function normalizeMrn(raw: string): string[] {
  const upper = raw.trim().toUpperCase()
  const digits = upper.replace(/\D/g, '')
  const paddedDigits = digits.padStart(3, '0')
  return [
    upper,
    `P-${paddedDigits}`,
    `P${paddedDigits}`,
    `P-${digits}`,
    digits,
  ].filter((v, i, arr) => arr.indexOf(v) === i)
}

function parseTestCommissions(raw: any): any[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) } catch { return [] }
  }
  return []
}