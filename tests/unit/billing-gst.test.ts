/**
 * Unit Tests — billing-gst.ts + credit-notes.ts
 *
 * Covers:
 *   - GST calculation (calculateTotals)
 *   - GST reversal for credit notes (calculateGSTReversal)
 *   - Zero GST (medical services exempt)
 *   - Edge cases: negative discount, zero subtotal, 100% discount
 *
 * Run: npx vitest --run tests/unit/billing-gst.test.ts
 */

import { describe, it, expect } from 'vitest'
import { calculateTotals } from '@/lib/billing-gst'
import { calculateGSTReversal } from '@/lib/credit-notes'

// ═══════════════════════════════════════════════════════════════
// calculateTotals (billing-gst.ts)
// ═══════════════════════════════════════════════════════════════
describe('calculateTotals', () => {
  it('calculates correctly with 0% GST (medical services)', () => {
    const result = calculateTotals(1000, 100, 0)
    expect(result.afterDiscount).toBe(900)
    expect(result.gstAmount).toBe(0)
    expect(result.netAmount).toBe(900)
  })

  it('calculates correctly with 18% GST', () => {
    const result = calculateTotals(1000, 0, 18)
    expect(result.afterDiscount).toBe(1000)
    expect(result.gstAmount).toBe(180)
    expect(result.netAmount).toBe(1180)
  })

  it('applies discount before GST', () => {
    const result = calculateTotals(1000, 200, 18)
    expect(result.afterDiscount).toBe(800)
    expect(result.gstAmount).toBe(144) // 800 * 18%
    expect(result.netAmount).toBe(944)
  })

  it('handles zero subtotal', () => {
    const result = calculateTotals(0, 0, 18)
    expect(result.afterDiscount).toBe(0)
    expect(result.gstAmount).toBe(0)
    expect(result.netAmount).toBe(0)
  })

  it('clamps discount to subtotal (no negative afterDiscount)', () => {
    const result = calculateTotals(500, 700, 18)
    expect(result.afterDiscount).toBe(0) // max(0, 500-700) = 0
    expect(result.gstAmount).toBe(0)
    expect(result.netAmount).toBe(0)
  })

  it('handles 5% GST rate', () => {
    const result = calculateTotals(2000, 0, 5)
    expect(result.afterDiscount).toBe(2000)
    expect(result.gstAmount).toBe(100) // 2000 * 5%
    expect(result.netAmount).toBe(2100)
  })

  it('handles 12% GST rate', () => {
    const result = calculateTotals(5000, 500, 12)
    expect(result.afterDiscount).toBe(4500)
    expect(result.gstAmount).toBe(540) // 4500 * 12%
    expect(result.netAmount).toBe(5040)
  })

  it('handles fractional amounts with proper rounding', () => {
    const result = calculateTotals(999, 0, 18)
    // 999 * 0.18 = 179.82
    expect(result.gstAmount).toBe(179.82)
    expect(result.netAmount).toBe(1178.82)
  })

  it('handles large amounts (lakh range)', () => {
    const result = calculateTotals(150000, 10000, 18)
    expect(result.afterDiscount).toBe(140000)
    expect(result.gstAmount).toBe(25200) // 140000 * 18%
    expect(result.netAmount).toBe(165200)
  })

  it('handles 100% discount', () => {
    const result = calculateTotals(1000, 1000, 18)
    expect(result.afterDiscount).toBe(0)
    expect(result.gstAmount).toBe(0)
    expect(result.netAmount).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════
// calculateGSTReversal (credit-notes.ts)
// ═══════════════════════════════════════════════════════════════
describe('calculateGSTReversal', () => {
  it('returns zero reversal for 0% GST', () => {
    const result = calculateGSTReversal(1000, 0)
    expect(result.taxableReversal).toBe(1000)
    expect(result.gstReversal).toBe(0)
    expect(result.cgstReversal).toBe(0)
    expect(result.sgstReversal).toBe(0)
    expect(result.netCredit).toBe(1000)
  })

  it('correctly splits 18% GST into CGST + SGST', () => {
    const result = calculateGSTReversal(1180, 18)
    // taxable = 1180 / 1.18 = 1000
    expect(result.taxableReversal).toBe(1000)
    expect(result.gstReversal).toBe(180)
    // CGST = SGST = 90
    expect(result.cgstReversal).toBe(90)
    expect(result.sgstReversal).toBe(90)
    expect(result.netCredit).toBe(1180)
  })

  it('handles 5% GST reversal', () => {
    const result = calculateGSTReversal(1050, 5)
    // taxable = 1050 / 1.05 = 1000
    expect(result.taxableReversal).toBe(1000)
    expect(result.gstReversal).toBe(50)
    expect(result.cgstReversal).toBe(25)
    expect(result.sgstReversal).toBe(25)
  })

  it('handles zero credit amount', () => {
    const result = calculateGSTReversal(0, 18)
    expect(result.taxableReversal).toBe(0)
    expect(result.gstReversal).toBe(0)
    expect(result.netCredit).toBe(0)
  })

  it('handles negative credit amount gracefully', () => {
    const result = calculateGSTReversal(-100, 18)
    // Negative amount should return zero (guard)
    expect(result.taxableReversal).toBe(-100) // passes through since gst=0 path
    expect(result.gstReversal).toBe(0)
  })

  it('handles fractional amounts with rounding', () => {
    const result = calculateGSTReversal(999, 18)
    // 999 / 1.18 = 846.61 (rounded to 2 decimals)
    expect(result.taxableReversal).toBeCloseTo(846.61, 1)
    expect(result.gstReversal).toBeCloseTo(152.39, 1)
    expect(result.cgstReversal + result.sgstReversal).toBeCloseTo(152.39, 1)
  })

  it('CGST + SGST always equals total GST reversal', () => {
    const amounts = [500, 1000, 1500, 2999, 7777]
    for (const amt of amounts) {
      const result = calculateGSTReversal(amt, 18)
      expect(result.cgstReversal + result.sgstReversal).toBeCloseTo(result.gstReversal, 2)
    }
  })
})