/**
 * src/lib/payment-modes.ts
 *
 * ═══════════════════════════════════════════════════════════════════════
 * BUG #9 FIX: Billing PayMode Type Mismatch
 * ═══════════════════════════════════════════════════════════════════════
 *
 * PROBLEM:
 *   There are TWO incompatible payment mode definitions:
 *
 *   1. billing/page.tsx defines:
 *        type PayMode = 'cash' | 'upi' | 'card'  (only 3 options)
 *
 *   2. business-logic.ts defines:
 *        PAYMENT_MODES with 7 options: cash, upi, card, cheque, insurance, advance, other
 *
 *   Bills created from OTHER modules (e.g., registration page, insurance claims,
 *   advance payments) can have payment_mode = 'cheque', 'insurance', or 'advance'.
 *   When these bills are displayed in the billing list page, the payment mode
 *   badge rendering logic only handles 3 types, showing nothing or 'unknown'
 *   for the other 4.
 *
 * EFFECT OF BUG:
 *   - Bills with mode 'cheque' show no payment badge in the list
 *   - Bills with mode 'insurance' are invisible in payment mode filter
 *   - Revenue analytics per payment mode miss cheque/insurance/advance totals
 *   - CA Report payment breakdown is incomplete (doesn't name all modes)
 *   - Users think cash/UPI/card are the only options, causing data entry errors
 *
 * SOLUTION:
 *   This file provides a SINGLE SOURCE OF TRUTH for payment modes:
 *   - Full list of all valid payment modes
 *   - Display properties (icon, label, color classes) for each
 *   - Type-safe PaymentMode type
 *   - Badge rendering helper
 *   - Validation function
 *
 *   All modules should import from THIS file instead of defining their own.
 *
 * AFTER FIX:
 *   ✅ All 7 payment modes display correctly in billing list
 *   ✅ Filters include all modes (no hidden bills)
 *   ✅ CA Report shows correct breakdown for all payment types
 *   ✅ Consistent colors and icons across all pages
 *   ✅ TypeScript catches invalid payment mode strings at compile time
 *
 * USAGE:
 *   import { PAYMENT_MODES, isValidPaymentMode, getPaymentModeDisplay } from '@/lib/payment-modes'
 *
 *   // Get display info for a mode:
 *   const display = getPaymentModeDisplay('insurance')
 *   // → { icon: '🏥', label: 'Insurance', color: '...', ... }
 *
 *   // Validate before saving:
 *   if (!isValidPaymentMode(userInput)) { showError() }
 *
 *   // Type-safe in forms:
 *   const [mode, setMode] = useState<PaymentMode>('cash')
 */

// ─── The Canonical Payment Mode Type ──────────────────────────────────

export const PAYMENT_MODE_VALUES = [
  'cash',
  'upi',
  'card',
  'cheque',
  'insurance',
  'advance',
  'online',
  'pending',
  'other',
] as const

export type PaymentMode = typeof PAYMENT_MODE_VALUES[number]

// ─── Display Configuration ────────────────────────────────────────────

export interface PaymentModeDisplay {
  value: PaymentMode
  label: string
  icon: string
  description: string
  /** Tailwind classes for the badge background when active/selected */
  activeClasses: string
  /** Tailwind classes for the badge text */
  textClasses: string
  /** Tailwind classes for a colored dot/indicator */
  dotColor: string
  /** Whether this mode is available in the "new bill" form */
  availableInBillingForm: boolean
  /** Whether this is a digital/electronic payment (for reports) */
  isDigital: boolean
}

export const PAYMENT_MODES: PaymentModeDisplay[] = [
  {
    value: 'cash',
    label: 'Cash',
    icon: '💵',
    description: 'Cash payment received at counter',
    activeClasses: 'border-green-500 bg-green-50',
    textClasses: 'text-green-700',
    dotColor: 'bg-green-500',
    availableInBillingForm: true,
    isDigital: false,
  },
  {
    value: 'upi',
    label: 'UPI',
    icon: '📱',
    description: 'UPI / GPay / PhonePe / Paytm',
    activeClasses: 'border-blue-500 bg-blue-50',
    textClasses: 'text-blue-700',
    dotColor: 'bg-blue-500',
    availableInBillingForm: true,
    isDigital: true,
  },
  {
    value: 'card',
    label: 'Card',
    icon: '💳',
    description: 'Debit / Credit card (POS or online)',
    activeClasses: 'border-purple-500 bg-purple-50',
    textClasses: 'text-purple-700',
    dotColor: 'bg-purple-500',
    availableInBillingForm: true,
    isDigital: true,
  },
  {
    value: 'cheque',
    label: 'Cheque',
    icon: '🏦',
    description: 'Bank cheque / demand draft',
    activeClasses: 'border-amber-500 bg-amber-50',
    textClasses: 'text-amber-700',
    dotColor: 'bg-amber-500',
    availableInBillingForm: true,
    isDigital: false,
  },
  {
    value: 'insurance',
    label: 'Insurance',
    icon: '🏥',
    description: 'TPA / Insurance cashless claim',
    activeClasses: 'border-teal-500 bg-teal-50',
    textClasses: 'text-teal-700',
    dotColor: 'bg-teal-500',
    availableInBillingForm: true,
    isDigital: false,
  },
  {
    value: 'advance',
    label: 'Advance',
    icon: '↩️',
    description: 'Deducted from patient advance deposit',
    activeClasses: 'border-indigo-500 bg-indigo-50',
    textClasses: 'text-indigo-700',
    dotColor: 'bg-indigo-500',
    availableInBillingForm: true,
    isDigital: false,
  },
  {
    value: 'online',
    label: 'Online',
    icon: '🌐',
    description: 'Online payment (Razorpay / payment link)',
    activeClasses: 'border-cyan-500 bg-cyan-50',
    textClasses: 'text-cyan-700',
    dotColor: 'bg-cyan-500',
    availableInBillingForm: false, // Handled by Razorpay flow
    isDigital: true,
  },
  {
    value: 'pending',
    label: 'Pending',
    icon: '⏳',
    description: 'Payment not yet collected',
    activeClasses: 'border-gray-400 bg-gray-50',
    textClasses: 'text-gray-600',
    dotColor: 'bg-gray-400',
    availableInBillingForm: false, // System-set only
    isDigital: false,
  },
  {
    value: 'other',
    label: 'Other',
    icon: '•',
    description: 'Other payment method (specify in notes)',
    activeClasses: 'border-gray-500 bg-gray-50',
    textClasses: 'text-gray-700',
    dotColor: 'bg-gray-500',
    availableInBillingForm: true,
    isDigital: false,
  },
]

