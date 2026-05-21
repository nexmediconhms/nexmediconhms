/**
 * src/lib/booking-guards.ts
 *
 * PHASE 1 - Booking and race-condition guards (additive, non-breaking).
 *
 * PURPOSE
 *   A single, well-tested home for the pre-insert sanity checks that protect
 *   every booking surface in NexMedicon HMS:
 *
 *     - Appointment clashes (same doctor, same slot)
 *     - Same patient double-booked at the same time (any doctor)
 *     - OT room conflicts (same room, overlapping time)
 *     - IPD bed double-occupancy / patient-already-admitted
 *     - Patient duplicate prevention (mobile / Aadhaar / MRN race)
 *
 * WHY A SEPARATE MODULE
 *   The existing booking flows each have ad-hoc protections that evolved
 *   separately and do not share a contract. This module:
 *
 *     1. Provides ONE consistent return shape (ok, reason, conflicts) so
 *        the calling UI can render a single notice line.
 *     2. Is FULLY UNIT-TESTABLE without spinning up Supabase - the guards
 *        accept an injectable client interface, defaulting to the real
 *        @/lib/supabase client when omitted.
 *     3. ADDS to existing behaviour; never replaces an existing guard.
 *
 * INDIAN-CLINIC REALITIES HANDLED
 *   - Single-doctor clinic (doctorId not always supplied) - falls back to
 *     "same time, same patient" detection rather than per-doctor
 *   - OPD slots are typically 10-15 minutes; OT cases can be hours
 *   - Mobile may arrive with +91 / 91 / leading 0 / Gujarati digits
 *   - Aadhaar may arrive with spaces or dashes
 *
 * NOTE ON RACE CONDITIONS
 *   These app-layer checks REDUCE the race-condition window but do NOT
 *   eliminate it. The companion migration v01 adds DB-level UNIQUE and
 *   EXCLUDE constraints that are the only correctness-preserving fix.
 *   Treat this file as the friendly user-facing layer, and the migration
 *   as the source of truth.
 */

import { supabase as defaultSupabase } from '@/lib/supabase'
import { normalizeDigits } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GuardResult {
  ok: boolean
  reason: string
  conflicts: ConflictDescriptor[]
}

export interface ConflictDescriptor {
  table: 'appointments' | 'ot_schedules' | 'ipd_admissions' | 'patients'
  id: string
  label: string
  details?: string
}

/**
 * Minimal subset of the supabase-js fluent API used by these guards.
 * Tests pass a hand-rolled stub that satisfies this interface.
 */
export interface MinimalSupabaseLike {
  from: (table: string) => MinimalQueryBuilder
}

export interface MinimalQueryBuilder {
  select: (cols: string) => MinimalQueryBuilder
  eq: (col: string, val: unknown) => MinimalQueryBuilder
  in: (col: string, vals: unknown[]) => MinimalQueryBuilder
  neq: (col: string, val: unknown) => MinimalQueryBuilder
  not?: (col: string, op: string, val: unknown) => MinimalQueryBuilder
  or?: (filter: string) => MinimalQueryBuilder
  lt?: (col: string, val: unknown) => MinimalQueryBuilder
  gt?: (col: string, val: unknown) => MinimalQueryBuilder
  lte?: (col: string, val: unknown) => MinimalQueryBuilder
  gte?: (col: string, val: unknown) => MinimalQueryBuilder
  limit?: (n: number) => MinimalQueryBuilder
  then?: <T>(
    onfulfilled?: (value: { data: any[] | null; error: any }) => T | PromiseLike<T>,
  ) => Promise<T>
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const OK: GuardResult = { ok: true, reason: '', conflicts: [] }

function isValidTime(s: string | undefined | null): boolean {
  if (!s || typeof s !== 'string') return false
  return new RegExp('^([01]\\d|2[0-3]):[0-5]\\d(:[0-5]\\d)?$').test(s.trim())
}

function isValidDate(s: string | undefined | null): boolean {
  if (!s || typeof s !== 'string') return false
  if (!new RegExp('^\\d{4}-\\d{2}-\\d{2}$').test(s.trim())) return false
  const d = new Date(s.trim() + 'T00:00:00')
  return !isNaN(d.getTime())
}

function timeToMinutes(s: string): number {
  const [h, m] = s.split(':').map(n => parseInt(n, 10))
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m)
}

function minutesToTime(m: number): string {
  const safe = Math.max(0, Math.min(24 * 60 - 1, m))
  const h = Math.floor(safe / 60)
  const mm = safe % 60
  return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0')
}

