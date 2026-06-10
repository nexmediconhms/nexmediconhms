/**
 * src/lib/queue-status.ts
 *
 * OPD Queue status constants, flow definitions, and helper functions.
 *
 * QUEUE FLOW (Indian Gynaecologist Clinic):
 *   registered → vitals_in_progress → vitals_done → with_doctor
 *     → consultation_done → at_pharmacy → at_billing → completed
 *
 * SIDE STATUSES:
 *   skipped  — patient not present when called, can be recalled
 *   recalled — previously skipped, brought back into queue
 *   cancelled — removed from queue
 *   no_show   — never showed up (end-of-day cleanup)
 *   admitted_to_ipd — patient admitted, OPD visit closes
 *
 * NON-BREAKING:
 *   Existing code that uses simple 'waiting' / 'in_progress' / 'done'
 *   still works. This module adds NEW statuses; old ones remain valid.
 */

// ─── Status Constants ───────────────────────────────────────────────────────

export const QUEUE_STATUS = {
  /** Patient registered and added to queue */
  REGISTERED: 'registered',
  /** Nurse/staff is recording vitals */
  VITALS_IN_PROGRESS: 'vitals_in_progress',
  /** Vitals captured, waiting for doctor */
  VITALS_DONE: 'vitals_done',
  /** Doctor has called the patient */
  WITH_DOCTOR: 'with_doctor',
  /** Doctor finished consultation */
  CONSULTATION_DONE: 'consultation_done',
  /** Patient at pharmacy collecting medicines */
  AT_PHARMACY: 'at_pharmacy',
  /** Patient at billing counter */
  AT_BILLING: 'at_billing',
  /** Entire OPD visit completed */
  COMPLETED: 'completed',
  /** Patient skipped (not present when called) */
  SKIPPED: 'skipped',
  /** Previously skipped patient recalled */
  RECALLED: 'recalled',
  /** Removed from queue */
  CANCELLED: 'cancelled',
  /** Never showed up */
  NO_SHOW: 'no_show',
  /** Admitted to IPD from OPD */
  ADMITTED_TO_IPD: 'admitted_to_ipd',

  // Legacy statuses (backward compat with existing code)
  WAITING: 'waiting',
  IN_PROGRESS: 'in_progress',
  DONE: 'done',
} as const;

export type QueueStatus = (typeof QUEUE_STATUS)[keyof typeof QUEUE_STATUS];

// ─── Status Display Config ──────────────────────────────────────────────────

export interface QueueStatusConfig {
  label: string;
  color: string;        // Tailwind text color
  bgColor: string;      // Tailwind bg color
  icon: string;         // emoji or icon identifier
  isActive: boolean;    // patient is still in the clinic
  isTerminal: boolean;  // visit is finished
}

export const QUEUE_STATUS_CONFIG: Record<string, QueueStatusConfig> = {
  [QUEUE_STATUS.REGISTERED]: {
    label: 'Registered',
    color: 'text-blue-700',
    bgColor: 'bg-blue-50',
    icon: '📋',
    isActive: true,
    isTerminal: false,
  },
  [QUEUE_STATUS.VITALS_IN_PROGRESS]: {
    label: 'Vitals In Progress',
    color: 'text-orange-700',
    bgColor: 'bg-orange-50',
    icon: '🩺',
    isActive: true,
    isTerminal: false,
  },
  [QUEUE_STATUS.VITALS_DONE]: {
    label: 'Vitals Done',
    color: 'text-indigo-700',
    bgColor: 'bg-indigo-50',
    icon: '✅',
    isActive: true,
    isTerminal: false,
  },
  [QUEUE_STATUS.WITH_DOCTOR]: {
    label: 'With Doctor',
    color: 'text-green-700',
    bgColor: 'bg-green-50',
    icon: '👩‍⚕️',
    isActive: true,
    isTerminal: false,
  },
  [QUEUE_STATUS.CONSULTATION_DONE]: {
    label: 'Consultation Done',
    color: 'text-teal-700',
    bgColor: 'bg-teal-50',
    icon: '📝',
    isActive: true,
    isTerminal: false,
  },
  [QUEUE_STATUS.AT_PHARMACY]: {
    label: 'At Pharmacy',
    color: 'text-purple-700',
    bgColor: 'bg-purple-50',
    icon: '💊',
    isActive: true,
    isTerminal: false,
  },
  [QUEUE_STATUS.AT_BILLING]: {
    label: 'At Billing',
    color: 'text-yellow-700',
    bgColor: 'bg-yellow-50',
    icon: '🧾',
    isActive: true,
    isTerminal: false,
  },
  [QUEUE_STATUS.COMPLETED]: {
    label: 'Completed',
    color: 'text-gray-700',
    bgColor: 'bg-gray-100',
    icon: '✅',
    isActive: false,
    isTerminal: true,
  },
  [QUEUE_STATUS.SKIPPED]: {
    label: 'Skipped',
    color: 'text-red-600',
    bgColor: 'bg-red-50',
    icon: '⏭️',
    isActive: true,
    isTerminal: false,
  },
  [QUEUE_STATUS.RECALLED]: {
    label: 'Recalled',
    color: 'text-amber-700',
    bgColor: 'bg-amber-50',
    icon: '🔔',
    isActive: true,
    isTerminal: false,
  },
  [QUEUE_STATUS.CANCELLED]: {
    label: 'Cancelled',
    color: 'text-gray-500',
    bgColor: 'bg-gray-50',
    icon: '❌',
    isActive: false,
    isTerminal: true,
  },
  [QUEUE_STATUS.NO_SHOW]: {
    label: 'No Show',
    color: 'text-gray-400',
    bgColor: 'bg-gray-50',
    icon: '🚫',
    isActive: false,
    isTerminal: true,
  },
  [QUEUE_STATUS.ADMITTED_TO_IPD]: {
    label: 'Admitted to IPD',
    color: 'text-pink-700',
    bgColor: 'bg-pink-50',
    icon: '🏥',
    isActive: false,
    isTerminal: true,
  },
  // Legacy statuses
  [QUEUE_STATUS.WAITING]: {
    label: 'Waiting',
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    icon: '⏳',
    isActive: true,
    isTerminal: false,
  },
  [QUEUE_STATUS.IN_PROGRESS]: {
    label: 'In Progress',
    color: 'text-green-600',
    bgColor: 'bg-green-50',
    icon: '🔄',
    isActive: true,
    isTerminal: false,
  },
  [QUEUE_STATUS.DONE]: {
    label: 'Done',
    color: 'text-gray-600',
    bgColor: 'bg-gray-100',
    icon: '✅',
    isActive: false,
    isTerminal: true,
  },
};

