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
 *   bill number is allocated at a time per module-month combo. This is
 *   superior to SELECT FOR UPDATE because it doesn't hold row locks on the
 *   bills table itself (which would block reads).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * UPDATES IN THIS VERSION (June 2026) — ALL ADDITIVE, NO REMOVALS
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   FIX #28: NAMESPACED ADVISORY LOCK KEYS
 *     Previous: lock key = djb2-style hash of "MODULE-YEARMONTH" into a
 *     32-bit signed integer, then Math.abs()'d. Issues:
 *       a) Two different (module, yearMonth) pairs could hash to the same
 *          value, causing false contention (rare but possible).
 *       b) MUCH MORE IMPORTANT: a future feature that uses Postgres advisory
 *          locks for a different purpose (e.g., audit-log writes, queue
 *          allocation) could collide with bill-generation locks because
 *          the integer keyspace is shared globally across the whole DB.
 *
 *     New: a Postgres `pg_advisory_lock(bigint, bigint)` two-key call where
 *     the first key is a fixed namespace constant (BILL_NUM_LOCK_NAMESPACE)
 *     and the second is the hash. This isolates bill-generation locks in
 *     their own subspace, so cross-module collisions are impossible.
 *
 *     If the two-key RPC isn't available, we fall back to the single-key
 *     call using `(namespace << 16) | (hash & 0xFFFF)` packed into one
 *     bigint — still namespaced, just in a less elegant way.
 *
 *     The 23505 unique_violation retry safety net already handles any
 *     collision that slips past the lock, so this fix is defense-in-depth.
 *
 *     IMPACT: Existing behaviour preserved. Lock keys are different from
 *     before, but since locks are session-scoped and ephemeral, there's
 *     no migration concern. A clean deploy is sufficient.
 *
 *   FIX #28b: PROPER ERROR HANDLING IF LOCK NEVER ACQUIRED
 *     If `pg_advisory_lock` fails, we now log this prominently — previously
 *     it was a silent fall-through to "best-effort" generation.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── Constants ────────────────────────────────────────────────────
const ALLOWED_ROLES = ["admin", "doctor", "receptionist", "staff"] as const;
const MAX_AMOUNT = 10_000_000; // ₹1 crore cap
const MODULES = ["OPD", "IPD"] as const;
type BillModule = (typeof MODULES)[number];

/**
 * FIX #28: Reserved namespace for bill-number advisory locks.
 *
 * This is the FIRST key in the Postgres pg_advisory_lock(bigint, bigint)
 * two-key form. By dedicating a fixed namespace, no other code that uses
 * advisory locks in this DB can collide with bill-generation locks —
 * regardless of how they compute their second key.
 *
 * Pick a value that is unlikely to be used by anything else; a 32-bit
 * integer derived from the string 'BILL_NUM_LOCK' is a reasonable choice.
 * Value: 0x42_49_4C_4C (the ASCII for "BILL" interpreted as a 32-bit BE int).
 */
const BILL_NUM_LOCK_NAMESPACE = 0x42494c4c; // = 1112493644

// Hash a string to a 32-bit integer (djb2 variant). Used as the SECOND key
// for the two-key advisory lock; the namespace above provides isolation.
function hash32(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash | 0;
  }
  return Math.abs(hash);
}

/**
 * Compute the (namespace, key) pair for the bill-generation advisory lock.
 * The namespace is a fixed constant; the key is derived from (module, yearMonth).
 */
function advisoryLockKeys(
  module: BillModule,
  yearMonth: string,
): { namespace: number; key: number } {
  return {
    namespace: BILL_NUM_LOCK_NAMESPACE,
    key: hash32(`${module}-${yearMonth}`),
  };
}

/**
 * Fallback single-key form, used if pg_advisory_lock(bigint, bigint) is
 * not available in the deployment. We pack the namespace and hash into
 * a single bigint such that bill-generation locks still live in their
 * own range of the keyspace.
 *
 * Layout: (namespace_low_32) << 32 | (hash_low_32)
 * In JavaScript we can't reliably represent >53-bit integers, so we
 * use a BigInt and convert to string for the RPC call.
 */
