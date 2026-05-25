/**
 * src/lib/reference-source-utils.ts
 *
 * ═══════════════════════════════════════════════════════════════════════
 * BUG #5 FIX: Reference Source Field Concatenation Issue
 * ═══════════════════════════════════════════════════════════════════════
 *
 * PROBLEM:
 *   In patients/new/page.tsx, when saving a patient, the code does:
 *
 *     reference_source: form.reference_source
 *       ? (form.reference_detail.trim()
 *         ? `${form.reference_source} — ${form.reference_detail.trim()}`
 *         : form.reference_source)
 *       : null
 *
 *   This concatenates the referral TYPE ("Doctor Referral") and the DETAIL
 *   ("Dr. Sharma, City Hospital") into a single string:
 *     "Doctor Referral — Dr. Sharma, City Hospital"
 *
 *   This makes it IMPOSSIBLE to:
 *     - Filter patients by referral type (e.g., "show all Doctor Referrals")
 *     - Generate analytics on referral sources
 *     - Edit just the detail without re-parsing the string
 *     - Handle edge cases where the detail itself contains " — "
 *
 * EFFECT OF BUG:
 *   - Analytics page cannot accurately group patients by referral source
 *   - Reporting to marketing team on "how patients found us" is unreliable
 *   - Admin cannot filter patients by source type
 *   - If detail contains " — " the split would be ambiguous
 *
 * SOLUTION:
 *   This utility provides:
 *   1. `parseReferenceSource()` — splits existing concatenated values back into parts
 *   2. `formatReferenceSource()` — creates a structured display string
 *   3. `getReferralCategory()` — extracts just the category for filtering
 *   4. `REFERRAL_SOURCES` — canonical list of source types
 *
 *   For new registrations, the registration page should save reference_source
 *   and reference_detail in SEPARATE columns. This utility handles the legacy
 *   concatenated format for existing patients.
 *
 * AFTER FIX:
 *   ✅ Existing concatenated data can be correctly parsed and displayed
 *   ✅ Analytics can group by referral category
 *   ✅ Future registrations can use structured approach
 *   ✅ No data migration needed — works with existing data
 *
 * USAGE:
 *   import { parseReferenceSource, REFERRAL_SOURCES } from '@/lib/reference-source-utils'
 *
 *   // Parse existing patient data:
 *   const { category, detail } = parseReferenceSource(patient.reference_source)
 *   // → { category: "Doctor Referral", detail: "Dr. Sharma, City Hospital" }
 *
 *   // For analytics grouping:
 *   const category = getReferralCategory(patient.reference_source)
 *   // → "Doctor Referral"
 */

// ─── Canonical Referral Source Types ──────────────────────────────────

export const REFERRAL_SOURCES = [
  'Doctor Referral',
  'Patient Referral',
  'Advertisement',
  'Google / Internet',
  'Social Media',
  'Walk-in',
  'Camp / Outreach',
  'Insurance Panel',
  'Emergency / Ambulance',
  'Other',
] as const

export type ReferralSource = typeof REFERRAL_SOURCES[number]

// ─── Parsed Reference ─────────────────────────────────────────────────

export interface ParsedReference {
  /** The referral category (e.g., "Doctor Referral") */
  category: ReferralSource | string
  /** The specific detail (e.g., "Dr. Sharma, City Hospital") */
  detail: string
  /** The original raw value from the database */
  raw: string
  /** Whether this was a concatenated value that needed parsing */
  wasConcatenated: boolean
}

// ─── Separator constant ───────────────────────────────────────────────
// The original code uses " — " (space-em-dash-space) as separator
const SEPARATOR = ' — '
// Alternative separators that might be in legacy data
const ALT_SEPARATORS = [' - ', ' – ', ': ']

/**
 * Parse a reference_source value from the database into its components.
 *
 * Handles both:
 *   - Pure category: "Walk-in"
 *   - Concatenated: "Doctor Referral — Dr. Sharma, City Hospital"
 *   - Legacy formats: "Doctor Referral - Dr. Sharma" or "Doctor Referral: Dr. Sharma"
 *   - Null/empty: returns empty
 *
 * @param raw - The raw reference_source value from the patients table
 * @returns ParsedReference with category and detail split
 */
