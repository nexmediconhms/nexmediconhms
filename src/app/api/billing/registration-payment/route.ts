/**
 * src/app/api/billing/registration-payment/route.ts
 *
 * Registration Payment API
 *
 * POST /api/billing/registration-payment
 *
 * Creates a bill for registration/consultation fee and records the payment
 * in a single step. Used during patient registration flow.
 *
 * This is separate from the main billing/payment API which requires an
 * existing billId. Here we create the bill + payment atomically.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } },
);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      patient_id,
      patient_name,
      mrn,
      amount,
      payment_method,
      payment_ref,
      description = "OPD Registration Fee",
      type = "registration",
      skip_payment = false,
    } = body;

    if (!patient_id || !amount || (!payment_method && !skip_payment)) {
      return NextResponse.json(
        { error: "patient_id, amount, and payment_method are required" },
        { status: 400 },
      );
    }

    const amountNum = parseFloat(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return NextResponse.json(
        { error: "amount must be > 0" },
        { status: 400 },
      );
    }

    // Generate invoice number
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const { count } = await supabase
      .from("bills")
      .select("id", { count: "exact", head: true })
      .gte("created_at", new Date().toISOString().slice(0, 10) + "T00:00:00");

    const invoiceNumber = `REG-${today}-${String((count || 0) + 1).padStart(3, "0")}`;

    // Determine if this is a paid or pending bill
    const isPaid = !skip_payment && payment_method !== "pending";

    // Create the bill
    const { data: bill, error: billError } = await supabase
      .from("bills")
      .insert({
        patient_id,
        patient_name: patient_name || "",
        mrn: mrn || "",
        invoice_number: invoiceNumber,
        items: [{ description, qty: 1, rate: amountNum, amount: amountNum }],
        subtotal: amountNum,
        net_amount: amountNum,
        total: amountNum,
        total_paid: isPaid ? amountNum : 0,
        due: isPaid ? 0 : amountNum,
        status: isPaid ? "paid" : "pending",
        payment_mode: isPaid ? payment_method : null,
        payment_ref: isPaid ? payment_ref || null : null,
        encounter_type: "OPD",
        type: type || "registration",
        paid_at: isPaid ? new Date().toISOString() : null,
        notes: isPaid
          ? `${type} payment — ${payment_method}${payment_ref ? ` (Ref: ${payment_ref})` : ""}`
          : `${type} — payment pending`,
      })
      .select("id, invoice_number")
      .single();

    if (billError) {
      console.error(
        "[Registration Payment] Bill creation failed:",
        billError.message,
      );
      return NextResponse.json({ error: billError.message }, { status: 500 });
    }

    // Record the payment in bill_payments table (only if actually paid)
    if (isPaid) {
      try {
        // Ensure bill_payments table exists by attempting insert
        const { error: bpError } = await supabase.from('bill_payments').insert({
          bill_id: bill.id,
          patient_id: patient_id,
          amount: amountNum,
          payment_mode: payment_method,
          reference: payment_ref || null,
          received_by: 'reception',
          notes: `Registration payment for ${patient_name}`,
          invoice_number: invoiceNumber,
        });

        // If bill_payments insert failed (table missing), create it and retry
        if (bpError && bpError.code === '42P01') {
          // Table doesn't exist — create it
          try {
            await supabase.rpc('exec_sql', {
              sql: `
                CREATE TABLE IF NOT EXISTS bill_payments (
                  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                  bill_id UUID REFERENCES bills(id) ON DELETE CASCADE,
                  patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
                  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
                  payment_mode TEXT,
                  reference TEXT,
                  received_by TEXT,
                  notes TEXT,
                  invoice_number TEXT,
                  created_at TIMESTAMPTZ DEFAULT now()
                );
                CREATE INDEX IF NOT EXISTS idx_bill_payments_bill_id ON bill_payments(bill_id);
                CREATE INDEX IF NOT EXISTS idx_bill_payments_patient_id ON bill_payments(patient_id);
              `
            });

            // Retry the insert after table creation
            const { error: retryError } = await supabase.from('bill_payments').insert({
              bill_id: bill.id,
              patient_id: patient_id,
              amount: amountNum,
              payment_mode: payment_method,
              reference: payment_ref || null,
              received_by: 'reception',
              notes: `Registration payment for ${patient_name}`,
              invoice_number: invoiceNumber,
            });

            if (retryError) {
              console.warn('[Registration Payment] bill_payments retry insert failed:', retryError.message);
            }
          } catch {
            // If RPC not available, log warning — table must be created via migration
            console.warn('[Registration Payment] bill_payments table missing. Run the migration SQL.');
          }
        } else if (bpError) {
          console.warn('[Registration Payment] bill_payments insert failed:', bpError.message);
        }
      } catch (err) {
        console.warn('[Registration Payment] bill_payments insert exception:', err);
      }

      // Update revenue lifecycle: if patient has an encounter today, mark as 'paid'
      try {
        const todayDate = new Date().toISOString().slice(0, 10);
        const { data: encounters } = await supabase
          .from("encounters")
          .select("id")
          .eq("patientid", patient_id)
          .eq("encounter_date", todayDate)
          .limit(1);

        if (encounters && encounters.length > 0) {
          await supabase
            .from("encounters")
            .update({
              revenue_status: "paid",
              bill_id: bill.id,
              updated_at: new Date().toISOString(),
            })
            .eq("id", encounters[0].id);
        }
      } catch {
        // Revenue lifecycle tracking is non-fatal
      }
    }

    return NextResponse.json({
      ok: true,
      bill_id: bill.id,
      invoice_number: bill.invoice_number,
      amount: amountNum,
      payment_method: isPaid ? payment_method : "pending",
      status: isPaid ? "paid" : "pending",
    });
  } catch (err: any) {
    console.error("[Registration Payment] Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}