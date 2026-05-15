/**
 * src/lib/date-utils.ts
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE:
 * ────────
 * Provides date/time helpers that always work in Indian Standard Time (IST).
 * 
 * THE BUG (Bug #19):
 * ──────────────────
 * The old code used this everywhere:
 * 
 *   const today = new Date().toISOString().split('T')[0]
 * 
 * This looks harmless but is WRONG for India:
 * 
 *   - toISOString() always returns UTC (Greenwich, UK timezone)
 *   - IST is UTC+5:30 (5 hours 30 minutes AHEAD of UTC)
 *   - Between 12:00 AM and 5:30 AM IST, the UTC date is YESTERDAY
 * 
 * REAL EXAMPLE:
 * ─────────────
 *   Indian time: January 15, 2025 at 2:00 AM IST
 *   UTC time:    January 14, 2025 at 8:30 PM UTC
 *   
 *   Old code:  new Date().toISOString() = "2025-01-14T20:30:00.000Z"
 *              .split('T')[0] = "2025-01-14" ← WRONG! It's Jan 15 in India!
 *   
 *   New code:  getTodayIST() = "2025-01-15" ← CORRECT!
 * 
 * IMPACT IN REAL CLINIC:
 * ──────────────────────
 * - Receptionist registers patients at 1 AM (night shift) → dashboard says 0 today
 * - OPD queue shows empty between midnight and 5:30 AM
 * - Revenue calculation shows yesterday's revenue as today's
 * - Follow-up reminders fire on the wrong day
 * 
 * WHERE IT'S USED:
 * ────────────────
 * - src/app/dashboard/page.tsx (all "today" stats)
 * - src/app/opd/new/page.tsx (encounter_date)
 * - src/app/appointments/page.tsx (today filter)
 * - src/lib/services/appointmentService.ts (visit completion)
 * - Any place that needs "today's date" for India
 * 
 * DOES IT BREAK ANYTHING?
 * ───────────────────────
 * No. For 19 hours of the day (5:30 AM to midnight), the IST date and UTC date
 * are the SAME. This fix only changes behavior during the 5.5 hours around midnight
 * where it was previously wrong. All other functionality remains identical.
 * 
 * HOW TO USE:
 * ───────────
 * Replace: const today = new Date().toISOString().split('T')[0]
 * With:    const today = getTodayIST()
 * 
 * Replace: new Date(someDate).toISOString().split('T')[0]
 * With:    toISTDateString(someDate)
 */

// IST is UTC + 5 hours 30 minutes = 330 minutes
const IST_OFFSET_MINUTES = 330

/**
 * Get today's date in IST as a YYYY-MM-DD string.
 * 
 * This is the CORRECT replacement for:
 *   new Date().toISOString().split('T')[0]  ← WRONG (gives UTC date)
 * 
 * @returns Today's date in India, e.g. "2025-01-15"
 */
export function getTodayIST(): string {
  const now = new Date()
  // Add IST offset to get the IST-equivalent time, then extract date part
  const istTime = new Date(now.getTime() + (IST_OFFSET_MINUTES - now.getTimezoneOffset()) * 60 * 1000)
  return istTime.toISOString().split('T')[0]
}

/**
 * Convert any date to its IST YYYY-MM-DD string.
 * 
 * @param input - Date object, ISO string, or date string
 * @returns The date in IST, e.g. "2025-01-15"
 */
export function toISTDateString(input: Date | string): string {
  const d = typeof input === 'string' ? new Date(input) : input
  if (isNaN(d.getTime())) return ''
  const istTime = new Date(d.getTime() + (IST_OFFSET_MINUTES - d.getTimezoneOffset()) * 60 * 1000)
  return istTime.toISOString().split('T')[0]
}

/**
 * Get the UTC boundaries for a given IST date.
 * 
 * WHY: When querying timestamps stored in UTC (like `created_at`),
 * you need to know what UTC range corresponds to "today in India".
 * 
 * Example: For IST date "2025-01-15":
 *   start = "2025-01-14T18:30:00.000Z" (midnight IST = 6:30 PM prev day UTC)
 *   end   = "2025-01-15T18:30:00.000Z" (next midnight IST)
 * 
 * Usage in Supabase queries:
 *   const bounds = getISTDayBoundsUTC('2025-01-15')
 *   supabase.from('bills').select('*')
 *     .gte('created_at', bounds.start)
 *     .lt('created_at', bounds.end)
 * 
 * @param dateStr - Optional YYYY-MM-DD string (defaults to today IST)
 * @returns { start, end } as ISO timestamp strings in UTC
 */
export function getISTDayBoundsUTC(dateStr?: string): { start: string; end: string } {
  const target = dateStr || getTodayIST()
  
  // Midnight IST on that date = that date at 00:00:00+05:30
  const startUTC = new Date(`${target}T00:00:00+05:30`)
  // Next midnight IST = 24 hours later
  const endUTC = new Date(startUTC.getTime() + 24 * 60 * 60 * 1000)

  return {
    start: startUTC.toISOString(),
    end: endUTC.toISOString(),
  }
}

/**
 * Get tomorrow's date in IST as YYYY-MM-DD string.
 * Useful for follow-up minimum date calculations.
 */
export function getTomorrowIST(): string {
  const now = new Date()
  const istTime = new Date(now.getTime() + (IST_OFFSET_MINUTES - now.getTimezoneOffset()) * 60 * 1000)
  istTime.setUTCDate(istTime.getUTCDate() + 1)
  return istTime.toISOString().split('T')[0]
}

/**
 * Check if a given date string is "today" in IST.
 * Works with both YYYY-MM-DD strings and full ISO timestamps.
 */
export function isTodayIST(dateStr: string): boolean {
  if (!dateStr) return false
  const today = getTodayIST()
  
  // If it's already a YYYY-MM-DD string, compare directly
  if (dateStr.length === 10) return dateStr === today
  
  // If it's a full timestamp, convert to IST date first
  return toISTDateString(dateStr) === today
}
