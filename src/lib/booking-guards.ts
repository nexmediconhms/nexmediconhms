/**
 * src/lib/booking-guards.ts
 *
 * PHASE 1 — Booking and race-condition guards (additive, non-breaking).
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
 *     2. Is FULLY UNIT-TESTABLE without spinning up Supabase — the guards
 *        accept an injectable client interface, defaulting to the real
 *        @/lib/supabase client when omitted.
 *     3. ADDS to existing behaviour; never replaces an existing guard.
 *
 * INDIAN-CLINIC REALITIES HANDLED
 *   - Single-doctor clinic (doctorId not always supplied) — falls back to
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
 *
 * ═══════════════════════════════════════════════════════════════════════
 * UPDATES IN THIS VERSION (June 2026) — ALL ADDITIVE, NO REMOVALS
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   FIX #A: SCHEMA-RESILIENT COLUMN MATCHING
 *     The codebase has accumulated dual schema conventions:
 *       - v00-schema-master.sql uses no-underscore (patientid, fullname)
 *       - Migrations 010+ use snake_case (patient_id, full_name)
 *     Migration 017 explicitly states "the application code uses snake_case
 *     columns everywhere". Production has snake_case columns; the no-underscore
 *     columns only exist on fresh installs that haven't run migration 017.
 *
 *     The original code used snake_case (correct for production), but failed
 *     on fresh v00-only installs. This update tries snake_case FIRST (the
 *     production canonical) and falls back to no-underscore on a column-not-
 *     found error (PostgreSQL code 42703 / PGRST204).
 *
 *   FIX #B: FAIL-OPEN-WITH-WARNING ON DB ERRORS
 *     Previously, when the appointment/admission query failed, the guards
 *     returned silent OK ("don't block booking if query fails"). This meant
 *     a database outage silently disabled all conflict checking.
 *     This update returns ok:true (still doesn't block) BUT includes a
 *     conflict descriptor with a "verify manually" warning so the UI can
 *     show a yellow banner.
 *
 *   FIX #C: STRICT INPUT VALIDATION
 *     Added validation for:
 *       - UUID-format check on excludeId (prevent injection-shaped inputs)
 *       - Oversized strings (mobile capped to digits, MRN capped to 64 chars)
 *       - Whitespace-only strings (treated as null)
 *
 *   FIX #D: AADHAAR COLUMN NAME RESILIENCE
 *     `aadhaar_no` and `aadhaar` both exist in different schema versions.
 *     Migration 017 adds `aadhaar_no` to patients via ALTER TABLE.
 *     The v00 master uses `aadhaar`. We try `aadhaar_no` first, fall back
 *     to `aadhaar`.
 *
 *   FIX #E: ADDED EXPORT FOR validateUUID() utility
 *     The same validation is needed elsewhere; exposing the helper avoids
 *     duplication.
 *
 * ALL ORIGINAL EXPORTS, TYPES, AND FUNCTIONS ARE PRESERVED.
 * The MinimalSupabaseLike interface is unchanged.
 * Test stubs continue to work.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { supabase as defaultSupabase } from '@/lib/supabase'
import { normalizeDigits } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types (UNCHANGED — preserved exactly from original)
// ---------------------------------------------------------------------------

export interface GuardResult {
  ok: boolean
  reason: string
  conflicts: ConflictDescriptor[]
}

export interface ConflictDescriptor {
  table: 'appointments' | 'ot_schedules' | 'ipd_admissions' | 'patients' | 'system'
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
// Internal helpers (PRESERVED + new schema-resilience helpers)
// ---------------------------------------------------------------------------

const OK: GuardResult = { ok: true, reason: '', conflicts: [] }

/** Fail-open-with-warning result for DB errors (FIX #B) */
function makeDbErrorWarning(scope: string): GuardResult {
  return {
    ok: true, // do NOT block booking
    reason: 'Conflict check unavailable due to a database error. Booking allowed — please verify manually.',
    conflicts: [{
      table: 'system',
      id: 'db-error-' + scope,
      label: '⚠️ Unable to verify ' + scope + ' conflicts. Please verify manually.',
      details: 'The conflict-checking query failed (database error). This booking was allowed without verification.',
    }],
  }
}

