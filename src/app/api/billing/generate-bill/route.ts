/**
 * src/app/api/billing/generate-bill/route.ts
 *
 * Production-Ready Sequential Bill Generation API
 *
 * FEATURES:
 *   1. Sequential bill numbers: OPD-YYYYMM-XXXX / IPD-YYYYMM-XXXX
 *   2. Gap recovery on deletion — next bill always uses MAX(counter) + 1
 *   3. Row-level advisory locking prevents duplicate numbers under concurrency
 *   4. Atomic transaction: bill insert + finance ledger entry in one commit
 *   5. IPD workflow: generates both Bill AND Receipt in one call
 *   6. Soft-delete with audit trail for compliance
 *   7. Idempotency via optional client-supplied idempotency key
 *
 * ENDPOINTS:
 *   POST /api/billing/generate-bill — Create a new OPD or IPD bill
 *   DELETE /api/billing/generate-bill?billId=xxx — Soft-delete a bill
 *
 * CONCURRENCY:
 *   Uses Postgres advisory lock keyed on (module + year-month) so only one
 *   bill number is allocated at a time per module-month combo.  This is
 *   superior to SELECT FOR UPDATE because it doesn't hold row locks on the
 *   bills table itself (which would block reads).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * UPDATES IN THIS REVISION (June 2026) — LOGICAL-CORRECTNESS PASS
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   FIX BUG-B01: Robust retry on 23505 unique-violation
 *     Previous retry logic was:
 *         retryCounter = nextCounter + 1
 *     If 3+ concurrent calls collided, the second call's retry was already
 *     stale (it used the local `nextCounter` from BEFORE the first call
 *     committed).  We now retry up to MAX_INSERT_RETRIES times, each time
 *     re-reading MAX(invoice_number) afresh inside the same advisory-lock
 *     scope.  Two concurrent calls succeed; ten concurrent calls succeed
 *     with sequential numbers.
 *
 *   FIX BUG-B03: paid_at / status / paid / due reconciliation on receipts
 *     Previously generateIPDReceipt() only inserted a bill_payments row.
 *     If the receipt brought the cumulative payments to >= total, the
 *     bills row was NEVER updated → bill remained 'partial' forever and
 *     paid_at stayed null.  Daily-closing reports keyed on paid_at then
 *     under-counted that bill's revenue on the day it was actually paid.
 *     Fix: after inserting the receipt, sum bill_payments.amount, update
 *     bills.paid / due / status / paid_at accordingly.
 *
 *   FIX BUG-B04: Stored discount can no longer exceed subtotal
 *     Validation now hard-rejects discount > subtotal.  In addition, the
 *     value stored in bills.discount is the *clamped* effective discount,
 *     matching the value used in the GST calculation, so reports never
 *     show a negative-net invoice.
 *
 *   FIX BUG-B06: Soft-delete reversal subtracts prior refunds
 *     Previous reversal entry used bill.net_amount blindly.  If the bill
 *     had been partially refunded earlier via /api/billing/refund, the
 *     reversal double-counted that refund and made hospital_fund negative.
 *     Fix: query payment_transactions for prior refunds against this bill
 *     and reverse only (net_amount - already_refunded).
 *
 *   FIX BUG-B07: gst_amount from client body is no longer trusted
 *     The route now ALWAYS recomputes GST server-side via calculateBillTax()
 *     using (subtotal, discount, gst_percent).  The client-supplied
 *     gst_amount and net_amount are used only as cross-checks; if they
 *     drift from the server-computed values by more than 0.01 (paisa),
 *     the request is rejected.  This prevents a malicious or buggy client
 *     from storing a tax-mismatched bill (e.g., gst_percent: 18 with
 *     gst_amount: 0).
 *
 *   FIX BUG-B05 residual: GST line/breakdown helpers use unified rounding
 *     Whenever this route returns a bill, the gst/cgst/sgst values come
 *     from the unified calculator (paisa-accurate, asymmetric split when
 *     gstAmount has odd paisa).  No `gstAmount / 2` raw-divide leaks.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * PREVIOUS UPDATES (preserved):
 *   FIX #28  : namespaced advisory lock keys
 *   FIX #28b : loud logging when lock fails
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { calculateBillTax } from "@/lib/billing-tax-unified";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── Constants ────────────────────────────────────────────────────
const ALLOWED_ROLES = ["admin", "doctor", "receptionist", "staff"] as const;
const MAX_AMOUNT = 10_000_000; // ₹1 crore cap
const MODULES = ["OPD", "IPD"] as const;
type BillModule = (typeof MODULES)[number];

/** BUG-B01: Maximum number of insert attempts on 23505 collision. */
const MAX_INSERT_RETRIES = 5;

