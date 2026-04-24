const STORAGE_KEY = 'nexmedicon_settings'

export interface HospitalSettings {
  hospitalName: string
  address: string
  phone: string
  regNo: string
  gstin: string
  doctorName: string
  doctorQual: string
  doctorReg: string
  footerNote: string
  upiId: string
  feeOPD: string
  feeANC: string
  feeFollowUp: string
  feeIPD: string
  feeEmergency: string
  // ── CA (Chartered Accountant) contact details ────────────────
  caName: string   // CA's full name
  caWhatsApp: string   // CA's WhatsApp number (10 digits)
  caEmail: string   // CA's email address
}

export const DEFAULTS: HospitalSettings = {
  hospitalName: 'NexMedicon Hospital',
  address: 'Your Hospital Address, City, PIN',
  phone: '+91 98765 43210',
  regNo: 'Your Reg. No.',
  gstin: '',
  doctorName: 'Dr. Your Name',
  doctorQual: 'MBBS, MD (OBG)',
  doctorReg: 'Your Medical Council Reg. No.',
  footerNote: 'Thank you for visiting. Please follow the advice given above. Report any emergency immediately.',
  upiId: '',
  feeOPD: '500',
  feeANC: '400',
  feeFollowUp: '300',
  feeIPD: '1500',
  feeEmergency: '800',
  // CA defaults — empty so the doctor fills them in Settings
  caName: '',
  caWhatsApp: '',
  caEmail: '',
}

export const SETTINGS_STORAGE_KEY = STORAGE_KEY

export function loadSettings(): HospitalSettings {
  if (typeof window === 'undefined') return DEFAULTS
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) return { ...DEFAULTS, ...JSON.parse(stored) }
  } catch { }
  return DEFAULTS
}