/** Normalise an Indian mobile to 10 raw digits (strips +91/91/leading 0). */
export function normalizeMobile(raw: string | null | undefined): string {
  if (!raw) return ''
  const digits = normalizeDigits(String(raw)).replace(new RegExp('[^\\d]', 'g'), '')
  const stripped = digits.replace(new RegExp('^(\\+?91)'), '')
  const noLeadingZero = stripped.replace(new RegExp('^0+'), '')
  return noLeadingZero
}

/** Normalise an Aadhaar to 12 raw digits (strips spaces / dashes). */
export function normalizeAadhaar(raw: string | null | undefined): string {
  if (!raw) return ''
  return normalizeDigits(String(raw))
    .replace(new RegExp('[\\s\\-]', 'g'), '')
    .replace(new RegExp('[^\\d]', 'g'), '')
}

/** Normalise an MRN - trims and uppercases. */
export function normalizeMRN(raw: string | null | undefined): string {
  if (!raw) return ''
  return String(raw).trim().toUpperCase()
}

async function resolveQuery(q: any): Promise<{ data: any[] | null; error: any }> {
  if (q && typeof q.then === 'function') {
    return await q
  }
  return q as { data: any[] | null; error: any }
}

// ---------------------------------------------------------------------------
// 1. APPOINTMENT overlap / double-booking guard
// ---------------------------------------------------------------------------

export interface AppointmentGuardParams {
  doctorId?: string | null
  doctorName?: string | null
  patientId: string
  date: string
  time: string
  durationMin?: number
  excludeId?: string
  client?: MinimalSupabaseLike
}

export async function checkAppointmentOverlap(
  params: AppointmentGuardParams,
): Promise<GuardResult> {
  const {
    doctorId,
    doctorName,
    patientId,
    date,
    time,
    durationMin = 15,
    excludeId,
    client = defaultSupabase as unknown as MinimalSupabaseLike,
  } = params

  if (!patientId || typeof patientId !== 'string') {
    return { ok: false, reason: 'Patient is required', conflicts: [] }
  }
  if (!isValidDate(date)) {
    return { ok: false, reason: 'Invalid appointment date', conflicts: [] }
  }
  if (!isValidTime(time)) {
    return { ok: false, reason: 'Invalid appointment time', conflicts: [] }
  }
  if (!Number.isFinite(durationMin) || durationMin <= 0 || durationMin > 240) {
    return { ok: false, reason: 'Invalid appointment duration', conflicts: [] }
  }

  const proposedStart = timeToMinutes(time)
  const proposedEnd = proposedStart + durationMin

  try {
    let q: any = client.from('appointments').select(
      'id, patient_name, patient_id, doctor_id, doctor_name, date, time, status, type',
    ).eq('date', date)

    if (typeof q.not === 'function') {
      q = q.not('status', 'in', '("cancelled","completed","no_show")')
    } else if (typeof q.neq === 'function') {
      q = q.neq('status', 'cancelled').neq('status', 'completed').neq('status', 'no_show')
    }

    const { data, error } = await resolveQuery(q)
    if (error) {
      console.warn('[booking-guards] appt overlap query failed:', error?.message || error)
      return OK
    }

    const conflicts: ConflictDescriptor[] = []
    for (const row of (data || []) as any[]) {
      if (excludeId && row.id === excludeId) continue
      if (!isValidTime(row.time)) continue

      const otherStart = timeToMinutes(row.time)
      const otherEnd = otherStart + 15
      const overlaps = proposedStart < otherEnd && otherStart < proposedEnd

      if (overlaps) {
        const sameDoctor = doctorId
          ? row.doctor_id === doctorId
          : doctorName
          ? (row.doctor_name || '') === doctorName
          : true
        if (sameDoctor) {
          conflicts.push({
            table: 'appointments',
            id: row.id,
            label: (row.patient_name || 'Another patient') + ' at ' + row.time,
            details: row.doctor_name ? 'with Dr. ' + row.doctor_name : undefined,
          })
          continue
        }
      }

      if (row.patient_id === patientId && otherStart === proposedStart) {
        conflicts.push({
          table: 'appointments',
          id: row.id,
          label: 'This patient already has a ' + (row.type || 'visit') + ' at ' + row.time,
          details: row.doctor_name ? 'with Dr. ' + row.doctor_name : undefined,
        })
      }
    }

    if (conflicts.length === 0) return OK

    const proposedSlot = time + '-' + minutesToTime(proposedEnd)
    const first = conflicts[0]
    const reason = first.label.startsWith('This patient')
      ? first.label
      : 'Slot ' + proposedSlot + ' clashes with ' + first.label +
        (first.details ? ' (' + first.details + ')' : '')

    return { ok: false, reason, conflicts }
  } catch (err: any) {
    console.warn('[booking-guards] appt overlap unexpected error:', err?.message || err)
    return OK
  }
}