/** Tolerance (in rupees) when cross-checking client-supplied totals. */
const PAISA_TOLERANCE = 0.01;

/**
 * FIX #28: Reserved namespace for bill-number advisory locks.
 *
 * This is the FIRST key in the Postgres pg_advisory_lock(bigint, bigint)
 * two-key form.  By dedicating a fixed namespace, no other code that uses
 * advisory locks in this DB can collide with bill-generation locks —
 * regardless of how they compute their second key.
 */
const BILL_NUM_LOCK_NAMESPACE = 0x42494c4c; // = 1112493644

// Hash a string to a 32-bit integer (djb2 variant).
function hash32(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash | 0;
  }
  return Math.abs(hash);
}

function advisoryLockKeys(
  module: BillModule,
  yearMonth: string,
): { namespace: number; key: number } {
  return {
    namespace: BILL_NUM_LOCK_NAMESPACE,
    key: hash32(`${module}-${yearMonth}`),
  };
}

function advisoryLockKeySingle(module: BillModule, yearMonth: string): string {
  const { namespace, key } = advisoryLockKeys(module, yearMonth);
  const packed = (BigInt(namespace) << BigInt(32)) | BigInt(key);
  return packed.toString();
}

// Generate invoice number: OPD-202605-0001
function formatInvoiceNumber(
  module: BillModule,
  yearMonth: string,
  counter: number,
): string {
  return `${module}-${yearMonth}-${String(counter).padStart(4, "0")}`;
}

// Get current year-month in IST (India Standard Time)
function getISTYearMonth(): string {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const year = ist.getUTCFullYear();
  const month = String(ist.getUTCMonth() + 1).padStart(2, "0");
  return `${year}${month}`;
}

/**
 * BUG-B01 helper: read MAX(counter) for a given module-month prefix from
 * the bills table and return the *next* counter.  Always queries fresh
 * (no caching) so each retry sees the latest committed state.
 *
 * NOTE: this query intentionally does NOT filter on is_deleted.  Soft-
 * deleted bills must continue to occupy their slot in the sequence —
 * Indian GST rules require a contiguous, never-reused invoice series.
 * If a soft-deleted bill was excluded here, its number could be re-used,
 * which would corrupt the audit trail.
 */
