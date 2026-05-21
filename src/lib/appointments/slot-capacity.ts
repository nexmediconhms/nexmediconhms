/**
 * src/lib/appointments/slot-capacity.ts
 *
 * Slot Capacity Management
 *
 * Controls how many patients can be booked per time slot.
 * Prevents overbooking by checking existing appointments
 * before allowing new bookings.
 *
 * DEFAULTS (configurable via hospital settings):
 *   - Max patients per 15-min slot: 3
 *   - Max patients per hour: 8
 *   - Emergency override: always allows booking
 *
 * USAGE:
 *   import { checkSlotCapacity } from '@/lib/appointments/slot-capacity'
 *
 *   const check = await checkSlotCapacity({
 *     date: '2026-05-22',
 *     time: '10:00',
 *     doctorName: 'Dr. Shah',
 *   })
 *
 *   if (!check.available) {
 *     alert(check.message)
 *   }
 */

import { supabase } from '@/lib/supabase'

// ── Types ────────────────────────────────────────────────────

export interface SlotCapacityParams {
  date: string
  time: string
  doctorId?: string
  doctorName?: string
  excludeId?: string  // Exclude this appointment (for reschedule)
  isEmergency?: boolean
}

export interface SlotCapacityResult {
  available: boolean
  message: string
  currentCount: number
  maxCapacity: number
  hourlyCount: number
  hourlyMax: number
}

// ── Default configuration ────────────────────────────────────

const DEFAULT_MAX_PER_SLOT = 3   // max patients in a 15-min window
const DEFAULT_MAX_PER_HOUR = 8   // max patients in a 1-hour window

/**
 * Load slot capacity settings from hospital settings.
 * Falls back to defaults if not configured.
 */
function getCapacitySettings(): { maxPerSlot: number; maxPerHour: number } {
  if (typeof window === 'undefined') {
    return { maxPerSlot: DEFAULT_MAX_PER_SLOT, maxPerHour: DEFAULT_MAX_PER_HOUR }
  }

  try {
    const stored = localStorage.getItem('hospital_settings')
    if (stored) {
      const settings = JSON.parse(stored)
      return {
        maxPerSlot: Number(settings.maxPatientsPerSlot) || DEFAULT_MAX_PER_SLOT,
        maxPerHour: Number(settings.maxPatientsPerHour) || DEFAULT_MAX_PER_HOUR,
      }
    }
  } catch { /* use defaults */ }

  return { maxPerSlot: DEFAULT_MAX_PER_SLOT, maxPerHour: DEFAULT_MAX_PER_HOUR }
}

/**
 * Convert time string to minutes since midnight.
 */
function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/**
 * Check if a time slot has capacity for another appointment.
 *
 * Checks two windows:
 *   1. The 15-minute slot (e.g., 10:00-10:15) — max 3 patients
 *   2. The surrounding hour (e.g., 10:00-11:00) — max 8 patients
 *
 * Emergency appointments always pass (override).
 */
