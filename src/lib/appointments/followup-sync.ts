import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
)

/**
 * Automatically resolves follow-ups when a patient visits.
 *
 * RULE:
 * When ANY appointment is marked as completed,
 * all future follow-up appointments for that patient are cancelled.
 *
 * This ensures:
 * - No duplicate follow-ups
 * - No wrong reminders
 * - Zero manual work for staff
 */
export async function handleFollowupAfterVisit(params: {
  patient_id: string
  visit_date?: string
}) {
  const { patient_id, visit_date } = params

  if (!patient_id) return

  try {
    const visitDateISO = visit_date
      ? new Date(visit_date).toISOString()
      : new Date().toISOString()

    // ✅ Find all future follow-up appointments
    const { data: followups, error: fetchError } = await supabase
      .from('appointments')
      .select('id, date, status')
      .eq('patient_id', patient_id)
      .in('type', ['follow_up', 'Follow-up'])
      .eq('status', 'scheduled')
      .gt('date', visitDateISO)

    if (fetchError) {
      console.error('Error fetching follow-ups:', fetchError)
      return
    }

    if (!followups || followups.length === 0) {
      return
    }

    const ids = followups.map((f) => f.id)

    // ✅ Cancel all future follow-ups
    const { error: updateError } = await supabase
      .from('appointments')
      .update({
        status: 'cancelled',
        updated_at: new Date().toISOString(),
      })
      .in('id', ids)

    if (updateError) {
      console.error('Error cancelling follow-ups:', updateError)
    }

  } catch (error) {
    console.error('Follow-up automation failed:', error)
  }
}