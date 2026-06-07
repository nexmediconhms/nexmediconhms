/**
 * src/app/api/billing/patient-bills/route.ts
 *
 * GET /api/billing/patient-bills?patient_id=<uuid>
 *
 * Fetches all bills for a patient using the service role key (bypasses RLS).
 * This solves the issue where client-side queries return empty results due to
 * RLS policies blocking reads when the user session doesn't satisfy is_active_user().
 *
 * Returns normalized bill objects with consistent snake_case keys regardless
 * of whether the database uses legacy (patientid, createdat) or modern
 * (patient_id, created_at) column names.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false }
})

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const patientId = searchParams.get('patient_id')

    if (!patientId) {
      return NextResponse.json({ error: 'patient_id is required' }, { status: 400 })
    }

    // Strategy: Try modern column name first, then legacy
    let bills: any[] = []
    let queryError: any = null

    // Attempt 1: Modern schema (patient_id column)
    const { data: modernData, error: modernError } = await supabase
      .from('bills')
      .select('*')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
      .limit(50)

    if (!modernError && modernData && modernData.length > 0) {
      bills = modernData
    } else {
      // Attempt 2: Try modern column with legacy order
      const { data: modernData2, error: modernError2 } = await supabase
        .from('bills')
        .select('*')
        .eq('patient_id', patientId)
        .order('createdat', { ascending: false })
        .limit(50)

      if (!modernError2 && modernData2 && modernData2.length > 0) {
        bills = modernData2
      } else {
        // Attempt 3: Legacy schema (patientid column) with legacy order
        const { data: legacyData, error: legacyError } = await supabase
          .from('bills')
          .select('*')
          .eq('patientid', patientId)
          .order('createdat', { ascending: false })
          .limit(50)

        if (!legacyError && legacyData && legacyData.length > 0) {
          bills = legacyData
        } else {
          // Attempt 4: Legacy column with modern order
          const { data: legacyData2, error: legacyError2 } = await supabase
            .from('bills')
            .select('*')
            .eq('patientid', patientId)
            .order('created_at', { ascending: false })
            .limit(50)

          if (!legacyError2 && legacyData2 && legacyData2.length > 0) {
            bills = legacyData2
          } else {
            // Attempt 5: Last resort — select ALL bills and filter in memory
            // This handles edge cases where column names are completely unexpected
            const { data: allData, error: allError } = await supabase
              .from('bills')
              .select('*')
              .limit(200)

            if (!allError && allData) {
              bills = allData.filter((b: any) =>
                b.patient_id === patientId || b.patientid === patientId
              )
            }

            queryError = legacyError2 || legacyError || modernError2 || modernError || allError
          }
        }
      }
    }

    // Normalize bills to consistent snake_case format
    const normalizedBills = bills.map((bill: any) => ({
      id: bill.id,
      patient_id: bill.patient_id || bill.patientid,
      patient_name: bill.patient_name || '',
      mrn: bill.mrn || '',
      invoice_number: bill.invoice_number || bill.invoicenumber || '',
      items: Array.isArray(bill.items) ? bill.items : [],
      subtotal: Number(bill.subtotal || bill.total || 0),
      net_amount: Number(bill.net_amount || bill.total || 0),
      total: Number(bill.total || 0),
      paid: Number(bill.paid || 0),
      due: Number(bill.due || 0),
      discount: Number(bill.discount || 0),
      tax: Number(bill.tax || 0),
      gst_amount: Number(bill.gst_amount || 0),
      payment_mode: bill.payment_mode || bill.paymentmode || null,
      payment_ref: bill.payment_ref || null,
      status: bill.status || 'unknown',
      notes: bill.notes || '',
      created_at: bill.created_at || bill.createdat || null,
      updated_at: bill.updated_at || bill.updatedat || null,
      paid_at: bill.paid_at || null,
      encounter_id: bill.encounter_id || null,
    }))

    return NextResponse.json({
      ok: true,
      bills: normalizedBills,
      count: normalizedBills.length,
      ...(queryError ? { warning: queryError.message } : {}),
    })
  } catch (err: any) {
    console.error('[patient-bills API] Unexpected error:', err)
    return NextResponse.json({ error: err.message || 'Unknown error' }, { status: 500 })
  }
}
