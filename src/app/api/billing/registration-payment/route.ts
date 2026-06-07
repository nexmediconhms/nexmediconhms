/**
 * src/app/api/billing/registration-payment/route.ts
 *
 * Registration Payment API — FIXED VERSION
 *
 * POST /api/billing/registration-payment
 *
 * Creates a bill for registration/consultation fee and records the payment
 * in a single step. Used during patient registration flow.
 *
 * ═══════════════════════════════════════════════════════════════
 * FIXES APPLIED (vs original):
 *
 *   FIX #1: Added `net_amount` to bill insert (dashboard/reports read this field)
 *   FIX #2: Added `subtotal` to bill insert
 *   FIX #3: Added `paid_at` timestamp for paid bills
 *   FIX #4: Items stored with BOTH `label` AND `description` keys (compatibility)
 *   FIX #5: Added `patient_id` to `bill_payments` insert
 *   FIX #6: Graceful fallback if bill_payments lacks patient_id column
 *   FIX #7: Better error logging (no more silent failures)
 *   FIX #8: Returns detailed error info so frontend can display it
 * ═══════════════════════════════════════════════════════════════
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Use service role key to bypass RLS; fall back to anon key if not available
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false }
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      patient_id,
      patient_name,
      mrn,
      amount,
      payment_method,
      payment_ref,
      description = 'OPD Registration Fee',
      type = 'registration',
      skip_payment = false,
    } = body

    // Validation
    if (!patient_id || !amount || (!payment_method && !skip_payment)) {
      console.error('[Registration Payment] Validation failed:', { patient_id: !!patient_id, amount, payment_method, skip_payment })
      return NextResponse.json(
        { error: 'patient_id, amount, and payment_method are required' },
        { status: 400 }
      )
    }

    const amountNum = parseFloat(amount)
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return NextResponse.json({ error: 'amount must be > 0' }, { status: 400 })
    }

    // Generate invoice number
    const now = new Date()
    const todayStr = now.toISOString().slice(0, 10)
    const todayCompact = todayStr.replace(/-/g, '')

    const { count, error: countError } = await supabase
      .from('bills')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', todayStr + 'T00:00:00')

    if (countError) {
      console.warn('[Registration Payment] Count query failed (non-fatal):', countError.message)
    }

    const invoiceNumber = `REG-${todayCompact}-${String((count || 0) + 1).padStart(3, '0')}`

    // Determine if this is a paid or pending bill
    const isPaid = !skip_payment && payment_method !== 'pending'
    const nowISO = now.toISOString()

    // ─── Create the bill ─────────────────────────────────────────────────────
    // FIX #10: Schema-resilient insert — tries modern snake_case columns first,
    // falls back to legacy camelCase if the insert fails (handles databases
    // where migration 023/024 hasn't been applied yet).
    const billPayload = {
      patient_id,
      patient_name: patient_name || '',
      mrn: mrn || '',
      invoice_number: invoiceNumber,
      // FIX #4: Store items with BOTH keys for UI compatibility
      items: [{ label: description, description, qty: 1, rate: amountNum, amount: amountNum }],
      // FIX #1 & #2: Set ALL amount fields
      subtotal: amountNum,
      total: amountNum,
      net_amount: amountNum,
      discount: 0,
      tax: 0,
      gst_amount: 0,
      paid: isPaid ? amountNum : 0,
      due: isPaid ? 0 : amountNum,
      status: isPaid ? 'paid' : 'pending',
      payment_mode: isPaid ? payment_method : null,
      payment_ref: isPaid ? (payment_ref || null) : null,
      // FIX #3: Set paid_at for immediate payments
      paid_at: isPaid ? nowISO : null,
      notes: isPaid
        ? `${type} payment — ${payment_method}${payment_ref ? ` (Ref: ${payment_ref})` : ''}`
        : `${type} — payment pending`,
    }

    console.log('[Registration Payment] Creating bill:', JSON.stringify({ patient_id, amount: amountNum, isPaid, method: payment_method }))

    let bill: { id: string; invoice_number: string } | null = null

    // Attempt 1: Modern schema (snake_case columns — patient_id, invoice_number, etc.)
    const { data: billData, error: billError } = await supabase
      .from('bills')
      .insert(billPayload)
      .select('id, invoice_number')
      .single()

    if (!billError && billData) {
      bill = billData
    } else {
      // Attempt 2: Legacy schema (camelCase columns — patientid, invoicenumber, etc.)
      console.warn('[Registration Payment] Modern schema insert failed:', billError?.message, '— trying legacy schema...')

      const legacyPayload: Record<string, any> = {
        patientid: patient_id,
        invoicenumber: invoiceNumber,
        items: [{ label: description, description, qty: 1, rate: amountNum, amount: amountNum }],
        subtotal: amountNum,
        total: amountNum,
        discount: 0,
        tax: 0,
        paid: isPaid ? amountNum : 0,
        due: isPaid ? 0 : amountNum,
        status: isPaid ? 'paid' : 'pending',
        paymentmode: isPaid ? payment_method : null,
        notes: isPaid
          ? `${type} payment — ${payment_method}${payment_ref ? ` (Ref: ${payment_ref})` : ''}`
          : `${type} — payment pending`,
      }

      const { data: legacyBill, error: legacyError } = await supabase
        .from('bills')
        .insert(legacyPayload)
        .select('id, invoicenumber')
        .single()

      if (legacyError) {
        console.error('[Registration Payment] Bill creation FAILED (both schemas):', legacyError.message, legacyError.code)
        return NextResponse.json({
          error: `Bill creation failed: ${billError?.message || legacyError.message}`,
          code: legacyError.code,
          hint: 'Check that the bills table exists. Run migration 023 or 024.',
        }, { status: 500 })
      }

      bill = { id: legacyBill.id, invoice_number: legacyBill.invoicenumber || invoiceNumber }
      console.log('[Registration Payment] Bill created with LEGACY schema:', bill.id)
    }

    if (!bill) {
      return NextResponse.json({ error: 'Bill creation returned no data' }, { status: 500 })
    }

    console.log('[Registration Payment] Bill created successfully:', bill.id, bill.invoice_number)

    // ─── Record payment in bill_payments (only if paid) ──────────────────────
    if (isPaid) {
      // FIX #5 & #6: Try with patient_id first, fallback without
      const paymentPayload = {
        bill_id: bill.id,
        patient_id,
        amount: amountNum,
        payment_mode: payment_method,
        reference: payment_ref || null,
        received_by: 'reception',
        notes: `Registration payment for ${patient_name || 'patient'}`,
        transaction_type: 'payment',
      }

      const { error: payError } = await supabase.from('bill_payments').insert(paymentPayload)

      if (payError) {
        console.warn('[Registration Payment] bill_payments insert failed:', payError.message)
        // FIX #6: Try without patient_id (column might not exist)
        const { error: payError2 } = await supabase.from('bill_payments').insert({
          bill_id: bill.id,
          amount: amountNum,
          payment_mode: payment_method,
          reference: payment_ref || null,
          received_by: 'reception',
          notes: `Registration payment for ${patient_name || 'patient'} [pid:${patient_id}]`,
          transaction_type: 'payment',
        })
        if (payError2) {
          console.warn('[Registration Payment] bill_payments insert retry also failed:', payError2.message)
          // Still non-fatal — the bill itself was created successfully
        } else {
          console.log('[Registration Payment] bill_payments inserted (without patient_id column)')
        }
      } else {
        console.log('[Registration Payment] bill_payments recorded successfully')
      }

      // ─── FIX #9: Create or update encounter for this registration ────────────
      // The daily report and monthly report depend on encounters to show revenue.
      // Without an encounter record, the bill won't appear in reports even though
      // it exists in the bills table. We create a minimal OPD encounter here.
      try {
        // Try both column names (patient_id for modern schema, patientid for legacy)
        let existingEnc: any = null

        const { data: encModern } = await supabase
          .from('encounters')
          .select('id')
          .eq('patient_id', patient_id)
          .eq('encounter_date', todayStr)
          .limit(1)

        if (encModern && encModern.length > 0) {
          existingEnc = encModern[0]
        } else {
          // Try legacy column name
          const { data: encLegacy } = await supabase
            .from('encounters')
            .select('id')
            .eq('patientid', patient_id)
            .eq('encounter_date', todayStr)
            .limit(1)
          if (encLegacy && encLegacy.length > 0) {
            existingEnc = encLegacy[0]
          }
        }

        if (existingEnc) {
          // Encounter exists — link the bill to it and mark as paid
          await supabase
            .from('encounters')
            .update({ revenue_status: 'paid', bill_id: bill.id, updated_at: nowISO })
            .eq('id', existingEnc.id)

          // Also link the bill back to the encounter
          await supabase
            .from('bills')
            .update({ encounter_id: existingEnc.id })
            .eq('id', bill.id)

          console.log('[Registration Payment] Linked bill to existing encounter:', existingEnc.id)
        } else {
          // No encounter exists — CREATE one so daily/monthly reports pick up this bill
          const encounterPayload = {
            patient_id,
            encounter_date: todayStr,
            encounter_type: 'OPD',
            chief_complaint: 'Registration / OPD Consultation',
            diagnosis: null,
            notes: `Auto-created during registration. Payment: ₹${amountNum} via ${payment_method}`,
            revenue_status: 'paid',
            bill_id: bill.id,
          }

          const { data: newEnc, error: encCreateErr } = await supabase
            .from('encounters')
            .insert(encounterPayload)
            .select('id')
            .single()

          if (encCreateErr) {
            console.warn('[Registration Payment] Encounter creation failed (non-fatal):', encCreateErr.message)
            // Try with legacy column name as fallback
            const legacyPayload = {
              patientid: patient_id,
              encounter_date: todayStr,
              encounter_type: 'OPD',
              chief_complaint: 'Registration / OPD Consultation',
              diagnosis: null,
              notes: `Auto-created during registration. Payment: ₹${amountNum} via ${payment_method}`,
              revenue_status: 'paid',
              bill_id: bill.id,
            }
            const { data: newEncLegacy, error: encLegacyErr } = await supabase
              .from('encounters')
              .insert(legacyPayload)
              .select('id')
              .single()

            if (newEncLegacy) {
              await supabase.from('bills').update({ encounter_id: newEncLegacy.id }).eq('id', bill.id)
              console.log('[Registration Payment] Created encounter (legacy schema):', newEncLegacy.id)
            } else {
              console.warn('[Registration Payment] Encounter creation (legacy) also failed:', encLegacyErr?.message)
            }
          } else if (newEnc) {
            // Link the bill to the new encounter
            await supabase.from('bills').update({ encounter_id: newEnc.id }).eq('id', bill.id)
            console.log('[Registration Payment] Created new encounter:', newEnc.id)
          }
        }
      } catch (encErr) {
        console.warn('[Registration Payment] Encounter create/update failed (non-fatal):', encErr)
      }
    }

    return NextResponse.json({
      ok: true,
      bill_id: bill.id,
      invoice_number: bill.invoice_number,
      amount: amountNum,
      payment_method: isPaid ? payment_method : 'pending',
      status: isPaid ? 'paid' : 'pending',
    })
  } catch (err: any) {
    console.error('[Registration Payment] Unexpected error:', err)
    return NextResponse.json({ error: err.message || 'Unknown error' }, { status: 500 })
  }
}