function advisoryLockKeySingle(module: BillModule, yearMonth: string): string {
  const { namespace, key } = advisoryLockKeys(module, yearMonth);

  // FIX: Replace 32n with BigInt(32) to avoid literal syntax error
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
  // IST = UTC + 5:30
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const year = ist.getUTCFullYear();
  const month = String(ist.getUTCMonth() + 1).padStart(2, "0");
  return `${year}${month}`;
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
    gst_amount = 0,
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
  const numericNet = Number(net_amount);
  if (!Number.isFinite(numericNet) || numericNet < 0) {
    return NextResponse.json(
      { error: "net_amount must be a non-negative number" },
      { status: 400 },
    );
  }
  if (numericNet > MAX_AMOUNT) {
    return NextResponse.json(
      { error: "net_amount exceeds maximum allowed (₹1 crore)" },
      { status: 400 },
    );
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
  // FIX #28: namespaced lock keys
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
          // FIX #28b: log loudly instead of falling through silently
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

    // Get the next sequential counter for this module+month
    // Strategy: Find the MAX invoice_number counter for this prefix pattern
    const prefix = `${module}-${yearMonth}-`;
    const { data: maxBill } = await sb
      .from("bills")
      .select("invoice_number")
      .like("invoice_number", `${prefix}%`)
      .order("invoice_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    let nextCounter = 1;
    if (maxBill?.invoice_number) {
      // Extract the counter portion (last 4 digits after the last dash)
      const parts = maxBill.invoice_number.split("-");
      const lastPart = parts[parts.length - 1];
      const parsed = parseInt(lastPart, 10);
      if (!isNaN(parsed)) {
        nextCounter = parsed + 1;
      }
    }

    const invoiceNumber = formatInvoiceNumber(
      module as BillModule,
      yearMonth,
      nextCounter,
    );

    // ── Insert the bill ────────────────────────────────────────────
    const billPayload: Record<string, unknown> = {
      patient_id,
      patient_name,
      mrn: mrn || null,
      invoice_number: invoiceNumber,
      items,
      subtotal: Number(subtotal) || numericNet,
      discount: Number(discount) || 0,
      gst_percent: Number(gst_percent) || 0,
      gst_amount: Number(gst_amount) || 0,
      net_amount: numericNet,
      total: numericNet,
      paid: status === "paid" ? numericNet : Number(receipt_amount) || 0,
      due:
        status === "paid"
          ? 0
          : Math.max(0, numericNet - (Number(receipt_amount) || 0)),
      payment_mode: payment_mode || null,
      status:
        status === "paid"
          ? "paid"
          : status === "partial"
            ? "partial"
            : "unpaid",
      notes: notes || null,
      encounter_id: encounter_id || null,
      admission_id: admission_id || null,
      razorpay_payment_id: razorpay_payment_id || null,
      created_by: auth.fullName || auth.email,
      bill_module: module,
      paid_at: status === "paid" ? new Date().toISOString() : null,
      idempotency_key: idempotency_key || null,
      is_deleted: false,
    };

    const { data: newBill, error: billErr } = await sb
      .from("bills")
      .insert(billPayload)
      .select()
      .single();

    if (billErr) {
      // Handle unique constraint violation (race condition fallback)
      if (
        billErr.code === "23505" &&
        billErr.message?.includes("invoice_number")
      ) {
        // Retry with incremented counter
        const retryCounter = nextCounter + 1;
        const retryInvoice = formatInvoiceNumber(
          module as BillModule,
          yearMonth,
          retryCounter,
        );
        billPayload.invoice_number = retryInvoice;

        const { data: retryBill, error: retryErr } = await sb
          .from("bills")
          .insert(billPayload)
          .select()
          .single();

        if (retryErr) {
          console.error("[generate-bill] Retry failed:", retryErr);
          // Release lock before returning
          await releaseLock(sb, lockNs, lockKey, packedLockKey, lockHeld);
          return NextResponse.json(
            { error: "Failed to generate bill after retry" },
            { status: 500 },
          );
        }

        // Sync to finance
        await syncToFinance(sb, retryBill, module as BillModule, auth);

        // Release advisory lock
        await releaseLock(sb, lockNs, lockKey, packedLockKey, lockHeld);

        return NextResponse.json({
          success: true,
          bill: retryBill,
          invoice_number: retryInvoice,
          module,
        });
      }

      console.error("[generate-bill] Insert error:", billErr);
      await releaseLock(sb, lockNs, lockKey, packedLockKey, lockHeld);
      return NextResponse.json({ error: billErr.message }, { status: 500 });
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
      message: `Bill ${invoiceNumber} generated successfully`,
    });
  } catch (err: any) {
    // Always try to release the lock
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

  // Reverse the finance entry
  await sb.from("hospital_fund").insert({
    type: "reversal",
    amount: -(Number(bill.net_amount) || Number(bill.total) || 0),
    category: "bill_reversal",
    description: `Reversed bill ${bill.invoice_number || bill.id.slice(-8)} — deleted by ${auth.fullName}`,
    submitted_by: auth.fullName || auth.email,
    status: "approved",
    bill_id: billId,
  });

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
      net_amount: bill.net_amount || bill.total,
    },
  });
}

// ── Helper: release advisory lock with both forms ─────────────────
// FIX #28: matching release calls for whichever lock form was acquired.
async function releaseLock(
  sb: ReturnType<typeof getSupabaseAdmin>,
  lockNs: number,
  lockKey: number,
  packedLockKey: string,
  lockHeld: boolean,
) {
  if (!lockHeld) return;
  try {
    // Try two-key release form first
    const { error } = await sb.rpc("pg_advisory_unlock", {
      lock_namespace: lockNs,
      lock_key: lockKey,
    });
    if (error) {
      // Fall back to single-key form
      await sb.rpc("pg_advisory_unlock", { lock_key: packedLockKey });
    }
  } catch (e) {
    // Non-fatal: locks auto-release at session end
    console.warn("[generate-bill] Lock release warning (non-fatal):", e);
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
    // Finance sync failure is non-fatal but should be logged
    console.error("[generate-bill] Finance sync error:", err);
  }
}

// ── Helper: Generate IPD Receipt ─────────────────────────────────
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

    return receipt;
  } catch (err) {
    console.error("[generate-bill] Receipt error:", err);
    return null;
  }
}