// ---------------------------------------------------------------------------
// 2. OT ROOM conflict guard
// ---------------------------------------------------------------------------

export interface OTRoomGuardParams {
  otRoom: string
  surgeryDate: string
  startTime: string
  endTime: string
  excludeId?: string
  client?: MinimalSupabaseLike
}

export async function checkOTRoomConflict(
  params: OTRoomGuardParams,
): Promise<GuardResult> {
  const {
    otRoom,
    surgeryDate,
    startTime,
    endTime,
    excludeId,
    client = defaultSupabase as unknown as MinimalSupabaseLike,
  } = params

  if (!otRoom || !otRoom.trim()) {
    return { ok: false, reason: 'OT room is required', conflicts: [] }
  }
  if (!isValidDate(surgeryDate)) {
    return { ok: false, reason: 'Invalid surgery date', conflicts: [] }
  }
  if (!isValidTime(startTime) || !isValidTime(endTime)) {
    return { ok: false, reason: 'Invalid surgery time', conflicts: [] }
  }
  if (timeToMinutes(endTime) <= timeToMinutes(startTime)) {
    return { ok: false, reason: 'End time must be after start time', conflicts: [] }
  }

  try {
    let q: any = client.from('ot_schedules').select(
      'id, patient_name, surgery_name, start_time, end_time, ot_room, status',
    ).eq('surgery_date', surgeryDate).eq('ot_room', otRoom)

    if (typeof q.not === 'function') {
      q = q.not('status', 'in', '("cancelled","completed")')
    } else if (typeof q.neq === 'function') {
      q = q.neq('status', 'cancelled').neq('status', 'completed')
    }

    const { data, error } = await resolveQuery(q)
    if (error) {
      console.warn('[booking-guards] OT conflict query failed:', error?.message || error)
      return OK
    }

    const proposedStart = timeToMinutes(startTime)
    const proposedEnd = timeToMinutes(endTime)
    const conflicts: ConflictDescriptor[] = []

    for (const row of (data || []) as any[]) {
      if (excludeId && row.id === excludeId) continue
      if (!isValidTime(row.start_time) || !isValidTime(row.end_time)) continue

      const otherStart = timeToMinutes(row.start_time)
      const otherEnd = timeToMinutes(row.end_time)
      const overlaps = proposedStart < otherEnd && otherStart < proposedEnd

      if (overlaps) {
        conflicts.push({
          table: 'ot_schedules',
          id: row.id,
          label: (row.surgery_name || 'A surgery') + ' for ' +
                 (row.patient_name || 'another patient'),
          details: row.start_time + '-' + row.end_time + ' in ' + row.ot_room,
        })
      }
    }

    if (conflicts.length === 0) return OK

    return {
      ok: false,
      reason: 'OT room ' + otRoom + ' is booked ' + startTime + '-' + endTime +
              ' by ' + conflicts[0].label + ' (' + conflicts[0].details + ')',
      conflicts,
    }
  } catch (err: any) {
    console.warn('[booking-guards] OT conflict unexpected error:', err?.message || err)
    return OK
  }
}

// ---------------------------------------------------------------------------
// 3. IPD double-admit guard
// ---------------------------------------------------------------------------

export interface IPDAdmitGuardParams {
  patientId: string
  bedId?: string | null
  client?: MinimalSupabaseLike
}

