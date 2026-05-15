/**
 * src/lib/appointment-status.ts
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE:
 * ────────
 * Single source of truth for appointment status definitions and filters.
 * 
 * THE BUG (Bug #20):
 * ──────────────────
 * Different modules in the app had DIFFERENT ideas about what counts as
 * "active", "pending", or "completed":
 * 
 *   Dashboard:         neq('status', 'cancelled')  → includes no-show and completed
 *   Appointments page: neq('status', 'cancelled')  → same as dashboard
 *   Reminders API:     neq('cancelled') AND neq('completed')  → excludes both
 *   appointmentService: in('scheduled', 'confirmed')  → excludes completed AND no-show
 *   Follow-up overdue: checks follow_ups.status = 'pending'  → different table entirely
 * 
 * This causes:
 *   - Dashboard "today's appointments" count = 10 (includes completed + no-show)
 *   - Appointments page "today" tab shows 10 (same)
 *   - But reminders only processes 7 (excludes completed/no-show)
 *   - Doctor thinks 10 patients are coming, reminder system only contacts 7
 * 
 * SOLUTION:
 * ─────────
 * Define status groups in ONE place. Each module imports the group it needs:
 *   - ACTIVE_STATUSES:  scheduled, confirmed (patient expected to come)
 *   - ATTENDED_STATUSES: completed (patient came)
 *   - INACTIVE_STATUSES: cancelled, no-show (appointment is dead)
 *   - COUNTABLE_STATUSES: scheduled, confirmed, completed (for "today" counts)
 * 
 * WHERE IT'S USED:
 * ────────────────
 * - Dashboard (today's appointments count)
 * - Appointments page (tab counts)
 * - Reminders API (which appointments get reminders)
 * - appointmentService (which to cancel on reschedule)
 * - Billing reports (which visits actually happened)
 * 
 * DOES IT BREAK ANYTHING?
 * ───────────────────────
 * No. This is a NEW file that defines constants. Existing code continues
 * to work. Over time, each module should import from here instead of
 * hardcoding status arrays. The immediate fix ensures new code is consistent.
 */

// All possible appointment statuses (matches DB CHECK constraint)
export type AppointmentStatus = 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no-show'

/**
 * Patient is expected to arrive — show in queue, send reminders.
 * Use for: reminder generation, queue display, "upcoming" counts
 */
export const ACTIVE_STATUSES: AppointmentStatus[] = ['scheduled', 'confirmed']

/**
 * Patient actually came — counts as a "visit happened".
 * Use for: billing "visits", revenue reports, visit history
 */
export const ATTENDED_STATUSES: AppointmentStatus[] = ['completed']

/**
 * Appointment is dead — don't count, don't remind, don't bill.
 * Use for: exclusion from active lists
 */
export const INACTIVE_STATUSES: AppointmentStatus[] = ['cancelled', 'no-show']

/**
 * Appointments that "count" for today's display on dashboard.
 * Includes completed (patient came) + active (patient expected).
 * Excludes cancelled and no-show.
 * 
 * Use for: Dashboard "Today's Appointments" KPI tile
 */
export const COUNTABLE_STATUSES: AppointmentStatus[] = ['scheduled', 'confirmed', 'completed']

/**
 * Appointments that should receive WhatsApp/SMS reminders.
 * Only scheduled/confirmed — already completed or cancelled don't need reminders.
 * 
 * Use for: /api/reminders/auto-generate, reminder page
 */
export const REMINDABLE_STATUSES: AppointmentStatus[] = ['scheduled', 'confirmed']

/**
 * Appointments that count as "overdue" for follow-up tracking.
 * A no-show with a past date is NOT overdue (they didn't come, it's dead).
 * Only pending (scheduled/confirmed) with past date = genuinely overdue.
 */
export const OVERDUE_ELIGIBLE_STATUSES: AppointmentStatus[] = ['scheduled', 'confirmed']

/**
 * Helper: builds a Supabase filter string for "not cancelled and not no-show"
 * (equivalent to COUNTABLE_STATUSES but as exclusions)
 */
export function excludeInactiveFilter() {
  return { column: 'status', operator: 'in', value: COUNTABLE_STATUSES }
}

/**
 * Display configuration for each status (for UI rendering).
 */
export const STATUS_DISPLAY: Record<AppointmentStatus, {
  label: string
  badgeClass: string
  dotColor: string
  description: string
}> = {
  scheduled: {
    label: 'Scheduled',
    badgeClass: 'bg-blue-50 text-blue-700',
    dotColor: 'bg-blue-500',
    description: 'Appointment booked, awaiting confirmation or visit',
  },
  confirmed: {
    label: 'Confirmed',
    badgeClass: 'bg-green-50 text-green-700',
    dotColor: 'bg-green-500',
    description: 'Patient confirmed they will attend',
  },
  completed: {
    label: 'Completed',
    badgeClass: 'bg-gray-50 text-gray-600',
    dotColor: 'bg-gray-400',
    description: 'Patient visited and consultation happened',
  },
  cancelled: {
    label: 'Cancelled',
    badgeClass: 'bg-red-50 text-red-700',
    dotColor: 'bg-red-400',
    description: 'Appointment was cancelled (by patient or clinic)',
  },
  'no-show': {
    label: 'No Show',
    badgeClass: 'bg-orange-50 text-orange-700',
    dotColor: 'bg-orange-400',
    description: 'Patient did not arrive for their appointment',
  },
}
