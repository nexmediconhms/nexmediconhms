import { supabase } from "@/lib/supabase";

/**
 * HMS Appointment / Follow-up Service
 * -----------------------------------
 * Works with existing appointments schema used in your UI:
 * appointments: patient_id, patient_name, mrn, mobile, date, time, type, status, notes
 *
 * And new follow_ups table (Step 1 SQL you already ran):
 * follow_ups: patient_id, created_from_visit_id, recommended_date, status, linked_appointment_id
 *
 * Key rules implemented:
 * 1) Creating/updating follow-up from a visit keeps ONE active follow-up appointment.
 * 2) Manual appointment automatically fulfils pending follow-up (your decision).
 * 3) Visit completion auto-fulfils follow-ups and cancels future appointments.
 */

type FollowUpRow = {
  id: string;
  patient_id: string;
  created_from_visit_id: string | null;
  recommended_date: string;
  status: "pending" | "fulfilled" | "cancelled" | string;
  linked_appointment_id: string | null;
  created_at?: string;
};

function todayISODate() {
  return new Date().toISOString().split("T")[0];
}

/** Cancel scheduled future appointments (optionally excluding one appointment id). */
export async function cancelFutureAppointments(
  patientId: string,
  excludeAppointmentId?: string | null
) {
  const today = todayISODate();

  let q = supabase
    .from("appointments")
    .update({ status: "cancelled" })
    .eq("patient_id", patientId)
    .eq("status", "scheduled")
    .gte("date", today);

  if (excludeAppointmentId) {
    q = q.neq("id", excludeAppointmentId);
  }

  const { error } = await q;
  if (error) throw error;
}