export async function checkIPDDoubleAdmit(
  params: IPDAdmitGuardParams,
): Promise<GuardResult> {
  const {
    patientId,
    bedId,
    client = defaultSupabase as unknown as MinimalSupabaseLike,
  } = params

  if (!patientId || typeof patientId !== 'string') {
    return { ok: false, reason: 'Patient is required', conflicts: [] }
  }

  const openStatuses = ['active', 'admitted']

  try {
    let q: any = client.from('ipd_admissions').select(
      'id, patient_id, patient_name, bed_id, bed_number, ward, status, admission_date',
    ).eq('patient_id', patientId)
    if (typeof q.in === 'function') {
      q = q.in('status', openStatuses)
    } else {
      q = q.eq('status', 'active')
    }

    const { data: patientHits, error: patientErr } = await resolveQuery(q)
    if (!patientErr && patientHits && patientHits.length > 0) {
      const a = patientHits[0]
      return {
        ok: false,
        reason: 'This patient is already admitted (Bed ' +
                (a.bed_number || '?') + ', ' + (a.ward || '') +
                ') since ' + (a.admission_date || ''),
        conflicts: [{
          table: 'ipd_admissions',
          id: a.id,
          label: (a.patient_name || 'Patient') + ' - Bed ' + (a.bed_number || '?'),
          details: 'Admitted ' + (a.admission_date || ''),
        }],
      }
    }
  } catch (err: any) {
    console.warn('[booking-guards] IPD patient check failed:', err?.message || err)
  }

  if (bedId) {
    try {
      let q: any = client.from('ipd_admissions').select(
        'id, patient_id, patient_name, bed_id, bed_number, ward, status',
      ).eq('bed_id', bedId)
      if (typeof q.in === 'function') {
        q = q.in('status', openStatuses)
      } else {
        q = q.eq('status', 'active')
      }

      const { data: bedHits, error: bedErr } = await resolveQuery(q)
      if (!bedErr && bedHits && bedHits.length > 0) {
        const a = bedHits[0]
        if (a.patient_id === patientId) return OK
        return {
          ok: false,
          reason: 'Bed ' + (a.bed_number || '') + ' is currently occupied by ' +
                  (a.patient_name || 'another patient'),
          conflicts: [{
            table: 'ipd_admissions',
            id: a.id,
            label: 'Bed ' + (a.bed_number || '') + ' - ' + (a.patient_name || 'occupied'),
            details: a.ward || undefined,
          }],
        }
      }
    } catch (err: any) {
      console.warn('[booking-guards] IPD bed check failed:', err?.message || err)
    }
  }

  return OK
}

// ---------------------------------------------------------------------------
// 4. PATIENT duplicate guard (strict-identifier check)
// ---------------------------------------------------------------------------

export interface PatientDuplicateParams {
  mobile?: string | null
  aadhaar?: string | null
  mrn?: string | null
  excludeId?: string
  client?: MinimalSupabaseLike
}

export async function checkPatientDuplicate(
  params: PatientDuplicateParams,
): Promise<GuardResult> {
  const {
    mobile,
    aadhaar,
    mrn,
    excludeId,
    client = defaultSupabase as unknown as MinimalSupabaseLike,
  } = params

  const normMobile = normalizeMobile(mobile)
  const normAadhaar = normalizeAadhaar(aadhaar)
  const normMRN = normalizeMRN(mrn)

  if (!normMobile && !normAadhaar && !normMRN) return OK

  const conflicts: ConflictDescriptor[] = []
  const addConflict = (p: any, reasonText: string) => {
    if (excludeId && p.id === excludeId) return
    if (conflicts.find(c => c.id === p.id)) return
    conflicts.push({
      table: 'patients',
      id: p.id,
      label: (p.full_name || 'Patient') + ' (' + (p.mrn || 'no MRN') + ')',
      details: reasonText,
    })
  }

  if (normMobile && normMobile.length === 10) {
    try {
      const q: any = client.from('patients').select(
        'id, full_name, mrn, mobile, aadhaar_no',
      ).eq('mobile', normMobile)
      const { data, error } = await resolveQuery(q)
      if (!error && data) {
        for (const p of data) addConflict(p, 'Same mobile number')
      }
    } catch (err: any) {
      console.warn('[booking-guards] patient mobile check failed:', err?.message || err)
    }
  }

  if (normAadhaar && normAadhaar.length === 12) {
    try {
      const q: any = client.from('patients').select(
        'id, full_name, mrn, mobile, aadhaar_no',
      ).eq('aadhaar_no', normAadhaar)
      const { data, error } = await resolveQuery(q)
      if (!error && data) {
        for (const p of data) addConflict(p, 'Same Aadhaar number')
      }
    } catch (err: any) {
      console.warn('[booking-guards] patient Aadhaar check failed:', err?.message || err)
    }
  }

  if (normMRN) {
    try {
      const q: any = client.from('patients').select(
        'id, full_name, mrn, mobile, aadhaar_no',
      ).eq('mrn', normMRN)
      const { data, error } = await resolveQuery(q)
      if (!error && data) {
        for (const p of data) addConflict(p, 'Same MRN')
      }
    } catch (err: any) {
      console.warn('[booking-guards] patient MRN check failed:', err?.message || err)
    }
  }

  if (conflicts.length === 0) return OK

  return {
    ok: false,
    reason: conflicts.length + ' existing patient' +
            (conflicts.length > 1 ? 's' : '') + ' matched on a unique identifier',
    conflicts,
  }
}

// ---------------------------------------------------------------------------
// 5. Utility export
// ---------------------------------------------------------------------------

export function summariseGuard(g: GuardResult): string {
  if (g.ok) return ''
  if (g.conflicts.length <= 1) return g.reason
  return g.reason + ' (and ' + (g.conflicts.length - 1) + ' more)'
}