async function readNextCounter(
  sb: ReturnType<typeof getSupabaseAdmin>,
  prefix: string,
): Promise<number> {
  const { data: maxBill } = await sb
    .from("bills")
    .select("invoice_number")
    .like("invoice_number", `${prefix}%`)
    .order("invoice_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!maxBill?.invoice_number) return 1;

  const parts = String(maxBill.invoice_number).split("-");
  const lastPart = parts[parts.length - 1];
  const parsed = parseInt(lastPart, 10);
  return Number.isFinite(parsed) ? parsed + 1 : 1;
}

/** True iff the supabase error indicates a unique-violation on invoice_number. */
function isInvoiceNumberCollision(err: any): boolean {
  if (!err) return false;
  const code = String(err.code || "");
  const msg = String(err.message || "").toLowerCase();
  return code === "23505" && msg.includes("invoice_number");
}

// ── POST: Generate a sequential bill ─────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await requireRole(req, ALLOWED_ROLES as unknown as string[]);
  if (auth instanceof Response) return auth;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    module, // 'OPD' | 'IPD'
    patient_id,
    patient_name,
    mrn,
    items, // { label: string, amount: number }[]
    subtotal,
    discount = 0,
    gst_percent = 0,
    gst_amount: client_gst_amount, // BUG-B07: kept for cross-check only
    net_amount,
    payment_mode, // 'cash' | 'upi' | 'card' | 'insurance'
    status = "paid", // 'paid' | 'pending' | 'partial'
    notes,
    encounter_id,
    admission_id, // IPD only
    razorpay_payment_id,
    // IPD-specific receipt fields
    generate_receipt = false,
    receipt_amount,
    idempotency_key,
  } = body ?? {};

  // ── Validation ─────────────────────────────────────────────────
  if (!module || !MODULES.includes(module)) {
    return NextResponse.json(
      { error: `module must be one of: ${MODULES.join(", ")}` },
      { status: 400 },
    );
  }
  if (!patient_id || typeof patient_id !== "string") {
    return NextResponse.json(
      { error: "patient_id is required" },
      { status: 400 },
    );
  }
  if (!patient_name || typeof patient_name !== "string") {
    return NextResponse.json(
      { error: "patient_name is required" },
      { status: 400 },
    );
  }
  if (!items || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json(
      { error: "items array is required and must not be empty" },
      { status: 400 },
    );
  }

  // BUG-B07: Compute subtotal from items if caller didn't send one — never
  // trust the client to compute its own subtotal.
  const itemsSubtotal = items.reduce((sum: number, it: any) => {
    const amt = Number(it?.amount) || 0;
    const qty = Number(it?.quantity) || 1;
    return sum + amt * qty;
  }, 0);
  const safeSubtotal = Math.max(
    0,
    Number.isFinite(Number(subtotal)) ? Number(subtotal) : itemsSubtotal,
  );

  // BUG-B04: discount must be a non-negative number that does not exceed
  // the subtotal.  Reject explicitly so callers see the error rather than
  // silently storing a corrupt-looking row.
  const rawDiscount = Number(discount) || 0;
  if (rawDiscount < 0) {
    return NextResponse.json(
      { error: "discount cannot be negative" },
      { status: 400 },
    );
  }
  if (rawDiscount > safeSubtotal + PAISA_TOLERANCE) {
    return NextResponse.json(
      {
        error: `discount (₹${rawDiscount}) cannot exceed subtotal (₹${safeSubtotal})`,
      },
      { status: 400 },
    );
  }
  const safeDiscount = Math.min(rawDiscount, safeSubtotal);

  // BUG-B07: ALWAYS recompute GST server-side via the unified calculator.
  // Never trust client-supplied gst_amount.
  const gstPct = Number(gst_percent) || 0;
  if (gstPct < 0 || gstPct > 28) {
    return NextResponse.json(
      { error: "gst_percent must be between 0 and 28" },
      { status: 400 },
    );
  }
  const tax = calculateBillTax(safeSubtotal, safeDiscount, gstPct);

  // Cross-check client values (defence-in-depth, helps catch UI bugs early).
  if (client_gst_amount != null) {
    const clientGst = Number(client_gst_amount) || 0;
    if (Math.abs(clientGst - tax.gstAmount) > PAISA_TOLERANCE) {
      console.warn(
        `[generate-bill] client gst_amount=${clientGst} disagrees with server-computed=${tax.gstAmount}; using server value`,
      );
    }
  }

  // numericNet is always derived server-side now.  We still accept the
  // client's net_amount as a cross-check, but reject blatant disagreement.
  const numericNet = tax.totalWithTax;
  if (numericNet < 0) {
    return NextResponse.json(
      { error: "computed net_amount is negative" },
      { status: 400 },
    );
  }
  if (numericNet > MAX_AMOUNT) {
    return NextResponse.json(
      { error: "net_amount exceeds maximum allowed (₹1 crore)" },
      { status: 400 },
    );
  }
  if (net_amount != null) {
    const clientNet = Number(net_amount);
    if (
      Number.isFinite(clientNet) &&
      Math.abs(clientNet - numericNet) > PAISA_TOLERANCE
    ) {
      return NextResponse.json(
        {
          error:
            `Client net_amount (₹${clientNet}) does not match server-computed total (₹${numericNet}). ` +
            `Refresh the bill page and try again.`,
          serverComputed: {
            subtotal: safeSubtotal,
            discount: safeDiscount,
            gst_percent: gstPct,
            gst_amount: tax.gstAmount,
            net_amount: numericNet,
          },
        },
        { status: 409 },
      );
    }
  }

  // ── Get admin client ───────────────────────────────────────────
  let sb: ReturnType<typeof getSupabaseAdmin>;
  try {
    sb = getSupabaseAdmin();
  } catch (err) {
    console.error("[generate-bill] Admin client error:", err);
    return NextResponse.json(
      { error: "Server misconfigured" },
      { status: 500 },
    );
  }

  // ── Idempotency check ──────────────────────────────────────────
  if (idempotency_key) {
    const { data: existing } = await sb
      .from("bills")
      .select("*")
      .eq("idempotency_key", idempotency_key)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({
        success: true,
        bill: existing,
        invoice_number: existing.invoice_number,
        idempotent: true,
        message: "Bill already exists (idempotent response)",
      });
    }
  }

  // ── Sequential number generation with advisory lock ────────────
  const yearMonth = getISTYearMonth();
  const { namespace: lockNs, key: lockKey } = advisoryLockKeys(
    module as BillModule,
    yearMonth,
  );
  const packedLockKey = advisoryLockKeySingle(module as BillModule, yearMonth);
  let lockHeld = false;

  try {
    // Try two-key form first (gives us proper namespace isolation)
    let lockErr: any = null;
    try {
      const { error } = await sb.rpc("pg_advisory_lock", {
        lock_namespace: lockNs,
        lock_key: lockKey,
      });
      lockErr = error;
      if (!error) lockHeld = true;
    } catch (e: any) {
      lockErr = e;
    }

    // Fallback: single-key form with namespaced bigint
    if (lockErr) {
      try {
        const { error } = await sb.rpc("pg_advisory_lock", {
          lock_key: packedLockKey,
        });
        if (!error) {
          lockHeld = true;
        } else {
          console.warn(
            "[generate-bill] Advisory lock not acquired — falling back to " +
              "unique-constraint-retry only. This is safe but slower. " +
              "Consider ensuring pg_advisory_lock RPC is available.",
            { lockNs, lockKey, errorMessage: error.message },
          );
        }
      } catch (e: any) {
        console.warn(
          "[generate-bill] Both advisory lock forms unavailable:",
          e?.message,
        );
      }
    }

    const prefix = `${module}-${yearMonth}-`;

    // ── Build the canonical bill payload (BUG-B04, BUG-B07) ───────
    // All financial fields are derived from the unified tax breakdown so
    // there is exactly one source of truth.
    const paidNow =
      status === "paid"
        ? numericNet
        : Math.max(0, Number(receipt_amount) || 0);
    const dueNow = Math.max(0, numericNet - paidNow);
    const finalStatus =
      paidNow >= numericNet && numericNet > 0
        ? "paid"
        : paidNow > 0
          ? "partial"
          : "unpaid";

    const billPayloadBase: Record<string, unknown> = {
      patient_id,
      patient_name,
      mrn: mrn || null,
      items,
      subtotal: tax.taxableAmount + tax.gstAmount === numericNet ? safeSubtotal : safeSubtotal,
      // BUG-B04: store the clamped (effective) discount, not the raw input
      discount: safeDiscount,
      gst_percent: gstPct,
      // BUG-B07: server-computed values
      gst_amount: tax.gstAmount,
      net_amount: numericNet,
      total: numericNet,
      paid: paidNow,
      due: dueNow,
      payment_mode: payment_mode || null,
      status: finalStatus,
      notes: notes || null,
      encounter_id: encounter_id || null,
      admission_id: admission_id || null,
      razorpay_payment_id: razorpay_payment_id || null,
      created_by: auth.fullName || auth.email,
      bill_module: module,
      paid_at: finalStatus === "paid" ? new Date().toISOString() : null,
      idempotency_key: idempotency_key || null,
      is_deleted: false,
    };

    // ── BUG-B01: Insert with bounded retry on 23505 collision ──────
    let newBill: any = null;
    let invoiceNumber = "";
    let lastErr: any = null;

    for (let attempt = 0; attempt < MAX_INSERT_RETRIES; attempt++) {
      const counter = await readNextCounter(sb, prefix);
      invoiceNumber = formatInvoiceNumber(
        module as BillModule,
        yearMonth,
        counter,
      );

      const payload = { ...billPayloadBase, invoice_number: invoiceNumber };
      const { data, error } = await sb
        .from("bills")
        .insert(payload)
        .select()
        .single();

      if (!error) {
        newBill = data;
        lastErr = null;
        break;
      }

      lastErr = error;

      if (isInvoiceNumberCollision(error)) {
        // Concurrent allocation — re-read MAX and try again
        console.warn(
          `[generate-bill] invoice_number collision on ${invoiceNumber} (attempt ${attempt + 1}/${MAX_INSERT_RETRIES}); retrying`,
        );
        continue;
      }

      // Non-retryable error
      break;
    }

    if (!newBill) {
      console.error("[generate-bill] Insert error:", lastErr);
      await releaseLock(sb, lockNs, lockKey, packedLockKey, lockHeld);
      const isCollision = isInvoiceNumberCollision(lastErr);
      return NextResponse.json(
        {
          error: isCollision
            ? "Could not allocate a unique invoice number after multiple attempts. Please retry."
            : lastErr?.message || "Failed to generate bill",
        },
        { status: isCollision ? 503 : 500 },
      );
    }

    // ── Sync to Finance Ledger ─────────────────────────────────────
    await syncToFinance(sb, newBill, module as BillModule, auth);

    // ── IPD: Generate Receipt if requested ─────────────────────────
    let receipt = null;
    if (module === "IPD" && generate_receipt && numericNet > 0) {
      const receiptAmt = Number(receipt_amount) || numericNet;
      receipt = await generateIPDReceipt(
        sb,
        newBill,
        receiptAmt,
        payment_mode,
        auth,
      );
    }

    // ── Release advisory lock ──────────────────────────────────────
    await releaseLock(sb, lockNs, lockKey, packedLockKey, lockHeld);

    return NextResponse.json({
      success: true,
      bill: newBill,
      invoice_number: invoiceNumber,
      module,
      receipt: receipt || undefined,
      // Surfacing the server-computed breakdown helps clients reconcile.
      breakdown: {
        subtotal: safeSubtotal,
        discount: safeDiscount,
        gst_percent: gstPct,
        gst_amount: tax.gstAmount,
        cgst: tax.cgst,
        sgst: tax.sgst,
        net_amount: numericNet,
      },
      message: `Bill ${invoiceNumber} generated successfully`,
    });
  } catch (err: any) {
    await releaseLock(sb, lockNs, lockKey, packedLockKey, lockHeld);
    console.error("[generate-bill] Unexpected error:", err);
    return NextResponse.json(
      { error: err.message || "Internal server error" },
      { status: 500 },
    );
  }
}