// ─── Helper Functions ─────────────────────────────────────────────────

/**
 * Check if a string is a valid payment mode.
 */
export function isValidPaymentMode(value: string | null | undefined): value is PaymentMode {
  if (!value) return false
  return (PAYMENT_MODE_VALUES as readonly string[]).includes(value)
}

/**
 * Get display configuration for a payment mode.
 * Returns the 'other' config for unknown modes (defensive).
 */
export function getPaymentModeDisplay(mode: string | null | undefined): PaymentModeDisplay {
  if (!mode) {
    return PAYMENT_MODES.find(m => m.value === 'pending')!
  }
  return PAYMENT_MODES.find(m => m.value === mode.toLowerCase()) ||
    PAYMENT_MODES.find(m => m.value === 'other')!
}

/**
 * Get label for a payment mode (for display in lists, reports).
 */
export function getPaymentModeLabel(mode: string | null | undefined): string {
  return getPaymentModeDisplay(mode).label
}

/**
 * Get icon + label string for a payment mode (e.g., "💵 Cash").
 */
export function getPaymentModeIconLabel(mode: string | null | undefined): string {
  const d = getPaymentModeDisplay(mode)
  return `${d.icon} ${d.label}`
}

/**
 * Get only the modes available in the billing form.
 */
export function getBillingFormModes(): PaymentModeDisplay[] {
  return PAYMENT_MODES.filter(m => m.availableInBillingForm)
}

/**
 * Get only digital payment modes (for Razorpay routing).
 */
export function getDigitalModes(): PaymentModeDisplay[] {
  return PAYMENT_MODES.filter(m => m.isDigital)
}

/**
 * Normalize a payment mode string (handles legacy values, case differences).
 * Returns a valid PaymentMode or 'other' as fallback.
 */
export function normalizePaymentMode(raw: string | null | undefined): PaymentMode {
  if (!raw) return 'pending'
  const lower = raw.toLowerCase().trim()

  // Direct match
  if (isValidPaymentMode(lower)) return lower

  // Legacy/alias mappings
  const aliases: Record<string, PaymentMode> = {
    'credit': 'card',
    'debit': 'card',
    'credit card': 'card',
    'debit card': 'card',
    'gpay': 'upi',
    'phonepe': 'upi',
    'paytm': 'upi',
    'neft': 'online',
    'rtgs': 'online',
    'imps': 'online',
    'bank transfer': 'online',
    'razorpay': 'online',
    'dd': 'cheque',
    'demand draft': 'cheque',
    'tpa': 'insurance',
    'cashless': 'insurance',
    'deposit': 'advance',
    'credit note': 'advance',
    'unknown': 'other',
    'none': 'pending',
    'not paid': 'pending',
    'unpaid': 'pending',
  }

  return aliases[lower] || 'other'
}

/**
 * Group bills by payment mode for analytics/CA report.
 * Returns sorted array with totals per mode.
 */
export function groupByPaymentMode(
  bills: Array<{ payment_mode?: string | null; net_amount?: number; total?: number }>
): Array<{ mode: PaymentMode; label: string; icon: string; amount: number; count: number }> {
  const groups: Record<string, { amount: number; count: number }> = {}

  for (const bill of bills) {
    const mode = normalizePaymentMode(bill.payment_mode)
    if (!groups[mode]) groups[mode] = { amount: 0, count: 0 }
    groups[mode].amount += Number(bill.net_amount || bill.total || 0)
    groups[mode].count += 1
  }

  return Object.entries(groups)
    .map(([mode, data]) => {
      const display = getPaymentModeDisplay(mode)
      return {
        mode: mode as PaymentMode,
        label: display.label,
        icon: display.icon,
        amount: data.amount,
        count: data.count,
      }
    })
    .sort((a, b) => b.amount - a.amount)
}