/** Returns the most recent pending follow-up for a patient (if any). */
export async function getLatestPendingFollowUp(patientId: string) {
  const { data, error } = await supabase
    .from("follow_ups")
    .select("*")
    .eq("patient_id", patientId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  return (data && data.length ? (data[0] as FollowUpRow) : null) as FollowUpRow | null;
}

/** Create an appointment row for follow-up and return appointment id. */
async function createFollowUpAppointment(params: {
  patientId: string;
  patientName?: string | null;
  mrn?: string | null;
  mobile?: string | null;
  date: string;
  notes?: string | null;
  followUpId?: string | null;
}) {
  const { patientId, patientName, mrn, mobile, date, notes, followUpId } = params;

  const { data, error } = await supabase
    .from("appointments")
    .insert({
      patient_id: patientId,
      patient_name: patientName ?? null,
      mrn: mrn ?? null,
      mobile: mobile ?? null,
      date,
      time: "10:00",
      type: "follow_up",
      status: "scheduled",
      notes: notes ?? null,
      source: "follow_up",
      follow_up_id: followUpId ?? null,
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
}

/**
 * Create OR update follow-up for a given encounter/visit.
 * - If a pending follow-up already exists for the same encounter (created_from_visit_id),
 *   we update it + cancel old linked appointment + create a new one.
 * - Else we create follow-up + create appointment + link.
 */
export async function createFollowUp(
  patientId: string,
  encounterId: string,
  followUpDate: string,
  meta?: { patientName?: string; mrn?: string; mobile?: string; encounterDateLabel?: string }
) {
  // 1) Find existing follow-up for this encounter
  const { data: existing, error: findErr } = await supabase
    .from("follow_ups")
    .select("*")
    .eq("patient_id", patientId)
    .eq("created_from_visit_id", encounterId)
    .eq("status", "pending")
    .maybeSingle();

  if (findErr) throw findErr;

  const notes =
    meta?.encounterDateLabel
      ? `Follow-up from encounter on ${meta.encounterDateLabel}`
      : "Follow-up from recent visit";

  if (existing) {
    const fu = existing as FollowUpRow;

    // 2) Update follow-up date
    const { error: upErr } = await supabase
      .from("follow_ups")
      .update({ recommended_date: followUpDate })
      .eq("id", fu.id);

    if (upErr) throw upErr;

    // 3) Cancel old linked appointment (if present)
    if (fu.linked_appointment_id) {
      const { error: cancelOldErr } = await supabase
        .from("appointments")
        .update({ status: "cancelled" })
        .eq("id", fu.linked_appointment_id);

      if (cancelOldErr) throw cancelOldErr;
    }

    // 4) Cancel any other future scheduled appointments (keep none)
    await cancelFutureAppointments(patientId);

    // 5) Create new follow-up appointment and link it back
    const newApptId = await createFollowUpAppointment({
      patientId,
      patientName: meta?.patientName ?? null,
      mrn: meta?.mrn ?? null,
      mobile: meta?.mobile ?? null,
      date: followUpDate,
      notes,
      followUpId: fu.id,
    });

    const { error: linkErr } = await supabase
      .from("follow_ups")
      .update({ linked_appointment_id: newApptId })
      .eq("id", fu.id);

    if (linkErr) throw linkErr;

    return { id: fu.id, linked_appointment_id: newApptId };
  }

  // No existing follow-up for this encounter => create new follow-up
  const { data: created, error: createErr } = await supabase
    .from("follow_ups")
    .insert({
      patient_id: patientId,
      created_from_visit_id: encounterId,
      recommended_date: followUpDate,
      status: "pending",
    })
    .select("*")
    .single();

  if (createErr) throw createErr;

  // Cancel future scheduled appointments
  await cancelFutureAppointments(patientId);

  // Create appointment and link
  const apptId = await createFollowUpAppointment({
    patientId,
    patientName: meta?.patientName ?? null,
    mrn: meta?.mrn ?? null,
    mobile: meta?.mobile ?? null,
    date: followUpDate,
    notes,
    followUpId: created.id,
  });

  const { error: linkErr2 } = await supabase
    .from("follow_ups")
    .update({ linked_appointment_id: apptId })
    .eq("id", created.id);

  if (linkErr2) throw linkErr2;

  return { id: created.id, linked_appointment_id: apptId };
}

/**
 * Manual appointment creation:
 * - Automatically convert/fulfil pending follow-up (your decision).
 * - Cancel old follow-up-based appointment (if any).
 * - Enforce only one future scheduled appointment by cancelling others.
 */
export async function createAppointment(params: {
  patientId: string;
  date: string;
  time?: string;
  patientName?: string | null;
  mrn?: string | null;
  mobile?: string | null;
  notes?: string | null;
  type?: string; // default "manual"
}) {
  const {
    patientId,
    date,
    time = "10:00",
    patientName,
    mrn,
    mobile,
    notes,
    type = "manual",
  } = params;

  // 1) If pending follow-up exists => fulfil it + cancel its linked appt
  const pending = await getLatestPendingFollowUp(patientId);

  if (pending) {
    const { error: fuErr } = await supabase
      .from("follow_ups")
      .update({ status: "fulfilled" })
      .eq("id", pending.id);

    if (fuErr) throw fuErr;

    if (pending.linked_appointment_id) {
      const { error: cancelErr } = await supabase
        .from("appointments")
        .update({ status: "cancelled" })
        .eq("id", pending.linked_appointment_id);

      if (cancelErr) throw cancelErr;
    }
  }

  // 2) Cancel any other future scheduled appointments (enforce ONE)
  await cancelFutureAppointments(patientId);

  // 3) Create manual appointment
  const { data, error } = await supabase
    .from("appointments")
    .insert({
      patient_id: patientId,
      patient_name: patientName ?? null,
      mrn: mrn ?? null,
      mobile: mobile ?? null,
      date,
      time,
      type,
      status: "scheduled",
      notes: notes ?? null,
      source: "manual",
      follow_up_id: null,
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
}

/**
 * ✅ VISIT COMPLETION CLEANUP
 * Call this when patient actually visits (encounter completed / consultation done).
 * - Fulfil all pending follow-ups for patient
 * - Cancel all future scheduled appointments
 */
export async function handleVisitCompletion(patientId: string) {
  // fulfil follow-ups
  const { error: fuErr } = await supabase
    .from("follow_ups")
    .update({ status: "fulfilled" })
    .eq("patient_id", patientId)
    .eq("status", "pending");

  if (fuErr) throw fuErr;

  // cancel future appointments
  await cancelFutureAppointments(patientId);
}

/**
 * Alias (optional): some pages may prefer this name.
 * Keeping it to avoid "function not found" when you integrate later.
 */
export async function onVisitCompleted(patientId: string) {
  return handleVisitCompletion(patientId);
}