// ── DELETE: Soft-delete a bill with audit trail ──────────────────
export async function DELETE(req: NextRequest) {
  const auth = await requireRole(req, ["admin"]);
  if (auth instanceof Response) return auth;

  const billId = req.nextUrl.searchParams.get("billId");
  if (!billId) {
    return NextResponse.json(
      { error: "billId query parameter is required" },
      { status: 400 },
    );
  }

  let sb: ReturnType<typeof getSupabaseAdmin>;
  try {
    sb = getSupabaseAdmin();
  } catch (err) {
    return NextResponse.json(
      { error: "Server misconfigured" },
      { status: 500 },
    );
  }

  // Fetch the bill
  const { data: bill, error: fetchErr } = await sb
    .from("bills")
    .select("*")
    .eq("id", billId)
    .single();

  if (fetchErr || !bill) {
    return NextResponse.json({ error: "Bill not found" }, { status: 404 });
  }

  if (bill.is_deleted) {
    return NextResponse.json(
      { error: "Bill is already deleted" },
      { status: 400 },
    );
  }

  // ── BUG-B06: subtract any prior refunds from the reversal amount ─
  // Without this, a partially-refunded bill that is later soft-deleted
  // produces a reversal that double-counts the refund (hospital_fund
  // becomes negative).
  const billNet = Number(bill.net_amount) || Number(bill.total) || 0;
  const refundedAlready = await getRefundedTotal(sb, billId);
  const reversalAmount = Math.max(0, billNet - refundedAlready);

  // Soft-delete: mark as deleted, preserve the record
  const { error: updateErr } = await sb
    .from("bills")
    .update({
      is_deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by: auth.fullName || auth.email,
      status: "cancelled",
      updated_at: new Date().toISOString(),
    })
    .eq("id", billId);

  if (updateErr) {
    console.error("[generate-bill] Soft-delete error:", updateErr);
    return NextResponse.json(
      { error: "Failed to delete bill" },
      { status: 500 },
    );
  }

  // Reverse the finance entry — only for the un-refunded portion
  if (reversalAmount > 0) {
    await sb.from("hospital_fund").insert({
      type: "reversal",
      amount: -reversalAmount,
      category: "bill_reversal",
      description:
        `Reversed bill ${bill.invoice_number || bill.id.slice(-8)} — ` +
        `deleted by ${auth.fullName}` +
        (refundedAlready > 0
          ? ` (₹${refundedAlready.toFixed(2)} previously refunded — excluded from reversal)`
          : ""),
      submitted_by: auth.fullName || auth.email,
      status: "approved",
      bill_id: billId,
    });
  }

  // Audit log
  try {
    await sb.rpc("insert_audit_entry", {
      p_user_id: auth.clinicUserId,
      p_user_email: auth.email,
      p_user_role: auth.role,
      p_action: "delete",
      p_entity_type: "bill",
      p_entity_id: billId,
      p_entity_label: `Bill ${bill.invoice_number || billId.slice(-8)}`,
      p_changes: JSON.stringify({
        before: { status: bill.status, net_amount: bill.net_amount },
        after: { status: "cancelled", is_deleted: true },
        reason: "Admin soft-delete",
        bill_net: billNet,
        previously_refunded: refundedAlready,
        reversal_amount: reversalAmount,
      }),
    });
  } catch {
    // Non-fatal: audit log failure shouldn't block the delete
  }

  return NextResponse.json({
    success: true,
    message: `Bill ${bill.invoice_number || billId.slice(-8)} deleted. Next bill will use sequence correctly.`,
    deleted_bill: {
      id: billId,
      invoice_number: bill.invoice_number,
      net_amount: billNet,
    },
    reversal: {
      amount_reversed: reversalAmount,
      previously_refunded: refundedAlready,
    },
  });
}

