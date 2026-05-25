/**
 * src/lib/daily-closing-ist.ts
 *
 * ═══════════════════════════════════════════════════════════════════════
 * BUG #15 FIX: Daily Closing Timezone Bug
 * ═══════════════════════════════════════════════════════════════════════
 *
 * PROBLEM:
 *   In /api/billing/daily-closing/route.ts, bills are queried with:
 *     .gte('created_at', date + 'T00:00:00')
 *     .lt('created_at', date + 'T23:59:59.999')
 *
 *   But `created_at` is stored in UTC in Postgres, and the date variable
 *   is calculated in IST. The comparison strings have NO timezone suffix.
 *
 *   Example: For date = "2026-05-25" (IST):
 *   - Bills created at 1:00 AM IST (= 2026-05-24T19:30:00Z UTC) are MISSED
 *     because "2026-05-24T19:30:00Z" < "2026-05-25T00:00:00" (no TZ = UTC)
 *   - Bills created at 11:30 PM IST on May 24 (= 2026-05-24T18:00:00Z)
 *     are wrongly included in May 25's closing
 *
 * EFFECT OF BUG:
 *   - Bills created between midnight and 5:30 AM IST are MISSED from
 *     that day's closing (counted in previous day instead)
 *   - Daily revenue totals are incorrect
 *   - Night-shift billing discrepancies
 *   - CA reports don't match daily closings
 *
 * SOLUTION:
 *   This utility provides IST-correct date range functions for queries.
 *   Appends +05:30 timezone offset to date boundaries so Postgres
 *   correctly compares UTC timestamps against IST date boundaries.
 *
 * AFTER FIX:
 *   ✅ Bills at 1:00 AM IST correctly appear in that day's closing
 *   ✅ Daily totals match what the clinic actually billed that day
 *   ✅ Night-shift bills attributed to correct calendar date
 *   ✅ CA report totals align with sum of daily closings
 *
 * USAGE:
 *   // In /api/billing/daily-closing/route.ts, replace:
 *   //   .gte('created_at', date + 'T00:00:00')
 *   //   .lt('created_at', date + 'T23:59:59.999')
 *   // With:
 *   import { getISTDayBounds } from '@/lib/daily-closing-ist'
 *   const { start, end } = getISTDayBounds(date)
 *   .gte('created_at', start)
 *   .lt('created_at', end)
 */

// ── IST offset constant ───────────────────────────────────────────────
// India Standard Time is always UTC+5:30 (no DST)
const IST_OFFSET = '+05:30'

/**
 * Get IST-correct date boundaries for database queries.
 *
 * Given an IST date string "2026-05-25", returns:
 *   start: "2026-05-25T00:00:00+05:30"  (midnight IST = 2026-05-24T18:30:00Z)
 *   end:   "2026-05-26T00:00:00+05:30"  (next midnight IST = 2026-05-25T18:30:00Z)
 *
 * These strings, when compared against UTC `created_at` timestamps in Postgres,
 * correctly match all records from that IST calendar day.
 *
 * @param dateIST - Date string in YYYY-MM-DD format (IST calendar date)
 * @returns Object with `start` and `end` timestamps for use in .gte()/.lt() queries
 */
export function getISTDayBounds(dateIST: string): { start: string; end: string } {
  // Validate input
  if (!dateIST || !/^\d{4}-\d{2}-\d{2}$/.test(dateIST)) {
    throw new Error(`Invalid date format: "${dateIST}". Expected YYYY-MM-DD.`)
  }

  // Start of day in IST
  const start = `${dateIST}T00:00:00${IST_OFFSET}`

  // End of day = start of NEXT day in IST
  const nextDay = getNextDay(dateIST)
  const end = `${nextDay}T00:00:00${IST_OFFSET}`

  return { start, end }
}

/**
 * Get IST-correct date range boundaries for multi-day queries (e.g., CA reports).
 *
 * @param fromDateIST - Start date in YYYY-MM-DD (inclusive)
 * @param toDateIST   - End date in YYYY-MM-DD (inclusive)
 * @returns Timestamps for use in .gte()/.lte() queries
 */
export function getISTDateRange(
  fromDateIST: string,
  toDateIST: string
): { start: string; end: string } {
  if (!fromDateIST || !toDateIST) {
    throw new Error('Both fromDate and toDate are required')
  }

  const start = `${fromDateIST}T00:00:00${IST_OFFSET}`
  const end = `${toDateIST}T23:59:59.999${IST_OFFSET}`

  return { start, end }
}

/**
 * Get current IST date as YYYY-MM-DD.
 * Equivalent to getIndiaToday() from utils.ts but standalone.
 */
export function getTodayIST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

/**
 * Get the next calendar day from a date string.
 */
function getNextDay(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z') // Use noon to avoid DST edge cases
  d.setUTCDate(d.getUTCDate() + 1)
  const year = d.getUTCFullYear()
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Convert a UTC timestamp to IST date string (YYYY-MM-DD).
 * Use this to determine which IST day a UTC timestamp belongs to.
 *
 * Example: "2026-05-24T19:30:00Z" → "2026-05-25" (because 19:30 UTC = 01:00 IST next day)
 */
export function utcToISTDate(utcTimestamp: string): string {
  const d = new Date(utcTimestamp)
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

/**
 * Check if a UTC timestamp falls within an IST calendar day.
 *
 * @param utcTimestamp - The UTC timestamp to check
 * @param dateIST - The IST date to check against (YYYY-MM-DD)
 */
export function isInISTDay(utcTimestamp: string, dateIST: string): boolean {
  return utcToISTDate(utcTimestamp) === dateIST
}

/**
 * Generate the corrected query parameters for the daily closing route.
 * This is a drop-in helper that returns the full query config.
 *
 * USAGE in daily-closing/route.ts:
 *   import { getDailyClosingQuery } from '@/lib/daily-closing-ist'
 *   const { billsFilter, encountersDate, refundsFilter } = getDailyClosingQuery(date)
 *
 *   const { data: bills } = await supabase.from('bills').select('*')
 *     .gte('created_at', billsFilter.start)
 *     .lt('created_at', billsFilter.end)
 */
export function getDailyClosingQuery(dateIST: string) {
  const bounds = getISTDayBounds(dateIST)

  return {
    // For bills and payment_transactions (which use created_at in UTC)
    billsFilter: bounds,
    refundsFilter: bounds,
    // For encounters and ipd_admissions (which use date columns in YYYY-MM-DD)
    encountersDate: dateIST,
    admissionsDate: dateIST,
  }
}