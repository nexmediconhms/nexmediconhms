// ─────────────────────────────────────────────────────────────
// NexMedicon HMS — Brand & Hospital Constants
// Edit this file to change the name/details everywhere at once.
// ─────────────────────────────────────────────────────────────

export const BRAND = {
  name:        'NexMedicon HMS',
  shortName:   'NexMedicon',
  tagline:     'Gynecology & Multi-specialty Hospital Management',
  copyright:   '© 2025 NexMedicon HMS · Patient data encrypted & stored securely in India',
} as const

// These are used in print headers on prescriptions and discharge summaries.
// The hospital fills these in when they configure the system.
// For the demo, they are placeholder values.
export const HOSPITAL = {
  name:        'NexMedicon Demo Hospital',
  address:     '123 Hospital Road, City',
  phone:       '+91 98765 43210',
  regNo:       'MH/12345',
  gstin:       '27ABCDE1234F1Z5',
  doctorName:  'Dr. Demo',
  doctorQual:  'MBBS, MD (OBG)',
  doctorReg:   'MH/12345',
} as const