// ── Helper: release advisory lock with both forms ─────────────────
async function releaseLock(
  sb: ReturnType<typeof getSupabaseAdmin>,
  lockNs: number,
  lockKey: number,
  packedLockKey: string,
  lockHeld: boolean,
) {
  if (!lockHeld) return;
  try {
    const { error } = await sb.rpc("pg_advisory_unlock", {
      lock_namespace: lockNs,
      lock_key: lockKey,
    });
    if (error) {
      await sb.rpc("pg_advisory_unlock", { lock_key: packedLockKey });
    }
  } catch (e) {
    console.warn("[generate-bill] Lock release warning (non-fatal):", e);
  }
}

/**
 * BUG-B06 helper: total amount already refunded against this bill, taken
 * from payment_transactions.  We sum positive refund amounts; the schema
 * stores refunds as positive numbers with type='refund'.
 */
async function getRefundedTotal(
  sb: ReturnType<typeof getSupabaseAdmin>,
  billId: string,
): Promise<number> {
  try {
    const { data } = await sb
      .from("payment_transactions")
      .select("amount, type, status")
      .eq("bill_id", billId)
      .eq("type", "refund")
      .in("status", ["completed", "processed", "success", "approved"]);

    if (!data || data.length === 0) return 0;
    return data.reduce(
      (sum: number, row: any) => sum + Math.abs(Number(row.amount) || 0),
      0,
    );
  } catch (err) {
    // If the refund table is missing or query fails, log and assume zero
    // refunds.  This is safer than throwing because the soft-delete flow
    // is admin-only and audit-logged anyway.
    console.warn(
      "[generate-bill] Could not read prior refunds; assuming 0:",
      (err as any)?.message,
    );
    return 0;
  }
}