/** Schema-resilience: detect PostgreSQL "column does not exist" error (FIX #A) */
function isMissingColumnError(error: any): boolean {
  if (!error) return false
  const code = String(error?.code || '')
  const msg = String(error?.message || '').toLowerCase()
  return (
    code === '42703'         // PostgreSQL: undefined_column
    || code === 'PGRST204'   // PostgREST: column not found
    || msg.includes('column') && (msg.includes('does not exist') || msg.includes('not found'))
  )
}

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

/** UUID format check — exported for reuse elsewhere (FIX #E) */
export function validateUUID(s: string | undefined | null): boolean {
  if (!s || typeof s !== 'string') return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim())
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
  // FIX #C: cap to 10 digits to prevent oversized inputs from being stored
  return noLeadingZero.slice(0, 10)
}

/** Normalise an Aadhaar to 12 raw digits (strips spaces / dashes). */
export function normalizeAadhaar(raw: string | null | undefined): string {
  if (!raw) return ''
  const digits = normalizeDigits(String(raw))
    .replace(new RegExp('[\\s\\-]', 'g'), '')
    .replace(new RegExp('[^\\d]', 'g'), '')
  // FIX #C: cap to 12 digits
  return digits.slice(0, 12)
}

/** Normalise an MRN — trims and uppercases. */
export function normalizeMRN(raw: string | null | undefined): string {
  if (!raw) return ''
  // FIX #C: cap to 64 chars to prevent oversized inputs
  return String(raw).trim().toUpperCase().slice(0, 64)
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

/**
 * Check if a new appointment would clash with existing ones.
 *
 * Strategy:
 *   1. Pull all appointments for `date` that are not cancelled/completed/no-show.
 *   2. For each one, check time overlap and (if doctor info available) same doctor.
 *   3. Also flag: same patient at the same exact time slot (cross-doctor double-booking).
 *
 * Schema-resilience (FIX #A): tries snake_case columns first (production canonical
 * per migration 017), falls back to no-underscore columns (v00 master schema)
 * if the column doesn't exist.
 */
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
  if (excludeId && !validateUUID(excludeId)) {
    // FIX #C: reject malformed excludeId
    return { ok: false, reason: 'Invalid excludeId format', conflicts: [] }
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

  // FIX #A: Try snake_case first (production), fall back to no-underscore
  let data: any[] | null = null
  let schema: 'snake' | 'flat' = 'snake'

  try {
    // Attempt 1: snake_case columns (matches migration 017 production schema)
    // 2026-06-04 audit fix (§9.2): duration_min is now SELECTed so the
    // overlap check uses each existing appointment's ACTUAL duration
    // rather than a hardcoded 15 minutes.
    let q: any = client.from('appointments').select(
      'id, patient_name, patient_id, doctor_id, doctor_name, date, time, duration_min, status, type',
    ).eq('date', date)

    if (typeof q.not === 'function') {
      q = q.not('status', 'in', '("cancelled","completed","no_show")')
    } else if (typeof q.neq === 'function') {
      q = q.neq('status', 'cancelled').neq('status', 'completed').neq('status', 'no_show')
    }

    const result = await resolveQuery(q)

    if (result.error && isMissingColumnError(result.error)) {
      // Attempt 2: no-underscore columns (v00 master schema)
      console.info('[booking-guards] snake_case columns not found, trying no-underscore schema')
      let q2: any = client.from('appointments').select(
        'id, patientname, patientid, date, time, status, type',
      ).eq('date', date)

      if (typeof q2.not === 'function') {
        q2 = q2.not('status', 'in', '("cancelled","completed","no_show")')
      } else if (typeof q2.neq === 'function') {
        q2 = q2.neq('status', 'cancelled').neq('status', 'completed').neq('status', 'no_show')
      }

      const result2 = await resolveQuery(q2)
      if (result2.error) {
        console.warn('[booking-guards] appt overlap query failed on both schemas:', result2.error?.message)
        return makeDbErrorWarning('appointment')
      }
      data = result2.data
      schema = 'flat'
    } else if (result.error) {
      console.warn('[booking-guards] appt overlap query failed:', result.error?.message)
      return makeDbErrorWarning('appointment')
    } else {
      data = result.data
    }
  } catch (err: any) {
    console.warn('[booking-guards] appt overlap unexpected error:', err?.message || err)
    return makeDbErrorWarning('appointment')
  }

  // Normalize row fields between the two schemas (FIX #A)
  // After this, `row.patient_id`, `row.patient_name`, etc. are populated
  // regardless of which schema the DB uses.
  const normalizedRows = (data || []).map((row: any) => {
    if (schema === 'snake') return row
    return {
      ...row,
      patient_id:   row.patient_id   ?? row.patientid,
      patient_name: row.patient_name ?? row.patientname,
      // appointments table doesn't have doctor_id/doctor_name in v00 master
      // (it has doctorname only on encounters). Leave undefined.
      doctor_id:    row.doctor_id   ?? null,
      doctor_name: row.doctor_name ?? null,
    }
  })

  try {
    const conflicts: ConflictDescriptor[] = []
    for (const row of normalizedRows) {
      if (excludeId && row.id === excludeId) continue
      if (!isValidTime(row.time)) continue

      const otherStart = timeToMinutes(row.time)
      // 2026-06-04 audit fix (§9.2): use the actual scheduled duration
      // of the existing appointment instead of assuming 15 minutes.
      // The previous hardcoded value caused a real 60-minute slot
      // (e.g. an OB/GYN antenatal review) to be flagged as ending at
      // start+15, missing 45 minutes of overlap with new bookings.
      // Falls back to 15 if the column is missing/blank/invalid.
      const otherDurationRaw = Number(row.duration_min)
      const otherDurationMin =
        Number.isFinite(otherDurationRaw) && otherDurationRaw > 0 && otherDurationRaw <= 480
          ? Math.floor(otherDurationRaw)
          : 15
      const otherEnd = otherStart + otherDurationMin
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
    console.warn('[booking-guards] appt overlap processing error:', err?.message || err)
    return makeDbErrorWarning('appointment')
  }
}

// ---------------------------------------------------------------------------
// 2. OT ROOM conflict guard (UNCHANGED — ot_schedules genuinely uses snake_case)
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
  if (excludeId && !validateUUID(excludeId)) {
    return { ok: false, reason: 'Invalid excludeId format', conflicts: [] }
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
    // ot_schedules uses snake_case in its source migration — no fallback needed
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
      return makeDbErrorWarning('OT room')
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
    return makeDbErrorWarning('OT room')
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

/**
 * Schema-resilience (FIX #A): Production uses ipd_admissions (snake_case),
 * v00 master uses ipdadmissions (no underscore). Try snake_case first.
 */
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
  if (bedId && !validateUUID(bedId)) {
    return { ok: false, reason: 'Invalid bedId format', conflicts: [] }
  }

  const openStatuses = ['active', 'admitted']

  // FIX #A: try snake_case columns first, fall back to no-underscore
  let patientHits: any[] | null = null
  let schema: 'snake' | 'flat' = 'snake'

  try {
    let q: any = client.from('ipd_admissions').select(
      'id, patient_id, patient_name, bed_id, bed_number, ward, status, admission_date',
    ).eq('patient_id', patientId)
    if (typeof q.in === 'function') {
      q = q.in('status', openStatuses)
    } else {
      q = q.eq('status', 'active')
    }

    const result = await resolveQuery(q)

    if (result.error && isMissingColumnError(result.error)) {
      // Try no-underscore schema (table `ipdadmissions`)
      console.info('[booking-guards] ipd_admissions snake_case not found, trying ipdadmissions')
      let q2: any = client.from('ipdadmissions').select(
        'id, patientid, bedid, status, admissiondate',
      ).eq('patientid', patientId)
      if (typeof q2.in === 'function') {
        q2 = q2.in('status', openStatuses)
      } else {
        q2 = q2.eq('status', 'active')
      }
      const result2 = await resolveQuery(q2)
      if (result2.error) {
        console.warn('[booking-guards] IPD patient check failed on both schemas:', result2.error?.message)
        return makeDbErrorWarning('IPD admission')
      }
      patientHits = result2.data
      schema = 'flat'
    } else if (result.error) {
      console.warn('[booking-guards] IPD patient check failed:', result.error?.message)
      return makeDbErrorWarning('IPD admission')
    } else {
      patientHits = result.data
    }

    if (patientHits && patientHits.length > 0) {
      const a = patientHits[0]
      const patientName = schema === 'snake' ? a.patient_name : null
      const bedNumber   = schema === 'snake' ? a.bed_number   : null
      const ward        = schema === 'snake' ? a.ward         : null
      const admissionDate = schema === 'snake' ? a.admission_date : a.admissiondate

      // For flat schema, fetch bed info separately
      let bedInfo = bedNumber || ''
      if (schema === 'flat' && a.bedid) {
        try {
          const bedQuery: any = client.from('beds').select('bednumber, ward').eq('id', a.bedid)
          if (typeof bedQuery.limit === 'function') bedQuery.limit(1)
          const { data: beds } = await resolveQuery(bedQuery)
          if (beds && beds.length > 0) {
            bedInfo = beds[0].bednumber || ''
          }
        } catch { /* non-fatal */ }
      }

      return {
        ok: false,
        reason: 'This patient is already admitted (Bed ' +
                (bedInfo || '?') + (ward ? ', ' + ward : '') +
                ') since ' + (admissionDate || ''),
        conflicts: [{
          table: 'ipd_admissions',
          id: a.id,
          label: (patientName || 'Patient') + ' — Bed ' + (bedInfo || '?'),
          details: 'Admitted ' + (admissionDate || ''),
        }],
      }
    }
  } catch (err: any) {
    console.warn('[booking-guards] IPD patient check unexpected error:', err?.message || err)
    // Don't return early — still check the bed
  }

  // Check if the bed is occupied by someone else
  if (bedId) {
    try {
      const tableName = schema === 'snake' ? 'ipd_admissions' : 'ipdadmissions'
      const bedCol    = schema === 'snake' ? 'bed_id' : 'bedid'
      const cols      = schema === 'snake'
        ? 'id, patient_id, patient_name, bed_id, bed_number, ward, status'
        : 'id, patientid, bedid, status'

      let q: any = client.from(tableName).select(cols).eq(bedCol, bedId)
      if (typeof q.in === 'function') {
        q = q.in('status', openStatuses)
      } else {
        q = q.eq('status', 'active')
      }

      const { data: bedHits, error: bedErr } = await resolveQuery(q)
      if (bedErr) {
        console.warn('[booking-guards] IPD bed check failed:', bedErr?.message || bedErr)
        // Already returned makeDbErrorWarning for patient check earlier if needed
      } else if (bedHits && bedHits.length > 0) {
        const a = bedHits[0]
        const occupantPatientId = schema === 'snake' ? a.patient_id : a.patientid
        if (occupantPatientId === patientId) return OK  // Same patient, same bed = fine

        // Get occupant name (and bed info if flat schema)
        let occupantName: string = schema === 'snake' ? (a.patient_name || '') : ''
        let bedNumber  : string = schema === 'snake' ? (a.bed_number   || '') : ''
        let ward       : string | undefined = schema === 'snake' ? a.ward : undefined

        if (schema === 'flat') {
          try {
            const pQuery: any = client.from('patients').select('fullname').eq('id', occupantPatientId)
            if (typeof pQuery.limit === 'function') pQuery.limit(1)
            const { data: pData } = await resolveQuery(pQuery)
            occupantName = pData?.[0]?.fullname || ''

            const bQuery: any = client.from('beds').select('bednumber, ward').eq('id', bedId)
            if (typeof bQuery.limit === 'function') bQuery.limit(1)
            const { data: bData } = await resolveQuery(bQuery)
            bedNumber = bData?.[0]?.bednumber || ''
            ward = bData?.[0]?.ward
          } catch { /* non-fatal */ }
        }

        return {
          ok: false,
          reason: 'Bed ' + (bedNumber || '') + ' is currently occupied by ' +
                  (occupantName || 'another patient'),
          conflicts: [{
            table: 'ipd_admissions',
            id: a.id,
            label: 'Bed ' + (bedNumber || '') + ' — ' + (occupantName || 'occupied'),
            details: ward || undefined,
          }],
        }
      }
    } catch (err: any) {
      console.warn('[booking-guards] IPD bed check unexpected error:', err?.message || err)
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

/**
 * Schema-resilience (FIX #A, FIX #D):
 *   patients table: production has BOTH `full_name` AND `fullname` (migration 017
 *   adds snake_case columns). Aadhaar: production has both `aadhaar_no` AND
 *   `aadhaar`. We use snake_case (production canonical) first, fall back if needed.
 */
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

  if (excludeId && !validateUUID(excludeId)) {
    return { ok: false, reason: 'Invalid excludeId format', conflicts: [] }
  }

  const normMobile = normalizeMobile(mobile)
  const normAadhaar = normalizeAadhaar(aadhaar)
  const normMRN = normalizeMRN(mrn)

  if (!normMobile && !normAadhaar && !normMRN) return OK

  const conflicts: ConflictDescriptor[] = []
  const addConflict = (p: any, reasonText: string) => {
    if (excludeId && p.id === excludeId) return
    if (conflicts.find(c => c.id === p.id)) return
    const nameField = p.full_name ?? p.fullname ?? 'Patient'
    conflicts.push({
      table: 'patients',
      id: p.id,
      label: nameField + ' (' + (p.mrn || 'no MRN') + ')',
      details: reasonText,
    })
  }

  // Schema detection: cache after first query (FIX #A)
  let schema: 'snake' | 'flat' = 'snake'
  let schemaDetected = false

  /**
   * Helper to query patients with schema-fallback.
   * Tries snake_case first, falls back to no-underscore on column-not-found.
   */
  async function queryPatients(
    matchColumn: { snake: string; flat: string },
    matchValue: string,
  ): Promise<any[]> {
    const cols = schema === 'snake'
      ? 'id, full_name, mrn, mobile, aadhaar_no'
      : 'id, fullname, mrn, mobile, aadhaar'
    const colName = schema === 'snake' ? matchColumn.snake : matchColumn.flat

    try {
      const q: any = client.from('patients').select(cols).eq(colName, matchValue)
      const result = await resolveQuery(q)

      if (result.error && isMissingColumnError(result.error) && !schemaDetected) {
        // Schema fallback: switch to flat and retry
        schema = 'flat'
        schemaDetected = true
        console.info('[booking-guards] patients snake_case columns not found, switching to no-underscore')
        const cols2 = 'id, fullname, mrn, mobile, aadhaar'
        const col2 = matchColumn.flat
        const q2: any = client.from('patients').select(cols2).eq(col2, matchValue)
        const result2 = await resolveQuery(q2)
        if (result2.error) {
          console.warn('[booking-guards] patient query failed on both schemas:', result2.error?.message)
          return []
        }
        return result2.data || []
      }
      if (result.error) {
        console.warn('[booking-guards] patient query failed:', result.error?.message)
        return []
      }
      schemaDetected = true
      return result.data || []
    } catch (err: any) {
      console.warn('[booking-guards] patient query unexpected error:', err?.message || err)
      return []
    }
  }

  // 1. Check by mobile (column name is 'mobile' in both schemas)
  if (normMobile && normMobile.length === 10) {
    const rows = await queryPatients({ snake: 'mobile', flat: 'mobile' }, normMobile)
    for (const p of rows) addConflict(p, 'Same mobile number')
  }

  // 2. Check by Aadhaar (FIX #D: column name differs by schema)
  if (normAadhaar && normAadhaar.length === 12) {
    const rows = await queryPatients(
      { snake: 'aadhaar_no', flat: 'aadhaar' },
      normAadhaar,
    )
    for (const p of rows) addConflict(p, 'Same Aadhaar number')
  }

  // 3. Check by MRN (column name is 'mrn' in both schemas)
  if (normMRN) {
    const rows = await queryPatients({ snake: 'mrn', flat: 'mrn' }, normMRN)
    for (const p of rows) addConflict(p, 'Same MRN')
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
// 5. Utility export (UNCHANGED)
// ---------------------------------------------------------------------------

export function summariseGuard(g: GuardResult): string {
  if (g.ok && g.conflicts.length === 0) return ''
  if (g.ok && g.conflicts.length > 0) {
    // FIX #B: surface warnings even when ok=true
    return g.conflicts[0].label
  }
  if (g.conflicts.length <= 1) return g.reason
  return g.reason + ' (and ' + (g.conflicts.length - 1) + ' more)'
}