// ─── Valid Transitions ──────────────────────────────────────────────────────
// Defines which status can transition to which. Prevents invalid jumps.

export const VALID_TRANSITIONS: Record<string, string[]> = {
  [QUEUE_STATUS.REGISTERED]:         ['vitals_in_progress', 'with_doctor', 'skipped', 'cancelled', 'no_show', 'waiting', 'in_progress'],
  [QUEUE_STATUS.VITALS_IN_PROGRESS]: ['vitals_done', 'registered', 'skipped', 'cancelled'],
  [QUEUE_STATUS.VITALS_DONE]:        ['with_doctor', 'skipped', 'cancelled', 'in_progress'],
  [QUEUE_STATUS.WITH_DOCTOR]:        ['consultation_done', 'skipped', 'admitted_to_ipd'],
  [QUEUE_STATUS.CONSULTATION_DONE]:  ['at_pharmacy', 'at_billing', 'completed', 'done'],
  [QUEUE_STATUS.AT_PHARMACY]:        ['at_billing', 'completed', 'done'],
  [QUEUE_STATUS.AT_BILLING]:         ['completed', 'done'],
  [QUEUE_STATUS.COMPLETED]:          [],  // terminal
  [QUEUE_STATUS.SKIPPED]:            ['recalled', 'cancelled', 'no_show'],
  [QUEUE_STATUS.RECALLED]:           ['vitals_in_progress', 'vitals_done', 'with_doctor', 'registered', 'waiting'],
  [QUEUE_STATUS.CANCELLED]:          [],  // terminal
  [QUEUE_STATUS.NO_SHOW]:            [],  // terminal
  [QUEUE_STATUS.ADMITTED_TO_IPD]:    [],  // terminal

  // Legacy
  [QUEUE_STATUS.WAITING]:            ['in_progress', 'vitals_in_progress', 'with_doctor', 'done', 'skipped', 'cancelled'],
  [QUEUE_STATUS.IN_PROGRESS]:        ['done', 'consultation_done', 'completed', 'skipped', 'admitted_to_ipd'],
  [QUEUE_STATUS.DONE]:               [],  // terminal
};

// ─── Helper Functions ───────────────────────────────────────────────────────

/**
 * Check if a status transition is valid.
 */
export function isValidTransition(from: string, to: string): boolean {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed) return true; // unknown status = allow (backward compat)
  return allowed.includes(to);
}

/**
 * Get display config for a status. Returns a safe default for unknown statuses.
 */
export function getStatusConfig(status: string): QueueStatusConfig {
  return QUEUE_STATUS_CONFIG[status] || {
    label: status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    color: 'text-gray-600',
    bgColor: 'bg-gray-50',
    icon: '❓',
    isActive: false,
    isTerminal: false,
  };
}

/**
 * Get list of active (non-terminal) statuses for filtering.
 */
export function getActiveStatuses(): string[] {
  return Object.entries(QUEUE_STATUS_CONFIG)
    .filter(([, cfg]) => cfg.isActive)
    .map(([status]) => status);
}

/**
 * Map legacy status to new status (backward compat).
 * Existing code using 'waiting'/'in_progress'/'done' continues to work.
 */
export function normalizeLegacyStatus(status: string): string {
  // Legacy statuses are still valid; this function just helps
  // if you want to progressively migrate
  switch (status) {
    case 'waiting':     return QUEUE_STATUS.REGISTERED;
    case 'in_progress': return QUEUE_STATUS.WITH_DOCTOR;
    case 'done':        return QUEUE_STATUS.COMPLETED;
    default:            return status;
  }
}

/**
 * Get next suggested status(es) for a given current status.
 * Used to show "Next Step" buttons in the queue UI.
 */
export function getNextStatuses(currentStatus: string): string[] {
  const transitions = VALID_TRANSITIONS[currentStatus];
  if (!transitions) return [];
  // Filter out skip/cancel — show only forward-flow statuses
  return transitions.filter(s =>
    s !== 'skipped' && s !== 'cancelled' && s !== 'no_show' &&
    s !== 'waiting' && s !== 'in_progress' && s !== 'done'
  );
}

/**
 * Check if a patient's queue entry is still "active" (hasn't left).
 */
export function isQueueEntryActive(status: string): boolean {
  const cfg = getStatusConfig(status);
  return cfg.isActive;
}