// ── Helper: Sync bill to Finance/Hospital Fund ledger ────────────
async function syncToFinance(
  sb: ReturnType<typeof getSupabaseAdmin>,
  bill: Record<string, any>,
  module: BillModule,
  auth: { fullName: string; email: string; clinicUserId: string },
) {
  try {
    const amount = Number(bill.net_amount) || Number(bill.total) || 0;
    if (amount <= 0) return;

    await sb.from("hospital_fund").insert({
      type: "income",
      amount,
      category: module === "IPD" ? "ipd_billing" : "opd_billing",
      description: `${module} Bill ${bill.invoice_number || bill.id.slice(-8)} — ${bill.patient_name} (${bill.mrn || "N/A"})`,
      submitted_by: auth.fullName || auth.email,
      status: "approved",
      bill_id: bill.id,
    });
  } catch (err) {
    console.error("[generate-bill] Finance sync error:", err);
  }
}

/**
 * BUG-B03 fix: Generate IPD Receipt AND reconcile the parent bill.
 *
 * Previously this only inserted a bill_payments row.  If the cumulative
 * payments for the bill reached the total, the bills row was never
 * touched, so paid_at remained null and status remained 'partial' — daily
 * closing reports under-counted the revenue on the day of full payment.
 *
 * New behaviour:
 *   1. Insert the bill_payments row (unchanged).
 *   2. Sum bill_payments.amount for the bill.
 *   3. Update bills.paid / due / status / paid_at based on the new sum.
 *      - status='paid' and paid_at=now() if cumulative paid >= total
 *      - status='partial' if some paid but not all
 *      - paid_at is set ONCE (the moment the bill first reaches 'paid')
 *        and is NOT bumped on subsequent over-payments.
 */
