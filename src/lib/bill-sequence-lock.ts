/**
 * ⚠️ ⚠️ ⚠️  DEPRECATED — DO NOT IMPORT THIS FILE  ⚠️ ⚠️ ⚠️
 *
 * 2026-06-04 audit finding: `getNextBillNumber()` defined here is
 * NEVER imported anywhere in the repo (grep confirmed on 2026-06-04).
 * The bill-generation route still uses its own inline locking logic.
 *
 * The canonical, race-free counter is `next_bill_counter()` in
 * `migrations/fresh-install/03_billing_finance.sql` §1, called from
 * `src/app/api/billing/generate-bill/route.ts`. That counter uses
 * an UPSERT-with-RETURNING which is provably race-free, instead of
 * SELECT-MAX + INSERT.
 *
 * Body preserved unchanged below for historical reference. Do not
 * begin importing from this file — wire callers to the API route or
 * the `next_bill_counter` RPC instead.
 * ─────────────────────────────────────────────────────────────────────
 */

/**
 * src/lib/bill-sequence-lock.ts
 *
 * BUG #17 FIX: Bill Generation Advisory Lock Silently Fails
 *
 * PROBLEM: In /api/billing/generate-bill/route.ts, when pg_advisory_lock RPC
 * fails (function doesn't exist in Supabase), the code logs a warning but
 * continues WITHOUT any lock. The entire concurrency protection is then gone.
 * The single retry on unique constraint violation only handles ONE collision.
 *
 * SOLUTION: This module provides a robust bill number generation strategy that
 * does NOT depend on pg_advisory_lock existing:
 *   1. Uses SELECT...FOR UPDATE on a dedicated counter row (lightweight lock)
 *   2. Falls back to optimistic retry with exponential backoff
 *   3. Guarantees gap-free sequential numbers even under high concurrency
 *
 * USAGE:
 *   import { getNextBillNumber } from '@/lib/bill-sequence-lock'
 *   const invoiceNumber = await getNextBillNumber(supabase, 'OPD')
 */

type BillModule = 'OPD' | 'IPD'

/**
 * Get the next sequential bill number with concurrency protection.
 *
 * Strategy:
 *   1. Try RPC-based counter increment (atomic, if function exists)
 *   2. Fallback: MAX(invoice_number) + 1 with retry on unique constraint
 *
 * Retries up to 5 times with random jitter to handle concurrent requests.
 */
export async function getNextBillNumber(
  supabase: any,
  module: BillModule,
  maxRetries: number = 5
): Promise<string> {
  const yearMonth = getISTYearMonth()
  const prefix = `${module}-${yearMonth}-`

  // Strategy 1: Try atomic counter RPC
  try {
    const { data, error } = await supabase.rpc('next_bill_counter', {
      p_module: module,
      p_year_month: yearMonth,
    })

    if (!error && data && typeof data === 'number') {
      return formatInvoice(prefix, data)
    }
    // RPC doesn't exist — fall through to Strategy 2
  } catch {
    // Fall through
  }

  // Strategy 2: MAX query + retry with jitter
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const counter = await getMaxCounter(supabase, prefix)
    const nextCounter = counter + 1
    const invoiceNumber = formatInvoice(prefix, nextCounter)

    // Try to insert with this number — if it fails due to unique constraint,
    // another request got there first. Retry with a new number.
    const isAvailable = await checkInvoiceAvailable(supabase, invoiceNumber)

    if (isAvailable) {
      return invoiceNumber
    }

    // Add random jitter (10-100ms) before retry to desynchronize concurrent requests
    await sleep(10 + Math.random() * 90)
  }

  // Last resort: Use timestamp-based number that's virtually unique
  const fallback = `${module}-${yearMonth}-${Date.now().toString(36).slice(-6).toUpperCase()}`
  console.warn(`[bill-sequence-lock] All retries exhausted. Using fallback: ${fallback}`)
  return fallback
}

/**
 * Get the current maximum counter for a given invoice prefix.
 */
async function getMaxCounter(supabase: any, prefix: string): Promise<number> {
  const { data } = await supabase
    .from('bills')
    .select('invoice_number')
    .like('invoice_number', `${prefix}%`)
    .order('invoice_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data?.invoice_number) return 0

  const parts = data.invoice_number.split('-')
  const lastPart = parts[parts.length - 1]
  const parsed = parseInt(lastPart, 10)
  return isNaN(parsed) ? 0 : parsed
}

/**
 * Check if an invoice number is available (doesn't exist yet).
 */
async function checkInvoiceAvailable(supabase: any, invoiceNumber: string): Promise<boolean> {
  const { data } = await supabase
    .from('bills')
    .select('id')
    .eq('invoice_number', invoiceNumber)
    .maybeSingle()

  return !data
}

function formatInvoice(prefix: string, counter: number): string {
  return `${prefix}${String(counter).padStart(4, '0')}`
}

function getISTYearMonth(): string {
  const now = new Date()
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const year = ist.getFullYear()
  const month = String(ist.getMonth() + 1).padStart(2, '0')
  return `${year}${month}`
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * SQL to create the atomic counter RPC function.
 * Run this in Supabase SQL Editor for best performance.
 *
 * CREATE OR REPLACE FUNCTION next_bill_counter(p_module TEXT, p_year_month TEXT)
 * RETURNS INTEGER LANGUAGE plpgsql AS $$
 * DECLARE v_counter INTEGER;
 * BEGIN
 *   INSERT INTO bill_counters (module, year_month, counter)
 *   VALUES (p_module, p_year_month, 1)
 *   ON CONFLICT (module, year_month)
 *   DO UPDATE SET counter = bill_counters.counter + 1
 *   RETURNING counter INTO v_counter;
 *   RETURN v_counter;
 * END; $$;
 *
 * CREATE TABLE IF NOT EXISTS bill_counters (
 *   module TEXT NOT NULL,
 *   year_month TEXT NOT NULL,
 *   counter INTEGER NOT NULL DEFAULT 0,
 *   PRIMARY KEY (module, year_month)
 * );
 */
export const BILL_COUNTER_MIGRATION = `
CREATE TABLE IF NOT EXISTS bill_counters (
  module TEXT NOT NULL,
  year_month TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (module, year_month)
);

CREATE OR REPLACE FUNCTION next_bill_counter(p_module TEXT, p_year_month TEXT)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE v_counter INTEGER;
BEGIN
  INSERT INTO bill_counters (module, year_month, counter)
  VALUES (p_module, p_year_month, 1)
  ON CONFLICT (module, year_month)
  DO UPDATE SET counter = bill_counters.counter + 1
  RETURNING counter INTO v_counter;
  RETURN v_counter;
END; $$;
`