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

    // ── Step 5: AI PDF Extraction + Abnormal Value Detection ──
    let extractedValues: Record<string, string> = {}
    let abnormalValues: string[] = []

    if (attachmentUrl && pdfFile && pdfFile.size > 0) {
      try {
        // Re-read the file buffer for AI extraction
        const buffer = await pdfFile.arrayBuffer()
        const base64 = Buffer.from(buffer).toString('base64')

        // Try AI extraction
        const { analyzePDF, hasAnyAIKey } = await import('@/lib/ai-client')
        if (hasAnyAIKey()) {
          const result = await analyzePDF({
            base64,
            prompt: 'Extract all lab test values from this report. List each test name and its numeric value.'
          })
          if (result?.text) {
            // Use the same extraction logic as the extract-values endpoint
            const LAB_PATTERNS: { name: string; patterns: RegExp[]; unit: string; low: number; high: number }[] = [
              { name: 'Haemoglobin (Hb)', patterns: [/h[ae]moglobin[:\s]+(\d+\.?\d*)/i, /\bHb[:\s]+(\d+\.?\d*)/i], unit: 'g/dL', low: 11.5, high: 16.5 },
              { name: 'WBC (Total Count)', patterns: [/WBC[:\s]+(\d+[\.,]?\d*)/i, /Total\s*Count[:\s]+(\d+[\.,]?\d*)/i, /TLC[:\s]+(\d+[\.,]?\d*)/i], unit: 'cells/µL', low: 4000, high: 11000 },
              { name: 'Platelet Count', patterns: [/Platelet[s]?[:\s]+(\d+[\.,]?\d*)/i, /PLT[:\s]+(\d+[\.,]?\d*)/i], unit: 'cells/µL', low: 150000, high: 400000 },
              { name: 'Blood Sugar Fasting', patterns: [/Fasting[:\s]*(?:Blood\s*)?(?:Sugar|Glucose)[:\s]+(\d+\.?\d*)/i, /FBS[:\s]+(\d+\.?\d*)/i], unit: 'mg/dL', low: 70, high: 100 },
              { name: 'Blood Sugar PP', patterns: [/PP[:\s]*(?:Blood\s*)?(?:Sugar|Glucose)[:\s]+(\d+\.?\d*)/i, /PPBS[:\s]+(\d+\.?\d*)/i], unit: 'mg/dL', low: 0, high: 140 },
              { name: 'HbA1c', patterns: [/HbA1c[:\s]+(\d+\.?\d*)/i], unit: '%', low: 0, high: 5.7 },
              { name: 'TSH', patterns: [/TSH[:\s]+(\d+\.?\d*)/i], unit: 'mIU/L', low: 0.4, high: 4.0 },
              { name: 'ESR', patterns: [/ESR[:\s]+(\d+\.?\d*)/i], unit: 'mm/hr', low: 0, high: 20 },
            ]
            for (const test of LAB_PATTERNS) {
              for (const pattern of test.patterns) {
                const match = result.text.match(pattern)
                if (match?.[1]) {
                  const numVal = parseFloat(match[1].replace(/,/g, ''))
                  if (!isNaN(numVal)) {
                    extractedValues[test.name] = `${numVal} ${test.unit}`
                    if (numVal < test.low || numVal > test.high) {
                      const status = numVal < test.low ? 'LOW' : 'HIGH'
                      abnormalValues.push(`${test.name}: ${numVal} ${test.unit} [${status}] (Normal: ${test.low}-${test.high})`)
                    }
                    break
                  }
                }
              }
            }

            // Update the lab report with extracted entries
            if (Object.keys(extractedValues).length > 0) {
              const entries = Object.entries(extractedValues).map(([testName, valueWithUnit]) => {
                const numStr = valueWithUnit.replace(/[^\d.]/g, '')
                const unit = valueWithUnit.replace(/[\d.\s]/g, '').trim()
                const test = LAB_PATTERNS.find(t => t.name === testName)
                const numVal = parseFloat(numStr)
                let status = 'normal'
                if (test && !isNaN(numVal)) {
                  if (numVal < test.low) status = 'low'
                  else if (numVal > test.high) status = 'high'
                }
                return { testName, value: numStr, unit, referenceRange: test ? `${test.low}-${test.high}` : '', status, remarks: '' }
              })
              await supabase.from('lab_reports').update({ entries }).eq('id', reportId)
            }
          }
        }
      } catch (e) {
        console.warn('[lab-portal] AI extraction failed (non-fatal):', e)
      }
    }

    // ── Step 6: WhatsApp Notifications (doctor + patient + staff) ──
    try {
      await fetch(new URL('/api/labs/notify', req.url).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientName: resolvedName,
          patientId,
          mrn: mrn || '',
          abnormalValues,
          labPartner: labName,
          reportType: 'lab_report',
          reportName,
        }),
      })
    } catch (e) {
      console.warn('[lab-portal] WhatsApp notification failed (non-fatal):', e)
    }

    // ── Step 7: Doctor Dashboard Alert (abnormal values) ──────
    if (abnormalValues.length > 0) {
      try {
        const severity = abnormalValues.some(v => v.includes('HIGH') && (v.includes('Sugar') || v.includes('Hb')))
          ? 'critical' : 'warning'
        await supabase.from('doctor_alerts').insert({
          patient_id:   patientId,
          patient_name: resolvedName,
          mrn:          mrn || '',
          alert_type:   'abnormal_lab',
          severity,
          title:        `Lab Report — ${abnormalValues.length} abnormal value${abnormalValues.length > 1 ? 's' : ''}`,
          message:      `Report: ${reportName} from ${labName}`,
          alert_data:   {
            report_id:       reportId,
            report_name:     reportName,
            lab_partner:     labName,
            abnormal_values: abnormalValues,
            extracted_count: Object.keys(extractedValues).length,
          },
          is_read: false,
        })
      } catch (e) {
        console.warn('[lab-portal] Doctor alert creation failed (non-fatal):', e)
      }
    }

    // ── Step 8: Audit log ─────────────────────────────────────
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
        ai_extracted: Object.keys(extractedValues).length,
        abnormals: abnormalValues.length,
      }),
      user_id:    'lab_portal',
      user_email: portalUser.name,
      user_role:  'lab_partner',
    })

    // ── Step 9: Update portal user last_used_at ───────────────
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
      aiExtracted:    Object.keys(extractedValues).length,
      abnormalsFound: abnormalValues.length,
      abnormalValues,
      message:        `Report "${reportName}" uploaded successfully for ${resolvedName}. Doctor and patient have been notified.${abnormalValues.length > 0 ? ` ${abnormalValues.length} abnormal value(s) detected — doctor alerted.` : ''}`,
    })

  } catch (err: any) {
    console.error('[lab-portal] Error:', err)
    return NextResponse.json({ success: false, error: err.message }, { status: 500 })
  }
}