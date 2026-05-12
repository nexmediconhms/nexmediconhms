/**
 * src/lib/ipd-billing.ts
 * Feature A: IPD Billing utilities
 *
 * Calculates stay duration and generates pre-filled billing line items
 * for IPD patients based on bed rates, nursing, doctor visits, etc.
 */

export interface IPDBillItem {
  label: string
  amount: number
  quantity?: number
  rate?: number
}

/**
 * Calculate the number of days between admission and discharge.
 * Minimum 1 day (same-day admission counts as 1).
 */
export function calculateStayDuration(
  admissionDate: string | Date | null,
  dischargeDate?: string | Date | null
): number {
  if (!admissionDate) return 0
  const start = new Date(admissionDate)
  const end = dischargeDate ? new Date(dischargeDate) : new Date()
  const diffMs = end.getTime() - start.getTime()
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
  return Math.max(1, days) // Minimum 1 day
}

/**
 * Generate IPD billing line items from bed data and visit counts.
 */
export function generateIPDBillItems(params: {
  stayDays: number
  bedRate: number         // per day
  nursingRate: number     // per day
  doctorVisits?: number
  doctorVisitFee?: number
  surgeryCharges?: number
  otCharges?: number
  procedureCharges?: number
  medicineCharges?: number
}): IPDBillItem[] {
  const items: IPDBillItem[] = []

  if (params.stayDays > 0 && params.bedRate > 0) {
    items.push({
      label: `Bed Charges (${params.stayDays} days × ₹${params.bedRate}/day)`,
      amount: params.stayDays * params.bedRate,
      quantity: params.stayDays,
      rate: params.bedRate,
    })
  }

  if (params.stayDays > 0 && params.nursingRate > 0) {
    items.push({
      label: `Nursing Charges (${params.stayDays} days × ₹${params.nursingRate}/day)`,
      amount: params.stayDays * params.nursingRate,
      quantity: params.stayDays,
      rate: params.nursingRate,
    })
  }

  if (params.doctorVisits && params.doctorVisitFee) {
    items.push({
      label: `Doctor Visits (${params.doctorVisits} × ₹${params.doctorVisitFee})`,
      amount: params.doctorVisits * params.doctorVisitFee,
      quantity: params.doctorVisits,
      rate: params.doctorVisitFee,
    })
  }

  if (params.surgeryCharges && params.surgeryCharges > 0) {
    items.push({ label: 'Surgery / OT Charges', amount: params.surgeryCharges })
  }

  if (params.otCharges && params.otCharges > 0) {
    items.push({ label: 'OT Facility Charges', amount: params.otCharges })
  }

  if (params.procedureCharges && params.procedureCharges > 0) {
    items.push({ label: 'Procedure Charges', amount: params.procedureCharges })
  }

  if (params.medicineCharges && params.medicineCharges > 0) {
    items.push({ label: 'Medicines / Pharmacy', amount: params.medicineCharges })
  }

  return items
}

/**
 * Calculate per-day cost from total and days.
 */
export function perDayCost(total: number, days: number): number {
  if (days <= 0) return 0
  return Math.round((total / days) * 100) / 100
}
