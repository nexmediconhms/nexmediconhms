/**
 * src/app/api/pdf/prescription/route.ts
 *
 * GET /api/pdf/prescription?encounterId=xxx
 *
 * Server-side PDF generation for prescriptions using @react-pdf/renderer.
 * Requirement #8: Replace CSS @media print with real PDF files.
 *
 * Returns:
 *  - The PDF as a download (Content-Disposition: attachment)
 *  - Or a redirect to Supabase Storage URL (if upload succeeds)
 *
 * Auth: Requires valid clinic session JWT.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generatePrescriptionPDF, uploadPDFToStorage } from '@/lib/pdf-generator'
import type { PDFPrescriptionData } from '@/lib/pdf-generator'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function GET(req: NextRequest) {
  // Auth
  const token = req.headers.get('authorization')?.split(' ')[1]
    || req.cookies.get('sb-access-token')?.value

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
  if (authErr || !user) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const encounterId      = searchParams.get('encounterId')
  const upload           = searchParams.get('upload') === 'true'

  if (!encounterId) {
    return NextResponse.json({ error: 'encounterId is required' }, { status: 400 })
  }

  // Load data
  const { data: enc } = await supabase
    .from('encounters')
    .select('*, patients(*)')
    .eq('id', encounterId)
    .single()

  if (!enc) {
    return NextResponse.json({ error: 'Encounter not found' }, { status: 404 })
  }

  const { data: rx } = await supabase
    .from('prescriptions')
    .select('*')
    .eq('encounter_id', encounterId)
    .single()

  if (!rx) {
    return NextResponse.json({ error: 'No prescription for this encounter' }, { status: 404 })
  }

  // Load hospital settings
  const { data: settingRow } = await supabase
    .from('clinic_settings')
    .select('value')
    .eq('key', 'hospital_settings')
    .single()

  const hs = settingRow?.value || {}

  const pdfData: PDFPrescriptionData = {
    patient: {
      full_name:   enc.patients?.full_name  || 'Patient',
      mrn:         enc.patients?.mrn        || '',
      age:         enc.patients?.age,
      gender:      enc.patients?.gender,
      mobile:      enc.patients?.mobile,
      blood_group: enc.patients?.blood_group,
      address:     enc.patients?.address,
    },
    encounter: {
      encounter_date:  enc.encounter_date,
      diagnosis:       enc.diagnosis,
      chief_complaint: enc.chief_complaint,
      bp_systolic:     enc.bp_systolic,
      bp_diastolic:    enc.bp_diastolic,
      pulse:           enc.pulse,
      temperature:     enc.temperature,
      spo2:            enc.spo2,
      weight:          enc.weight,
    },
    prescription: {
      medications:    rx.medications    || [],
      advice:         rx.advice,
      dietary_advice: rx.dietary_advice,
      reports_needed: rx.reports_needed,
      follow_up_date: rx.follow_up_date,
    },
    hospital: {
      hospitalName: (hs as any).hospitalName || 'NexMedicon Hospital',
      address:      (hs as any).address,
      phone:        (hs as any).phone,
      regNo:        (hs as any).regNo,
      gstin:        (hs as any).gstin,
      doctorName:   (hs as any).doctorName  || 'Doctor',
      doctorQual:   (hs as any).doctorQual,
      doctorReg:    (hs as any).doctorReg,
      footerNote:   (hs as any).footerNote,
    },
  }

  try {
    const pdfBuffer = await generatePrescriptionPDF(pdfData)
    const filename  = `prescription_${encounterId}_${Date.now()}.pdf`

    // Option A: Upload to storage and redirect
    if (upload) {
      const url = await uploadPDFToStorage(pdfBuffer, filename, 'prescriptions')
      if (url) {
        return NextResponse.redirect(url)
      }
    }

    // Option B: Stream PDF directly (download)
    return new NextResponse(new Uint8Array(pdfBuffer), {
      status:  200,
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length':      String(pdfBuffer.length),
      },
    })
  } catch (err: any) {
    console.error('[api/pdf/prescription]', err)
    return NextResponse.json({ error: 'PDF generation failed: ' + err.message }, { status: 500 })
  }
}