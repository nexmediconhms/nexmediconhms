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

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

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
  if (!token) return NextResponse.json({ error: 'No token provided' }, { status: 400 })

  const { data: user, error } = await supabase
    .from('lab_portal_users')
    .select('id, name, email, lab_partner_id, is_active, lab_partners(name)')
    .eq('auth_token', token)
    .maybeSingle()

  if (error || !user) return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
  if (!user.is_active) return NextResponse.json({ error: 'This portal account has been deactivated' }, { status: 403 })

  // Update last_used_at
  await supabase.from('lab_portal_users')
    .update({ last_used_at: new Date().toISOString() })
    .eq('auth_token', token)

  return NextResponse.json({
    success: true,
    user: {
      name:     user.name,
      email:    user.email,
      lab_name: (user.lab_partners as any)?.name || 'Partner Lab',
    }
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

    // ── Verify token ──────────────────────────────────────────
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
    let patientId    = ''
    let resolvedName = patientName
    let doctorId: string | undefined = undefined

    // Try MRN variants (robust matching)
    if (mrn) {
      const mrnVariants = normalizeMrn(mrn)
      for (const variant of mrnVariants) {
        const { data: patient } = await supabase
          .from('patients')
          .select('id, full_name, doctor_id')
          .or(`mrn.eq.${variant},mrn.ilike.${variant}`)
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
        patient_id:         patientId,
        report_name:        reportName,
        report_date:        reportDate,
        lab_name:           labName,
        status:             'completed',
        notes:              notes || `Uploaded via portal by ${portalUser.name} (${labName})`,
        attachment_url:     attachmentUrl,
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

    // ── Step 4: AI PDF Value Extraction ─────────────────────────
    let extractedValues: Record<string, string> = {}
    let abnormalValues: string[] = []

    if (pdfFile && pdfFile.size > 0) {
      try {
        // Use the extract-values logic inline (avoid internal fetch)
        const buffer = await pdfFile.arrayBuffer()
        const base64 = Buffer.from(buffer).toString('base64')

        // Try AI extraction
        const { analyzePDF, hasAnyAIKey } = await import('@/lib/ai-client')
        if (hasAnyAIKey()) {
          const result = await analyzePDF({
            base64,
            prompt: 'Extract all lab test values from this PDF report. List each test name and its numeric value with unit.',
          })
          if (result?.text) {
            // Parse extracted text for structured lab values
            const LAB_PATTERNS = [
              { name: 'Haemoglobin', pattern: /h[ae]moglobin[:\s]+(\d+\.?\d*)/i, unit: 'g/dL', low: 11.5, high: 16.5 },
              { name: 'WBC', pattern: /(?:WBC|TLC|Total\s*Count)[:\s]+(\d+[\.,]?\d*)/i, unit: 'cells/µL', low: 4000, high: 11000 },
              { name: 'Platelet', pattern: /Platelet[s]?[:\s]+(\d+[\.,]?\d*)/i, unit: 'cells/µL', low: 150000, high: 400000 },
              { name: 'Blood Sugar Fasting', pattern: /(?:Fasting|FBS)[:\s]*(?:Blood\s*)?(?:Sugar|Glucose)?[:\s]+(\d+\.?\d*)/i, unit: 'mg/dL', low: 70, high: 100 },
              { name: 'HbA1c', pattern: /HbA1c[:\s]+(\d+\.?\d*)/i, unit: '%', low: 0, high: 5.7 },
              { name: 'TSH', pattern: /TSH[:\s]+(\d+\.?\d*)/i, unit: 'mIU/L', low: 0.4, high: 4.0 },
              { name: 'Creatinine', pattern: /Creatinine[:\s]+(\d+\.?\d*)/i, unit: 'mg/dL', low: 0.6, high: 1.2 },
              { name: 'SGPT', pattern: /(?:SGPT|ALT)[:\s]+(\d+\.?\d*)/i, unit: 'U/L', low: 7, high: 56 },
              { name: 'SGOT', pattern: /(?:SGOT|AST)[:\s]+(\d+\.?\d*)/i, unit: 'U/L', low: 10, high: 40 },
              { name: 'Cholesterol', pattern: /(?:Total\s*)?Cholesterol[:\s]+(\d+\.?\d*)/i, unit: 'mg/dL', low: 0, high: 200 },
            ]

            for (const test of LAB_PATTERNS) {
              const match = result.text.match(test.pattern)
              if (match?.[1]) {
                const numVal = parseFloat(match[1].replace(/,/g, ''))
                if (!isNaN(numVal)) {
                  extractedValues[test.name] = `${numVal} ${test.unit}`
                  if (numVal < test.low || numVal > test.high) {
                    const status = numVal < test.low ? 'LOW' : 'HIGH'
                    abnormalValues.push(`${test.name}: ${numVal} ${test.unit} [${status}] (Normal: ${test.low}–${test.high})`)
                  }
                }
              }
            }
          }
        }
      } catch (e) {
        console.warn('[lab-portal] AI extraction failed (non-fatal):', e)
      }

      // Save extracted values to the report record
      if (Object.keys(extractedValues).length > 0) {
        await supabase.from('lab_reports').update({
          extracted_values: { values: extractedValues, abnormals: abnormalValues },
          updated_at: new Date().toISOString(),
        }).eq('id', reportId)
      }
    }

    // ── Step 4b: Create reminders for doctor & patient ────────
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
    await supabase.from('audit_log').insert({
      action:       'lab_report_portal_upload',
      entity_type:  'lab_report',
      entity_id:    reportId,
      entity_label: `${reportName} for ${resolvedName} (${mrn || patientName})`,
      changes:      JSON.stringify({
        lab_partner: labName,
        uploaded_by: portalUser.name,
        mrn,
        attachment:  !!attachmentUrl,
        extracted_values_count: Object.keys(extractedValues).length,
        abnormal_count: abnormalValues.length,
      }),
      user_id:    'lab_portal',
      user_email: portalUser.name,
      user_role:  'lab_partner',
    })

    // ── Step 5b: Create doctor alert for abnormal values ──────
    if (abnormalValues.length > 0 && patientId) {
      const severity = abnormalValues.some(v => v.includes('HIGH') && (v.includes('Creatinine') || v.includes('Sugar')))
        ? 'critical' : 'warning'

      await supabase.from('doctor_alerts').insert({
        patient_id: patientId,
        patient_name: resolvedName,
        mrn: resolvedMrn,
        alert_type: 'lab_abnormal',
        alert_data: {
          report_name: reportName,
          abnormal_values: abnormalValues,
          lab_partner: labName,
          report_type: 'lab_report',
          total_abnormal: abnormalValues.length,
          extracted_values: extractedValues,
        },
        severity,
        source: labName,
        is_read: false,
        created_at: new Date().toISOString(),
      })
    }

    // ── Step 5c: Create in-app notification for staff/doctor ──
    await supabase.from('clinic_notifications').insert({
      title: `Lab Report: ${reportName}`,
      message: `${labName} uploaded "${reportName}" for ${resolvedName} (${mrn || 'N/A'}).${abnormalValues.length > 0 ? ` ⚠️ ${abnormalValues.length} ABNORMAL value(s)!` : ''} Review in patient profile.`,
      type: 'lab_report',
      severity: abnormalValues.length > 0 ? 'warning' : 'normal',
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
        abnormal_count: abnormalValues.length,
        extracted_values: extractedValues,
      }),
    })

    // ── Step 5d: Trigger WhatsApp "Report Ready" notifications ──
    try {
      const { data: patientData } = await supabase
        .from('patients')
        .select('mobile')
        .eq('id', patientId)
        .single()

      const patientMobile = patientData?.mobile || ''

      // Log WhatsApp notifications for doctor, patient, staff
      const { data: settingsData } = await supabase
        .from('clinic_settings')
        .select('key, value')
        .in('key', ['doctorMobile', 'staffMobile'])

      const settingsMap: Record<string, string> = {}
      for (const s of settingsData || []) settingsMap[s.key] = s.value

      const recipients = [
        { type: 'patient', mobile: patientMobile },
        { type: 'doctor', mobile: settingsMap.doctorMobile || '' },
        { type: 'staff', mobile: settingsMap.staffMobile || '' },
      ].filter(r => r.mobile)

      for (const r of recipients) {
        await supabase.from('whatsapp_notifications').insert({
          patient_id: patientId,
          patient_name: resolvedName,
          mobile: r.mobile,
          notification_type: 'report_ready',
          message_preview: `Lab report "${reportName}" ready for ${resolvedName}. Lab: ${labName}${abnormalValues.length > 0 ? '. ABNORMAL values detected!' : ''}`,
          recipient_type: r.type,
          status: 'generated',
          metadata: { report_name: reportName, report_id: reportId, lab_partner: labName, has_abnormals: abnormalValues.length > 0 },
        })
      }
    } catch (e) {
      console.warn('[lab-portal] WhatsApp notification failed (non-fatal):', e)
    }

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
      extractedValues: extractedValues,
      abnormalValues:  abnormalValues,
      message:        `Report "${reportName}" uploaded successfully for ${resolvedName}. Doctor and patient have been notified.${abnormalValues.length > 0 ? ` ${abnormalValues.length} abnormal value(s) detected — doctor alerted.` : ''}`,
    })

  } catch (err: any) {
    console.error('[lab-portal] Error:', err)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}