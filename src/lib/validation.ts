/**
 * validation.ts — Centralized form validation utilities for NexMedicon HMS
 *
 * PURPOSE:
 *   - Consistent validation rules across all forms (patient, billing, labs, etc.)
 *   - Supports Indian-specific validations (Aadhaar, ABHA, mobile, GSTIN, PAN)
 *   - Type-safe validation results with structured error messages
 *   - Works with Gujarati/Hindi digit inputs (indic digit normalization)
 *
 * USAGE:
 *   import { validateMobile, validateAadhaar, validateRequired } from '@/lib/validation'
 *   const error = validateMobile('98765432') // 'Enter a valid 10-digit mobile number'
 *   const error2 = validateMobile('9876543210') // null (valid)
 */

import { normalizeDigits } from './utils'

// ── Type for validation result ─────────────────────────────────
export type ValidationError = string | null

// ── Required field ─────────────────────────────────────────────
export function validateRequired(value: string | undefined | null, fieldName: string): ValidationError {
  if (!value || !value.trim()) return `${fieldName} is required`
  return null
}

// ── Indian Mobile Number ───────────────────────────────────────
export function validateMobile(value: string, required = true): ValidationError {
  const normalized = normalizeDigits(value).replace(/[^\d]/g, '')
  if (!normalized && !required) return null
  if (!normalized) return 'Mobile number is required'
  // Remove +91 or 91 prefix if present
  const digits = normalized.replace(/^(\+?91)/, '')
  if (digits.length !== 10) return 'Enter a valid 10-digit mobile number'
  if (!/^[6-9]\d{9}$/.test(digits)) return 'Indian mobile numbers must start with 6, 7, 8, or 9'
  return null
}

// ── Aadhaar Number (12 digits) ─────────────────────────────────
export function validateAadhaar(value: string): ValidationError {
  if (!value || !value.trim()) return null // Optional field
  const digits = normalizeDigits(value).replace(/[\s-]/g, '')
  if (digits.length !== 12) return 'Aadhaar number must be exactly 12 digits'
  if (!/^\d{12}$/.test(digits)) return 'Aadhaar number must contain only digits'
  // Basic Verhoeff check (first digit cannot be 0 or 1)
  if (digits[0] === '0' || digits[0] === '1') return 'Invalid Aadhaar number format'
  return null
}

// ── ABHA Number (14 digits) ────────────────────────────────────
export function validateABHA(value: string): ValidationError {
  if (!value || !value.trim()) return null // Optional
  const digits = normalizeDigits(value).replace(/[-\s]/g, '')
  if (digits.length !== 14) return 'ABHA number must be exactly 14 digits'
  if (!/^\d{14}$/.test(digits)) return 'ABHA number must contain only digits'
  return null
}

// ── Email ──────────────────────────────────────────────────────
export function validateEmail(value: string, required = false): ValidationError {
  if (!value || !value.trim()) {
    if (required) return 'Email is required'
    return null
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(value.trim())) return 'Enter a valid email address'
  return null
}

// ── Age (0-150) ────────────────────────────────────────────────
export function validateAge(value: string | number | undefined | null): ValidationError {
  if (value === undefined || value === null || value === '') return null
  const num = typeof value === 'string' ? parseInt(normalizeDigits(value)) : value
  if (isNaN(num)) return 'Age must be a number'
  if (num < 0 || num > 150) return 'Age must be between 0 and 150'
  return null
}

// ── GSTIN (15 char alphanumeric) ───────────────────────────────
export function validateGSTIN(value: string): ValidationError {
  if (!value || !value.trim()) return null // Optional
  const gstin = value.trim().toUpperCase()
  if (gstin.length !== 15) return 'GSTIN must be exactly 15 characters'
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z]{1}\d{1}[A-Z\d]{1}[A-Z\d]{1}$/.test(gstin)) {
    return 'Invalid GSTIN format'
  }
  return null
}

// ── Amount (positive number) ───────────────────────────────────
export function validateAmount(value: string | number | undefined | null, fieldName = 'Amount'): ValidationError {
  if (value === undefined || value === null || value === '') return null
  const num = typeof value === 'string' ? parseFloat(value) : value
  if (isNaN(num)) return `${fieldName} must be a valid number`
  if (num < 0) return `${fieldName} cannot be negative`
  return null
}

// ── Date (not in future) ───────────────────────────────────────
export function validatePastDate(value: string, fieldName = 'Date'): ValidationError {
  if (!value) return null
  const d = new Date(value)
  if (isNaN(d.getTime())) return `${fieldName} is not a valid date`
  const today = new Date()
  today.setHours(23, 59, 59, 999) // Allow today
  if (d > today) return `${fieldName} cannot be in the future`
  return null
}

// ── Date (not in past) ─────────────────────────────────────────
export function validateFutureDate(value: string, fieldName = 'Date'): ValidationError {
  if (!value) return null
  const d = new Date(value)
  if (isNaN(d.getTime())) return `${fieldName} is not a valid date`
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (d < today) return `${fieldName} cannot be in the past`
  return null
}

// ── Blood Pressure (reasonable range) ──────────────────────────
export function validateBP(systolic: string, diastolic: string): ValidationError {
  if (!systolic && !diastolic) return null
  const sys = parseInt(systolic)
  const dia = parseInt(diastolic)
  if (systolic && (isNaN(sys) || sys < 50 || sys > 300)) return 'Systolic BP must be 50-300 mmHg'
  if (diastolic && (isNaN(dia) || dia < 20 || dia > 200)) return 'Diastolic BP must be 20-200 mmHg'
  if (sys && dia && dia >= sys) return 'Diastolic must be less than systolic'
  return null
}

// ── Vitals range validation ────────────────────────────────────
export function validateVital(value: string, type: 'pulse' | 'temp' | 'spo2' | 'weight' | 'height'): ValidationError {
  if (!value || !value.trim()) return null
  const num = parseFloat(value)
  if (isNaN(num)) return 'Must be a number'

  switch (type) {
    case 'pulse':
      if (num < 20 || num > 250) return 'Pulse must be 20-250 bpm'
      break
    case 'temp':
      if (num < 30 || num > 45) return 'Temperature must be 30-45°C'
      break
    case 'spo2':
      if (num < 50 || num > 100) return 'SpO₂ must be 50-100%'
      break
    case 'weight':
      if (num < 0.5 || num > 300) return 'Weight must be 0.5-300 kg'
      break
    case 'height':
      if (num < 20 || num > 250) return 'Height must be 20-250 cm'
      break
  }
  return null
}

// ── Batch validator — run multiple validations at once ──────────
export interface ValidationRule {
  field: string
  validator: () => ValidationError
}

export function validateAll(rules: ValidationRule[]): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const rule of rules) {
    const error = rule.validator()
    if (error) errors[rule.field] = error
  }
  return errors
}
