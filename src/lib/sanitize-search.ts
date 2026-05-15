/**
 * src/lib/sanitize-search.ts
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE:
 * ────────
 * Prevents SQL/Pattern Injection in Supabase ilike queries.
 * 
 * THE BUG (Bug #9):
 * ─────────────────
 * When a user types in the patient search box, their input goes DIRECTLY
 * into a PostgreSQL ilike pattern like this:
 * 
 *   .or(`full_name.ilike.%${userInput}%`)
 * 
 * If user types just "%" — they see ALL records (bypasses pagination).
 * If user types "_" — it matches any single character (wildcard).
 * If user types "\" — it can break the query entirely.
 * 
 * These are special PostgreSQL pattern characters:
 *   %  = match any sequence of characters (like * in file search)
 *   _  = match exactly one character (like ? in file search)
 *   \  = escape character
 * 
 * WHAT THIS FILE DOES:
 * ────────────────────
 * Provides a function that "escapes" these special characters so they
 * are treated as literal text, not wildcards.
 * 
 * Example:
 *   User types: "Dr. 100% sure"
 *   Without fix: Postgres treats % as "match anything" → returns ALL patients
 *   With fix:    "Dr. 100\% sure" → Postgres searches for literal "100%"
 * 
 * WHERE IT'S USED:
 * ────────────────
 * - src/app/patients/page.tsx (patient list search)
 * - src/app/opd/page.tsx (OPD patient search)
 * - src/app/appointments/page.tsx (appointment patient search)
 * 
 * DOES IT BREAK ANYTHING?
 * ───────────────────────
 * No. Normal text like "Priya", "9876543210", "MRN001" has no special
 * characters, so they pass through unchanged. Only %, _, and \ get escaped.
 */

/**
 * Escapes special PostgreSQL ilike pattern characters from user input.
 * 
 * Call this BEFORE putting user text into an ilike query.
 * 
 * @param input - Raw text from user (search box, filter, etc.)
 * @returns Safe text with %, _, and \ escaped
 * 
 * @example
 * // In a Supabase query:
 * const safe = sanitizeSearchInput(userTypedText)
 * supabase.from('patients').select('*').or(`full_name.ilike.%${safe}%`)
 */
export function sanitizeSearchInput(input: string): string {
  if (!input) return ''

  return input
    // Step 1: Escape backslash FIRST (because we use \ as the escape char)
    .replace(/\\/g, '\\\\')
    // Step 2: Escape % (wildcard "match anything")
    .replace(/%/g, '\\%')
    // Step 3: Escape _ (wildcard "match one character")
    .replace(/_/g, '\\_')
}