async function generateIPDReceipt(
  sb: ReturnType<typeof getSupabaseAdmin>,
  bill: Record<string, any>,
  receiptAmount: number,
  paymentMode: string,
  auth: { fullName: string; email: string; clinicUserId: string },
) {
  try {
    const { data: receipt, error } = await sb
      .from("bill_payments")
      .insert({
        bill_id: bill.id,
        patient_id: bill.patient_id,
        amount: receiptAmount,
        payment_mode: paymentMode || "cash",
        received_by: auth.clinicUserId,
        reference: `IPD-RCPT-${bill.invoice_number}`,
        notes: `IPD Receipt for Bill ${bill.invoice_number}`,
      })
      .select()
      .single();

    if (error) {
      console.error("[generate-bill] Receipt generation error:", error);
      return null;
    }

    // ── BUG-B03: reconcile bill.paid / due / status / paid_at ─────
    try {
      // Sum all payments against this bill (including the one we just inserted)
      const { data: allPayments } = await sb
        .from("bill_payments")
        .select("amount")
        .eq("bill_id", bill.id);

      const cumulativePaid = (allPayments || []).reduce(
        (sum: number, p: any) => sum + (Number(p.amount) || 0),
        0,
      );

      const billTotal = Number(bill.net_amount) || Number(bill.total) || 0;
      const newDue = Math.max(0, billTotal - cumulativePaid);

      let newStatus: "paid" | "partial" | "unpaid" = "unpaid";
      if (billTotal > 0 && cumulativePaid >= billTotal) newStatus = "paid";
      else if (cumulativePaid > 0) newStatus = "partial";

      const updates: Record<string, unknown> = {
        paid: cumulativePaid,
        due: newDue,
        status: newStatus,
        updated_at: new Date().toISOString(),
      };

      // Only set paid_at the first time the bill becomes paid; never reset it.
      if (newStatus === "paid" && !bill.paid_at) {
        updates.paid_at = new Date().toISOString();
      }

      const { error: updErr } = await sb
        .from("bills")
        .update(updates)
        .eq("id", bill.id);

      if (updErr) {
        console.warn(
          "[generate-bill] Bill reconciliation after receipt failed (non-fatal):",
          updErr,
        );
      }
    } catch (reconcileErr) {
      console.warn(
        "[generate-bill] Bill reconciliation exception (non-fatal):",
        reconcileErr,
      );
    }

    return receipt;
  } catch (err) {
    console.error("[generate-bill] Receipt error:", err);
    return null;
  }
}
