/**
 * src/app/api/ipd/discharge/route.ts
 *
 * IPD Discharge API — Complete discharge workflow
 *
 * When a patient is discharged:
 *   1. Updates IPD admission status → 'discharged'
 *   2. Frees the bed (status → 'cleaning' → 'available' after 5 min)
 *   3. Creates/updates discharge summary
 *   4. Updates patient profile with discharge details
 *   5. Creates follow-up appointment if specified
 *   6. Generates WhatsApp notification to patient
 *   7. Generates insurance document reminder if applicable
 *   8. Logs audit trail
 *   9. Returns redirect URL to patient profile
 *
 * POST /api/ipd/discharge
 *   Body: {
 *     admission_id: string (UUID)
 *     discharge_date: string (YYYY-MM-DD)
 *     discharge_time: string (HH:MM)
 *     condition_at_discharge: string
 *     final_diagnosis: string
 *     discharge_advice: string
 *     medications_at_discharge: string (JSON array or text)
 *     follow_up_date: string (YYYY-MM-DD) | null
 *     follow_up_note: string | null
 *     discharged_by: string (doctor name)
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireRole } from '@/lib/api-auth'
import { checkDischargeClearance, applyOverride } from '@/lib/discharge-clearance'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

export async function POST(req: NextRequest) {
  // 2026-06-04 audit fix (§8.3): discharge is admin/doctor-only.
  // Reception/staff cannot discharge a patient — that decision is clinical.
  // The previous requireAuth(req) let any active user discharge by direct API call.
  const auth = await requireRole(req, ['admin', 'doctor'])
  if (auth instanceof Response) return auth

  try {
    const body = await req.json()
    const {
      admission_id,
      discharge_date,
      discharge_time,
      condition_at_discharge,
      final_diagnosis,
      discharge_advice,
      medications_at_discharge,
      follow_up_date,
      follow_up_note,
      discharged_by,
      delivery_type,
      baby_sex,
      baby_weight,
      baby_birth_time,
      apgar_score,
      delivery_date,
      complications,
      lactation_advice,

      // 2026-06-04 audit fix (§4.1, §8.1): admin overrides for blocked
      // clearance categories. The shape mirrors the manualChecks param
      // of checkDischargeClearance(). Each override REQUIRES a reason
      // (recorded in the audit log) and the caller MUST be an admin.
      // Format:
      //   overrides: { billing?: { reason: string }, lab?: {...}, nursing?: {...}, ... }
      overrides,
    } = body

    if (!admission_id) {
      return NextResponse.json({ error: 'admission_id is required' }, { status: 400 })
    }

    // 1. Get the admission record
    const { data: admission, error: admErr } = await supabase
      .from('ipd_admissions')
      .select('*')
      .eq('id', admission_id)
      .single()

    if (admErr || !admission) {
      return NextResponse.json({ error: 'Admission not found' }, { status: 404 })
    }

    if (admission.status === 'discharged') {
      return NextResponse.json({
        error: 'Patient is already discharged',
        redirect: `/patients/${admission.patient_id}`,
      }, { status: 400 })
    }

    const now = new Date().toISOString()
    const patientId = admission.patient_id

    // ════════════════════════════════════════════════════════════════
    // 2026-06-04 audit fix (§4.1 / §8.1): server-side clearance gate.
    //
    // The discharge clearance checklist (unpaid bills, consent, final
    // vitals, doctor orders, …) was previously enforced ONLY in the
    // React component DischargeClearance.tsx. A direct POST to this
    // route bypassed the entire checklist. Now the server runs it
    // and refuses to discharge unless every required item is cleared
    // OR an admin has explicitly supplied a reasoned override.
    //
    // Override shape:
    //   { overrides: { billing: { reason: 'TPA settles in 7 days' }, ... } }
    //
    // Only role 'admin' may override. Doctors trigger discharge but
    // cannot bypass billing/consent/nursing — they must ask reception
    // to clear those first.
    // ════════════════════════════════════════════════════════════════
    let clearance = await checkDischargeClearance(admission_id, undefined)

    if (overrides && typeof overrides === 'object') {
      if (auth.role !== 'admin') {
        return NextResponse.json(
          { error: 'Only admin can apply discharge clearance overrides.' },
          { status: 403 },
        )
      }
      for (const [category, info] of Object.entries(overrides)) {
        const reason = (info as any)?.reason
        if (typeof reason !== 'string' || reason.trim().length === 0) {
          return NextResponse.json(
            { error: `Override for ${category} requires a non-empty reason.` },
            { status: 400 },
          )
        }
        clearance = applyOverride(
          clearance,
          category as any,
          reason.trim(),
          auth.fullName || auth.email || 'admin',
        )
      }
    }

    if (!clearance.canDischarge) {
      const blockingItems = clearance.items
        .filter(i => i.isRequired && (i.status === 'blocked' || i.status === 'pending'))
        .map(i => `${i.category}: ${i.label}${i.detail ? ` — ${i.detail}` : ''}`)
      return NextResponse.json(
        {
          error: 'Discharge blocked by pending clearance items.',
          blocked_count: clearance.blockedCount,
          blocking_items: blockingItems,
          clearance_summary: clearance.items.map(i => ({
            category: i.category,
            label: i.label,
            status: i.status,
            isRequired: i.isRequired,
          })),
        },
        { status: 409 },
      )
    }

    // 2026-06-04 audit fix (§4.2): idempotent / conditional update.
    // The previous code did .update().eq('id', ...) without checking
    // OLD.status. Two concurrent discharge requests both succeeded,
    // resulting in two discharge summaries, two follow-up appointments,
    // and two WhatsApp notifications. The .eq('status', admission.status)
    // ensures only ONE caller wins the race; the loser sees rows=0
    // and is safely told "already discharged".
    const { data: updatedAdm, error: updAdmErr } = await supabase
      .from('ipd_admissions')
      .update({
        status: 'discharged',
        updated_at: now,
      })
      .eq('id', admission_id)
      .eq('status', admission.status) // optimistic concurrency
      .select('id')

    if (updAdmErr) {
      return NextResponse.json({ error: 'Failed to update admission: ' + updAdmErr.message }, { status: 500 })
    }
    if (!updatedAdm || updatedAdm.length === 0) {
      // Another process already discharged this patient between our
      // SELECT and UPDATE.
      return NextResponse.json(
        {
          error: 'Patient discharge is already in progress or completed by another user.',
          redirect: `/patients/${patientId}`,
        },
        { status: 409 },
      )
    }

    // 3. Free the bed — mark as 'available' directly
    //    NOTE: In serverless environments (Vercel/Next.js), setTimeout() won't survive
    //    after the response is sent. The 'cleaning' intermediate state is removed.
    //    If a cleaning workflow is needed, implement it via a DB trigger or cron job.
    if (admission.bed_id) {
      await supabase.from('beds').update({
        status: 'available',
        patient_id: null,
        patient_name: null,
        admission_date: null,
        expected_discharge: null,
        updated_at: now,
      }).eq('id', admission.bed_id)
    }

    // 4. Create discharge summary
    const dischargeSummary = {
      patient_id: patientId,
      admission_date: admission.admission_date,
      discharge_date: discharge_date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
      final_diagnosis: final_diagnosis || admission.diagnosis_on_admission || '',
      clinical_summary: `Admitted for: ${admission.chief_complaint || admission.diagnosis_on_admission || 'Treatment'}. Doctor: ${admission.admitting_doctor}`,
      condition_at_discharge: condition_at_discharge || 'Satisfactory',
      discharge_advice: discharge_advice || '',
      medications_at_discharge: medications_at_discharge || '',
      follow_up_date: follow_up_date || null,
      follow_up_note: follow_up_note || '',
      signed_by: discharged_by || admission.admitting_doctor || '',
      is_final: false,
      version: 1,
      // OB/GYN delivery fields
      delivery_type: delivery_type || null,
      baby_sex: baby_sex || null,
      baby_weight: baby_weight || null,
      baby_birth_time: baby_birth_time || null,
      apgar_score: apgar_score || null,
      delivery_date: delivery_date || null,
      complications: complications || null,
      lactation_advice: lactation_advice || null,
      updated_at: now,
    }

    const { data: dsRecord, error: dsErr } = await supabase
      .from('discharge_summaries')
      .insert(dischargeSummary)
      .select('id')
      .single()

    // Don't fail if discharge_summaries table doesn't exist — just log
    if (dsErr) {
      console.error('[discharge] discharge_summaries insert error:', dsErr.message)
    }

    // 4b. AUTO-GENERATE IPD BILL from admission stay data
    //     Uses ipd-billing.ts to calculate bed charges, nursing, doctor visits, etc.
    //     Only generates if no existing IPD bill exists for this admission.
    //
    // 2026-06-04 audit fix (§4.3): the rates used here (wardRates) are
    // HEURISTIC defaults, not the actual charges recorded for this stay.
    // The bill is included as a starting draft and SHOULD be reviewed
    // and adjusted by reception before payment. The response includes
    // `ipd_bill_warning` to make this visible to the calling UI.
    let ipdBillId: string | null = null
    let ipdBillWarning: string | null = null
    try {
      // Check if an IPD bill already exists for this admission
      // FIX CRITICAL #7: Use admission_id column instead of fragile notes field match
      // The notes field can be modified by admin, breaking this lookup
      const { data: existingBill } = await supabase
        .from('bills')
        .select('id')
        .eq('patient_id', patientId)
        .or(`admission_id.eq.${admission_id},notes.eq.IPD-${admission_id}`)
        .limit(1)

      if (!existingBill || existingBill.length === 0) {
        // Calculate stay duration
        const admDate = new Date(admission.admission_date)
        const disDate = discharge_date ? new Date(discharge_date) : new Date()
        const stayMs = disDate.getTime() - admDate.getTime()
        const stayDays = Math.max(1, Math.ceil(stayMs / (1000 * 60 * 60 * 24)))

        // Get bed rate from ward config (default rates for Indian hospital)
        const wardRates: Record<string, { bed: number; nursing: number }> = {
          'General Ward': { bed: 800, nursing: 400 },
          'Semi-Private': { bed: 1500, nursing: 600 },
          'Private': { bed: 2500, nursing: 800 },
          'Deluxe': { bed: 4000, nursing: 1000 },
          'ICU': { bed: 5000, nursing: 1500 },
          'NICU': { bed: 4000, nursing: 1200 },
        }
        const rates = wardRates[admission.ward] || { bed: 1000, nursing: 500 }

        // Count doctor visits (nursing entries of type 'note' by doctor)
        const { count: doctorVisitCount } = await supabase
          .from('ipd_nursing')
          .select('id', { count: 'exact', head: true })
          .eq('ipd_admission_id', admission_id)
          .in('entry_type', ['note', 'medication'])

        const doctorVisits = Math.max(1, Math.ceil((doctorVisitCount || 0) / 3)) // Estimate from entries

        // Build bill items
        const billItems: { label: string; amount: number }[] = []

        if (stayDays > 0 && rates.bed > 0) {
          billItems.push({
            label: `Bed Charges - ${admission.ward} (${stayDays} days × ₹${rates.bed}/day)`,
            amount: stayDays * rates.bed,
          })
        }

        if (stayDays > 0 && rates.nursing > 0) {
          billItems.push({
            label: `Nursing Charges (${stayDays} days × ₹${rates.nursing}/day)`,
            amount: stayDays * rates.nursing,
          })
        }

        if (doctorVisits > 0) {
          const visitFee = 500
          billItems.push({
            label: `Doctor Visits (${doctorVisits} × ₹${visitFee})`,
            amount: doctorVisits * visitFee,
          })
        }

        // Only create bill if there are items
        if (billItems.length > 0) {
          const subtotal = billItems.reduce((s, i) => s + i.amount, 0)

          const { data: newBill } = await supabase
            .from('bills')
            .insert({
              patient_id: patientId,
              patient_name: admission.patient_name,
              mrn: admission.mrn || '',
              items: billItems,
              subtotal,
              discount: 0,
              gst_percent: 0,
              gst_amount: 0,
              net_amount: subtotal,
              total: subtotal,
              paid: 0,
              due: subtotal,
              payment_mode: null,
              status: 'unpaid',
              admission_id: admission_id,
              notes: `IPD-${admission_id}`,
              created_by: discharged_by || admission.admitting_doctor || 'system',
            })
            .select('id')
            .single()

          ipdBillId = newBill?.id || null

          if (ipdBillId) {
            // 2026-06-04 audit fix (§4.3): heuristic-rates warning surfaced.
            ipdBillWarning =
              'Auto-generated IPD bill uses default ward rates and an estimated ' +
              'doctor-visit count from nursing entries. Please review and adjust ' +
              'in the billing page before collecting payment.'
            console.log(`[discharge] Auto-generated IPD bill ${ipdBillId} for ₹${subtotal} (HEURISTIC RATES — review before collecting)`)
          }
        }
      } else {
        ipdBillId = existingBill[0].id
      }
    } catch (billErr: any) {
      // Non-fatal — discharge proceeds even if bill generation fails
      console.error('[discharge] IPD bill auto-generation failed (non-fatal):', billErr?.message)
    }

    // 5. Create follow-up appointment if date specified
    if (follow_up_date) {
      await supabase.from('appointments').insert({
        patient_id: patientId,
        patient_name: admission.patient_name,
        mrn: admission.mrn,
        mobile: admission.mobile,
        date: follow_up_date,
        time: '10:00',
        type: 'Follow-up (Post-Discharge)',
        status: 'scheduled',
        notes: follow_up_note || `Post-discharge follow-up. Admitted: ${admission.admission_date}. Diagnosis: ${admission.diagnosis_on_admission || '—'}`,
      })
    }

    // 6. Queue WhatsApp notification
    const patientNotification = {
      patient_id: patientId,
      patient_name: admission.patient_name,
      mobile: admission.mobile,
      notification_type: 'discharge',
      message_preview: `You have been discharged from ${admission.ward} (Bed ${admission.bed_number}). ${follow_up_date ? `Follow-up on ${follow_up_date}.` : ''} ${discharge_advice ? `Advice: ${discharge_advice.slice(0, 100)}` : ''}`,
      recipient_type: 'patient',
      status: 'queued',
      metadata: JSON.stringify({
        admission_id,
        bed_number: admission.bed_number,
        ward: admission.ward,
        discharge_date: discharge_date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
        follow_up_date,
      }),
    }

    await supabase.from('whatsapp_notifications').insert(patientNotification)

    // 7. If patient has insurance, queue insurance doc reminder (3 days later)
    if (admission.insurance_details) {
      await supabase.from('whatsapp_notifications').insert({
        patient_id: patientId,
        patient_name: admission.patient_name,
        mobile: admission.mobile,
        notification_type: 'insurance_docs_ready',
        message_preview: `Your insurance documents for ${admission.insurance_details} are ready for pickup. Please visit billing counter.`,
        recipient_type: 'patient',
        status: 'scheduled',
        scheduled_for: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        metadata: JSON.stringify({
          insurance_details: admission.insurance_details,
          admission_id,
        }),
      })

      // Auto-sync insurance claim: advance status to 'claim_submitted' on discharge
      try {
        await supabase.rpc('http_post', {}) // fallback: direct DB update
      } catch { /* fallback below */ }

      // Direct insurance claim status update on discharge
      const { data: activeClaims } = await supabase
        .from('insurance_claims')
        .select('id, status')
        .eq('patient_id', patientId)
        .not('status', 'in', '("settled","rejected")')
        .limit(1)

      if (activeClaims && activeClaims.length > 0) {
        const claim = activeClaims[0]
        if (['pre_auth_pending', 'pre_auth_approved'].includes(claim.status)) {
          await supabase.from('insurance_claims').update({
            status: 'claim_submitted',
            discharge_date: discharge_date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
            updated_at: now,
          }).eq('id', claim.id)

          await supabase.from('insurance_claim_history').insert({
            claim_id: claim.id,
            old_status: claim.status,
            new_status: 'claim_submitted',
            notes: `Auto-advanced on discharge (${discharge_date || 'today'})`,
            done_by: discharged_by || 'system',
          })
        }
      } else {
        // No existing claim — create one automatically
        await supabase.from('insurance_claims').insert({
          patient_id: patientId,
          patient_name: admission.patient_name,
          mrn: admission.mrn || '',
          status: 'claim_submitted',
          diagnosis: final_diagnosis || admission.diagnosis_on_admission || null,
          admission_date: admission.admission_date || null,
          discharge_date: discharge_date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
          notes: `Auto-created on discharge. Insurance: ${admission.insurance_details}`,
          created_by: 'system',
          documents_sent: false,
        })
      }
    }

    // 8. Audit log
    // 2026-06-04 audit fix (§4.4 / §7.2): use the insert_audit_entry RPC
    // (which computes the SHA-256 hash chain atomically — see migration
    // fresh-install/02_audit_chain.sql). Previously this was a direct
    // INSERT into audit_log with no entry_hash, which broke the chain;
    // and it used `.then(()=>{})` so the call could be dropped before
    // serverless function exit.
    try {
      await supabase.rpc('insert_audit_entry', {
        p_user_id:      auth.clinicUserId,
        p_user_email:   auth.email,
        p_user_role:    auth.role,
        p_action:       'delete', // 'discharge' isn't in the audit action enum; 'delete' is the closest semantic
        p_entity_type:  'discharge',
        p_entity_id:    admission_id,
        p_entity_label: `${admission.patient_name} discharged from ${admission.bed_number}`,
        p_changes: JSON.stringify({
          discharge_date,
          discharge_time,
          condition_at_discharge,
          final_diagnosis,
          follow_up_date,
          discharged_by,
          overrides: overrides ? Object.keys(overrides) : [],
          clearance_status: clearance.canDischarge ? 'cleared' : 'overridden',
        }),
      })
    } catch (auditErr: any) {
      // Non-fatal: don't block discharge on audit failure, but DO log loudly.
      console.error('[discharge] insert_audit_entry RPC failed:', auditErr?.message)
    }

    // 8b. Create in-app notification for all staff (now awaited so it
    //     can't be dropped by serverless cold-shutdown)
    try {
      await supabase.from('clinic_notifications').insert({
        title: `Discharge: ${admission.patient_name}`,
        message: `${admission.patient_name} (Bed ${admission.bed_number}, ${admission.ward}) discharged by Dr. ${discharged_by || admission.admitting_doctor}. Condition: ${condition_at_discharge || 'Satisfactory'}.${follow_up_date ? ` Follow-up: ${follow_up_date}` : ''}`,
        type: 'discharge',
        severity: 'normal',
        source: 'ipd',
        entity_type: 'admission',
        entity_id: admission_id,
        patient_id: patientId,
        patient_name: admission.patient_name,
        mrn: admission.mrn || null,
        target_roles: ['admin', 'doctor', 'staff'],
        metadata: JSON.stringify({
          bed_number: admission.bed_number,
          ward: admission.ward,
          discharged_by,
          condition_at_discharge,
        }),
      })
    } catch (notifErr: any) {
      console.warn('[discharge] clinic_notifications insert failed (non-fatal):', notifErr?.message)
    }

    // 9. Return success with redirect
    return NextResponse.json({
      ok: true,
      message: `${admission.patient_name} discharged successfully from Bed ${admission.bed_number}`,
      redirect: `/patients/${patientId}`,
      discharge_summary_id: dsRecord?.id || null,
      ipd_bill_id: ipdBillId,
      ipd_bill_warning: ipdBillWarning,        // §4.3
      clearance_overrides: clearance.overrides, // §4.1 — empty array if no overrides
      patient_id: patientId,
      notifications: {
        patient_whatsapp: 'queued',
        insurance_reminder: admission.insurance_details ? 'scheduled_3_days' : 'n/a',
        follow_up_appointment: follow_up_date ? 'created' : 'n/a',
        ipd_bill: ipdBillId ? 'auto_generated' : 'n/a',
      },
    })
  } catch (err: any) {
    console.error('[IPD Discharge] Error:', err)
    return NextResponse.json({ error: err.message || 'Discharge failed' }, { status: 500 })
  }
}