export async function checkSlotCapacity(params: SlotCapacityParams): Promise<SlotCapacityResult> {
  const { date, time, doctorId, doctorName, excludeId, isEmergency } = params
  const { maxPerSlot, maxPerHour } = getCapacitySettings()

  // Emergency always passes
  if (isEmergency) {
    return {
      available: true,
      message: 'Emergency booking — capacity check bypassed',
      currentCount: 0,
      maxCapacity: maxPerSlot,
      hourlyCount: 0,
      hourlyMax: maxPerHour,
    }
  }

  const requestedMinutes = timeToMinutes(time)

  try {
    // Fetch all appointments for this date that are not cancelled/completed
    let query = supabase
      .from('appointments')
      .select('id, time, status, doctor_id, doctor_name')
      .eq('date', date)
      .neq('status', 'cancelled')
      .neq('status', 'completed')
      .neq('status', 'no-show')

    const { data: appointments, error } = await query

    if (error) {
      console.warn('[slot-capacity] query error:', error.message)
      // On error, allow booking (fail open)
      return {
        available: true,
        message: 'Capacity check unavailable — booking allowed',
        currentCount: 0,
        maxCapacity: maxPerSlot,
        hourlyCount: 0,
        hourlyMax: maxPerHour,
      }
    }

    const existing = (appointments || []).filter(a => {
      if (excludeId && a.id === excludeId) return false
      // If doctor specified, only count same doctor's appointments
      if (doctorId && a.doctor_id && a.doctor_id !== doctorId) return false
      if (doctorName && a.doctor_name && a.doctor_name !== doctorName) return false
      return true
    })

    // Count appointments in the same 15-minute slot
    const slotCount = existing.filter(a => {
      if (!a.time) return false
      const aMin = timeToMinutes(a.time)
      return Math.abs(aMin - requestedMinutes) < 15
    }).length

    // Count appointments in the same hour
    const hourStart = Math.floor(requestedMinutes / 60) * 60
    const hourEnd = hourStart + 60
    const hourlyCount = existing.filter(a => {
      if (!a.time) return false
      const aMin = timeToMinutes(a.time)
      return aMin >= hourStart && aMin < hourEnd
    }).length

    // Check slot capacity
    if (slotCount >= maxPerSlot) {
      return {
        available: false,
        message: `This slot (${time}) is full — ${slotCount}/${maxPerSlot} patients already booked. Try the next slot.`,
        currentCount: slotCount,
        maxCapacity: maxPerSlot,
        hourlyCount,
        hourlyMax: maxPerHour,
      }
    }

    // Check hourly capacity
    if (hourlyCount >= maxPerHour) {
      const hourLabel = `${String(Math.floor(hourStart / 60)).padStart(2, '0')}:00-${String(Math.floor(hourEnd / 60)).padStart(2, '0')}:00`
      return {
        available: false,
        message: `Hour ${hourLabel} is at capacity — ${hourlyCount}/${maxPerHour} patients. Try a different hour.`,
        currentCount: slotCount,
        maxCapacity: maxPerSlot,
        hourlyCount,
        hourlyMax: maxPerHour,
      }
    }

    return {
      available: true,
      message: `Slot available (${slotCount + 1}/${maxPerSlot} in slot, ${hourlyCount + 1}/${maxPerHour} this hour)`,
      currentCount: slotCount,
      maxCapacity: maxPerSlot,
      hourlyCount,
      hourlyMax: maxPerHour,
    }
  } catch (err: any) {
    console.warn('[slot-capacity] unexpected error:', err?.message)
    // Fail open
    return {
      available: true,
      message: 'Capacity check error — booking allowed',
      currentCount: 0,
      maxCapacity: maxPerSlot,
      hourlyCount: 0,
      hourlyMax: maxPerHour,
    }
  }
}

/**
 * Get a summary of slot utilization for a given date.
 * Useful for showing a visual slot-picker UI.
 */
export async function getSlotUtilization(date: string, doctorName?: string): Promise<
  { time: string; count: number; maxCapacity: number; available: boolean }[]
> {
  const { maxPerSlot } = getCapacitySettings()

  const { data: appointments } = await supabase
    .from('appointments')
    .select('time, status')
    .eq('date', date)
    .neq('status', 'cancelled')
    .neq('status', 'completed')
    .neq('status', 'no-show')

  const slots: { time: string; count: number; maxCapacity: number; available: boolean }[] = []

  // Generate all 15-min slots from 08:00 to 19:45
  for (let h = 8; h <= 19; h++) {
    for (const m of [0, 15, 30, 45]) {
      if (h === 19 && m > 45) continue
      const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
      const timeMin = h * 60 + m

      const count = (appointments || []).filter(a => {
        if (!a.time) return false
        const aMin = timeToMinutes(a.time)
        return Math.abs(aMin - timeMin) < 15
      }).length

      slots.push({
        time,
        count,
        maxCapacity: maxPerSlot,
        available: count < maxPerSlot,
      })
    }
  }

  return slots
}