export function parseReferenceSource(raw: string | null | undefined): ParsedReference {
  if (!raw || !raw.trim()) {
    return { category: '', detail: '', raw: '', wasConcatenated: false }
  }

  const trimmed = raw.trim()

  // Check if it's a known category without any detail
  const exactMatch = REFERRAL_SOURCES.find(
    src => src.toLowerCase() === trimmed.toLowerCase()
  )
  if (exactMatch) {
    return { category: exactMatch, detail: '', raw: trimmed, wasConcatenated: false }
  }

  // Try to split on the primary separator " — "
  if (trimmed.includes(SEPARATOR)) {
    const idx = trimmed.indexOf(SEPARATOR)
    const left = trimmed.substring(0, idx).trim()
    const right = trimmed.substring(idx + SEPARATOR.length).trim()

    // Verify the left part is a known category
    const matchedCategory = REFERRAL_SOURCES.find(
      src => src.toLowerCase() === left.toLowerCase()
    )

    if (matchedCategory) {
      return {
        category: matchedCategory,
        detail: right,
        raw: trimmed,
        wasConcatenated: true,
      }
    }

    // Left part isn't a known category — treat whole thing as detail under "Other"
    return {
      category: 'Other',
      detail: trimmed,
      raw: trimmed,
      wasConcatenated: false,
    }
  }

  // Try alternative separators for legacy data
  for (const sep of ALT_SEPARATORS) {
    if (trimmed.includes(sep)) {
      const idx = trimmed.indexOf(sep)
      const left = trimmed.substring(0, idx).trim()
      const right = trimmed.substring(idx + sep.length).trim()

      const matchedCategory = REFERRAL_SOURCES.find(
        src => src.toLowerCase() === left.toLowerCase()
      )

      if (matchedCategory) {
        return {
          category: matchedCategory,
          detail: right,
          raw: trimmed,
          wasConcatenated: true,
        }
      }
    }
  }

  // Check if it starts with a known category (partial match)
  const startsWithCategory = REFERRAL_SOURCES.find(src =>
    trimmed.toLowerCase().startsWith(src.toLowerCase())
  )

  if (startsWithCategory) {
    const remainder = trimmed.substring(startsWithCategory.length).trim()
    // Remove leading punctuation from remainder
    const cleanDetail = remainder.replace(/^[—\-:,]\s*/, '').trim()
    return {
      category: startsWithCategory,
      detail: cleanDetail,
      raw: trimmed,
      wasConcatenated: cleanDetail.length > 0,
    }
  }

  // Completely unrecognized — put everything as detail under "Other"
  return {
    category: 'Other',
    detail: trimmed,
    raw: trimmed,
    wasConcatenated: false,
  }
}

/**
 * Get just the referral category from a raw reference_source value.
 * Use this for grouping/filtering in analytics.
 *
 * @returns The category string, or 'Unknown' if null/empty
 */
export function getReferralCategory(raw: string | null | undefined): string {
  if (!raw || !raw.trim()) return 'Unknown'
  const parsed = parseReferenceSource(raw)
  return parsed.category || 'Unknown'
}

/**
 * Format a reference source for display in patient lists/cards.
 * Shows category in bold with detail on the side.
 *
 * @returns Formatted display string
 */
export function formatReferenceDisplay(raw: string | null | undefined): string {
  if (!raw || !raw.trim()) return '—'
  const { category, detail } = parseReferenceSource(raw)
  if (!detail) return category
  return `${category} (${detail})`
}

/**
 * Build the reference_source value for saving to database.
 * This maintains backward compatibility with the concatenated format
 * while providing a clean API.
 *
 * For future improvement: save category and detail in separate columns.
 *
 * @param category - The referral source category
 * @param detail - Optional detail/specification
 * @returns String to save in the reference_source column
 */
export function buildReferenceSource(
  category: string | null | undefined,
  detail: string | null | undefined
): string | null {
  if (!category || !category.trim()) return null
  const cat = category.trim()
  const det = detail?.trim()
  if (!det) return cat
  return `${cat}${SEPARATOR}${det}`
}

/**
 * Get referral statistics from a list of patients.
 * Groups patients by referral category for analytics.
 *
 * @param patients - Array of patient objects with reference_source field
 * @returns Map of category → count, sorted by count descending
 */
export function getReferralStats(
  patients: Array<{ reference_source?: string | null }>
): Array<{ category: string; count: number; percentage: number }> {
  const totals: Record<string, number> = {}

  for (const patient of patients) {
    const category = getReferralCategory(patient.reference_source)
    totals[category] = (totals[category] || 0) + 1
  }

  const total = patients.length || 1
  return Object.entries(totals)
    .map(([category, count]) => ({
      category,
      count,
      percentage: Math.round((count / total) * 100),
    }))
    .sort((a, b) => b.count - a.count)
}
