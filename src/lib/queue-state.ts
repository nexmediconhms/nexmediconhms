/**
 * src/lib/queue-state.ts
 *
 * Queue-status state machine (§3.2 of audit fixes).
 *
 * Existing behaviour (preserved):
 *   - The `opd_queue.status` column accepts:
 *     'waiting' | 'vitals_done' | 'in_progress' | 'done' | 'completed' | 'cancelled' | 'skipped'
 *
 * New behaviour added by this module:
 *   - canTransition(from, to)  → boolean — checks if the transition is sane
 *     (e.g. 'done' → 'waiting' is rejected; reception cannot accidentally
 *      reopen a finished consultation)
 *   - allowedNextStates(from) → array — useful for rendering UI buttons
 *
 * The page's `updateStatus()` callers should pass `expectedPrev` to the
 * Supabase update so two staff acting on the same token can't both win
 * (last-write-wins is replaced with optimistic concurrency):
 *
 *   await supabase.from('opd_queue')
 *     .update({ status: newStatus })
 *     .eq('id', entry.id)
 *     .eq('status', expectedPrev)   // ← only update if status is still what we read
 *
 * If 0 rows are affected, another user moved the token first; the UI
 * should refresh and re-evaluate.
 */

export type QueueStatus =
  | 'waiting'
  | 'vitals_done'
  | 'in_progress'
  | 'done'
  | 'completed'
  | 'cancelled'
  | 'skipped'

/**
 * Allowed transitions table (forwards-only, with sensible exceptions):
 *
 *                          ┌→ vitals_done ─→ in_progress ─→ done/completed
 *                          │                       │
 *   waiting ──────────────┤                       └→ skipped (called but didn't show)
 *                          │
 *                          └→ in_progress (no vitals taken — e.g. follow-up)
 *
 *   waiting / vitals_done / in_progress  ─→  cancelled   (any time)
 *   in_progress                          ─→  waiting     (recall — DOCTOR-only operation;
 *                                                          implementations should restrict this)
 *
 * Terminal states (cannot transition out of):
 *   done, completed, cancelled, skipped
 */
const ALLOWED: Record<QueueStatus, QueueStatus[]> = {
  waiting:     ['vitals_done', 'in_progress', 'cancelled', 'skipped'],
  vitals_done: ['in_progress', 'cancelled'],
  in_progress: ['done', 'completed', 'cancelled', 'waiting' /* recall */],
  done:        [],
  completed:   [],
  cancelled:   [],
  skipped:     ['waiting' /* no-show patient came back later */],
}

const TERMINAL: ReadonlySet<QueueStatus> = new Set(['done', 'completed', 'cancelled'])

export function isValidQueueStatus(s: string | undefined | null): s is QueueStatus {
  return !!s && (s in ALLOWED)
}

export function isTerminal(status: QueueStatus): boolean {
  return TERMINAL.has(status)
}

export function canTransition(from: QueueStatus, to: QueueStatus): boolean {
  if (from === to) return true // idempotent — re-applying same status is OK
  return ALLOWED[from].includes(to)
}

export function allowedNextStates(from: QueueStatus): QueueStatus[] {
  return ALLOWED[from].slice()
}

/**
 * Human-friendly error message for an attempted invalid transition.
 * Used by callers that want to surface "why" to the user.
 */
export function transitionErrorMessage(from: QueueStatus, to: QueueStatus): string | null {
  if (canTransition(from, to)) return null
  if (TERMINAL.has(from)) {
    return `Cannot change a ${from} entry. Re-add the patient to the queue if needed.`
  }
  return `Invalid status transition: ${from} → ${to}. Allowed: ${ALLOWED[from].join(', ')}`
}
