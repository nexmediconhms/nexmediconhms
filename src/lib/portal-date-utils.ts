/**
 * src/lib/portal-date-utils.ts
 *
 * BUG #19 FIX: Portal Follow-up Booking Wrong Timezone
 *
 * PROBLEM: In /api/portal/book-followup/route.ts, date validation uses:
 *   const today = new Date(); today.setHours(0,0,0,0)
 *   if (apptDate < today) → reject
 *
 * This uses the SERVER's timezone (UTC in most deployments), not IST.
 * A patient in India at 11pm IST (5:30pm UTC same day) could fail to book
 * for "today" because server thinks today already ended.
 *
 * BUG #20 FIX: OPD Height Pre-fill Stale Data for Pediatrics
 *
 * The OPD new consultation page pre-fills height from the last encounter.
 * For growing children, this carries forward outdated height which leads
 * to wrong BMI calculations shown to the doctor.
 *
 * SOLUTION:
 *   - validateFutureDate() uses IST-aware comparison
 *   - shouldPrefillHeight() checks if the data is recent enough and patient is adult
 */

/**
 * Validate that a date string is today or in the future using IST timezone.
 * Use this in server-side routes instead of `new Date(); today.setHours(0,0,0,0)`.
 *
 * @param dateStr - The date to validate (YYYY-MM-DD)
 * @returns { valid: boolean, error?: string }
 */
export function validateFutureDateIST(dateStr: string): { valid: boolean; error?: string } {
  if (!dateStr) {
    return { valid: false, error: 'Date is required' }
  }

  // Get today in IST
  const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

  // Compare as strings (YYYY-MM-DD format is lexicographically comparable)
  if (dateStr < todayIST) {
    return { valid: false, error: 'Cannot book appointments in the past' }
  }

  return { valid: true }
}

/**
 * Get current IST time as HH:MM string.
 * For validating that today's appointments are in the future time-wise.
 */
export function getCurrentTimeIST(): string {
  return new Date().toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/**
 * Full appointment time validation in IST.
 * Checks both date (must be today or future) and time (if today, must be future).
 */
export function validateAppointmentTimeIST(
  dateStr: string,
  timeStr: string
): { valid: boolean; error?: string } {
  const dateCheck = validateFutureDateIST(dateStr)
  if (!dateCheck.valid) return dateCheck

  const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

  // If booking for today, check time is in the future
  if (dateStr === todayIST && timeStr) {
    const nowTime = getCurrentTimeIST()
    if (timeStr <= nowTime) {
      return {
        valid: false,
        error: `Cannot book at ${timeStr} — that time has already passed. Current IST time: ${nowTime}`,
      }
    }
  }

  return { valid: true }
}

// ═══════════════════════════════════════════════════════════════════════
// BUG #20 FIX: Height Pre-fill Staleness Check
// ═══════════════════════════════════════════════════════════════════════

/**
 * Determine if height should be pre-filled from last encounter.
 *
 * Rules:
 *   - Adults (≥18): Always pre-fill (height doesn't change)
 *   - Children (<18): Only pre-fill if last encounter was within 30 days
 *   - If last encounter is older than 30 days for a child, show empty
 *     (force re-measurement as children grow)
 *
 * @param patientAge - Patient's age in years (null if unknown)
 * @param lastEncounterDate - ISO string of when height was last recorded
 * @param lastHeight - The height value from last encounter
 * @returns { shouldPrefill: boolean, value: string, warning?: string }
 */
export function shouldPrefillHeight(
  patientAge: number | null | undefined,
  lastEncounterDate: string | null | undefined,
  lastHeight: string | number | null | undefined
): { shouldPrefill: boolean; value: string; warning?: string } {
  // No height to prefill
  if (!lastHeight) {
    return { shouldPrefill: false, value: '' }
  }

  const heightStr = String(lastHeight)

  // Unknown age — safer to prefill (adult is more common in OB/GYN)
  if (patientAge === null || patientAge === undefined) {
    return { shouldPrefill: true, value: heightStr }
  }

  // Adults (18+): Height is stable, always prefill
  if (patientAge >= 18) {
    return { shouldPrefill: true, value: heightStr }
  }

  // Pediatric patient (<18): Check recency
  if (!lastEncounterDate) {
    // No date info — don't prefill for children (safer)
    return {
      shouldPrefill: false,
      value: '',
      warning: 'Previous height available but may be outdated for growing child. Please re-measure.',
    }
  }

  const daysSinceLastMeasurement = Math.floor(
    (Date.now() - new Date(lastEncounterDate).getTime()) / (1000 * 60 * 60 * 24)
  )

  if (daysSinceLastMeasurement <= 30) {
    // Recent measurement — safe to prefill even for children
    return { shouldPrefill: true, value: heightStr }
  }

  // Stale measurement for a child
  return {
    shouldPrefill: false,
    value: '',
    warning: `Last height (${heightStr} cm) recorded ${daysSinceLastMeasurement} days ago. Please re-measure — child may have grown.`,
  }
}

/**
 * Calculate age from date_of_birth string.
 * Returns null if DOB is not available or invalid.
 */
export function calculateAge(dob: string | null | undefined): number | null {
  if (!dob) return null
  const d = new Date(dob)
  if (isNaN(d.getTime())) return null
  const age = Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
  return age >= 0 && age < 150 ? age : null
}
