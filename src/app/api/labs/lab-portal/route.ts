/**
 * src/app/api/labs/lab-portal/route.ts — NEW (Issue #22)
 *
 * Lab Partner Upload Portal API
 *
 * Endpoints:
 *   GET  /api/labs/lab-portal?token=XXX              — verify token, get partner info
 *   POST /api/labs/lab-portal                        — upload lab report (multipart/form-data)
 *
 * Lab partners get a unique token from Settings → Lab Partners.
 * They go to /lab-portal and upload reports directly — no email needed.
 *
 * POST body (multipart/form-data):
 *   token:       lab portal auth token
 *   mrn:         patient MRN (e.g. P-042)
 *   patient_name: fallback if MRN not found (optional)
 *   report_name: name of the test (e.g. "CBC Report")
 *   report_date: YYYY-MM-DD
 *   notes:       any notes from the lab
 *   pdf_file:    the PDF attachment
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

// ── GET: Verify token ─────────────────────────────────────────
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'No token provided' }, { status: 400 })

  const { data: user, error } = await supabase
    .from('lab_portal_users')
    .select('id, name, email, lab_partner_id, is_active, lab_partners(name)')
    .eq('auth_token', token)
    .maybeSingle()

  if (error || !user) return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
  if (!user.is_active) return NextResponse.json({ error: 'This portal account has been deactivated' }, { status: 403 })

  // Update last_used_at
  await supabase.from('lab_portal_users').update({ last_used_at: new Date().toISOString() }).eq('auth_token', token)

  return NextResponse.json({
    success: true,
    user: {
      name: user.name,
      email: user.email,
      lab_name: (user.lab_partners as any)?.name || 'Partner Lab',
    }
  })
}

// ── POST: Upload report ───────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const token       = formData.get('token')?.toString() || ''
    const mrn         = formData.get('mrn')?.toString() || ''
    const patientName = formData.get('patient_name')?.toString() || ''
    const reportName  = formData.get('report_name')?.toString() || 'Lab Report'
    const reportDate  = formData.get('report_date')?.toString() || new Date().toISOString().split('T')[0]
    const notes       = formData.get('notes')?.toString() || ''
    const pdfFile     = formData.get('pdf_file') as File | null

    // Verify token
    if (!token) return NextResponse.json({ error: 'No token provided' }, { status: 401 })
    const { data: portalUser, error: authErr } = await supabase
      .from('lab_portal_users')
      .select('id, name, lab_partner_id, is_active, lab_partners(name)')
      .eq('auth_token', token)
      .maybeSingle()

    if (authErr || !portalUser || !portalUser.is_active) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
    }

    const labName = (portalUser.lab_partners as any)?.name || 'Partner Lab'

    // ── Step 1: Find patient ──────────────────────────────────
    let patientId = ''
    let resolvedName = patientName

    if (mrn) {
      // Try exact MRN match first
      const mrnUpper = mrn.trim().toUpperCase()
      const { data: patient } = await supabase
        .from('patients')
        .select('id, full_name')
        .or(`mrn.eq.${mrnUpper},mrn.ilike.${mrnUpper}`)
        .maybeSingle()

      if (patient) { patientId = patient.id; resolvedName = patient.full_name }
    }

    if (!patientId && patientName) {
      const { data: patients } = await supabase
        .from('patients')
        .select('id, full_name')
        .ilike('full_name', `%${patientName.trim()}%`)
        .limit(1)

      if (patients && patients.length > 0) {
        patientId = patients[0].id
        resolvedName = patients[0].full_name
      }
    }

    if (!patientId) {
      return NextResponse.json({
        success: false,
        error: 'Patient not found. Please check the MRN or patient name.',
        hint: `MRN tried: "${mrn}" | Name tried: "${patientName}"`,
      }, { status: 400 })
    }

    // ── Step 2: Upload PDF to storage ─────────────────────────
    let attachmentUrl: string | null = null
    if (pdfFile && pdfFile.size > 0) {
      try {
        const buffer   = await pdfFile.arrayBuffer()
        const fileName = `lab-reports/${Date.now()}_${pdfFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
        const { data: uploadData, error: uploadErr } = await supabase.storage
          .from('consultation-files')
          .upload(fileName, Buffer.from(buffer), { contentType: 'application/pdf', upsert: false })

        if (!uploadErr && uploadData) {
          const { data: urlData } = supabase.storage.from('consultation-files').getPublicUrl(fileName)
          attachmentUrl = urlData?.publicUrl || null
        }
      } catch (e) {
        console.warn('[lab-portal] Storage upload failed, saving without attachment')
      }
    }

    // ── Step 3: Create lab report record ─────────────────────
    const { data: report, error: insertErr } = await supabase
      .from('lab_reports')
      .insert({
        patient_id:       patientId,
        report_name:      reportName,
        report_date:      reportDate,
        lab_name:         labName,
        status:           'completed',
        notes:            notes || `Uploaded via portal by ${portalUser.name}`,
        attachment_url:   attachmentUrl,
        source:           'portal',
        lab_partner_id:   portalUser.lab_partner_id,
        lab_partner_name: labName,
        portal_upload:    true,
        portal_patient_mrn: mrn,
      })
      .select('id')
      .single()

    if (insertErr) {
      return NextResponse.json({ success: false, error: `Failed to save report: ${insertErr.message}` }, { status: 500 })
    }

    // ── Step 4: Update portal user last_used_at ───────────────
    await supabase.from('lab_portal_users').update({ last_used_at: new Date().toISOString() }).eq('auth_token', token)

    return NextResponse.json({
      success: true,
      reportId:    report.id,
      patientId,
      patientName: resolvedName,
      reportName,
      message: `Report uploaded successfully for ${resolvedName}`,
    })

  } catch (err: any) {
    console.error('[lab-portal] Error:', err)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}