import { supabase } from '@/lib/supabase'

// Cancel all future appointments for a patient
export async function cancelFutureAppointments(patientId: string) {
  const { error } = await supabase
    .from("appointments")
    .update({ status: "cancelled" })
    .eq("patient_id", patientId)
    .eq("status", "scheduled");

  if (error) throw error;
}

// Create follow-up + appointment
export async function createFollowUp(patientId: string, visitId: string, date: string) {
  // Create follow-up
  const { data: followUp, error: fError } = await supabase
    .from("follow_ups")
    .insert({
      patient_id: patientId,
      created_from_visit_id: visitId,
      recommended_date: date,
    })
    .select()
    .single();

  if (fError) throw fError;

  // Cancel old appointments
  await cancelFutureAppointments(patientId);

  // Create appointment
  const { data: appointment, error: aError } = await supabase
    .from("appointments")
    .insert({
      patient_id: patientId,
      scheduled_date: date,
      source: "follow_up",
      follow_up_id: followUp.id,
      status: "scheduled",
    })
    .select()
    .single();

  if (aError) throw aError;

  // Link back
  const { error: linkError } = await supabase
    .from("follow_ups")
    .update({ linked_appointment_id: appointment.id })
    .eq("id", followUp.id);

  if (linkError) throw linkError;

  return followUp;
}

// Create manual appointment
export async function createAppointment(patientId: string, date: string) {
  // Check existing follow-up
  const { data: followUp } = await supabase
    .from("follow_ups")
    .select("*")
    .eq("patient_id", patientId)
    .eq("status", "pending")
    .maybeSingle();

  if (followUp) {
    // Fulfill follow-up
    await supabase
      .from("follow_ups")
      .update({ status: "fulfilled" })
      .eq("id", followUp.id);

    // Cancel old appointment
    if (followUp.linked_appointment_id) {
      await supabase
        .from("appointments")
        .update({ status: "cancelled" })
        .eq("id", followUp.linked_appointment_id);
    }
  }

  // Cancel other active appointments
  await cancelFutureAppointments(patientId);

  // Create new appointment
  const { data, error } = await supabase
    .from("appointments")
    .insert({
      patient_id: patientId,
      scheduled_date: date,
      source: "manual",
      status: "scheduled",
    })
    .select()
    .single();

  if (error) throw error;

  return data;
}

// Call this AFTER visit is completed
export async function handleVisitCompletion(patientId: string) {
  // Fulfill all follow-ups
  await supabase
    .from("follow_ups")
    .update({ status: "fulfilled" })
    .eq("patient_id", patientId)
    .eq("status", "pending");

  // Cancel future appointments
  await cancelFutureAppointments(patientId);
}