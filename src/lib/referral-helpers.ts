/**
 * src/lib/referral-helpers.ts
 *
 * Referral management for outgoing referrals from gynaecologist.
 * Includes referral letter template generation, CRUD, and status tracking.
 *
 * Common referral destinations for Indian gynaecologists:
 * - Sonography centres (TVS, NT scan, anomaly scan, growth scan)
 * - Higher centres (high-risk pregnancy, fetal medicine)
 * - Endocrinologists (PCOS, thyroid disorders, GDM)
 * - Oncologists (cervical/ovarian/endometrial)
 * - Urologists / Urogynecologists
 * - Dermatologists (vulval conditions)
 * - Neonatologists (expected preterm, IUGR)
 * - Physicians (medical comorbidities in pregnancy)
 *
 * NON-BREAKING: New file. No existing code modified.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ReferralInput {
  patient_id: string;
  encounter_id?: string;
  referral_type?: string;
  referred_to_name: string;
  referred_to_specialty?: string;
  referred_to_hospital?: string;
  referred_to_phone?: string;
  referred_to_email?: string;
  referred_to_address?: string;
  reason: string;
  clinical_summary?: string;
  urgency?: 'routine' | 'urgent' | 'emergency';
  provisional_diagnosis?: string;
  investigations_done?: Array<{ name: string; date?: string; result?: string }>;
  investigations_requested?: Array<{ name: string; notes?: string }>;
  referring_doctor_id?: string;
  referring_doctor_name?: string;
  letter_content?: string;
  notes?: string;
}

export interface Referral extends ReferralInput {
  id: string;
  status: string;
  sent_at: string | null;
  acknowledged_at: string | null;
  appointment_date: string | null;
  report_received: boolean;
  report_summary: string | null;
  report_attachment_id: string | null;
  closed_at: string | null;
  letter_pdf_path: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Referral Type Constants ────────────────────────────────────────────────

export const REFERRAL_TYPES = {
  SPECIALIST: 'specialist',
  IMAGING: 'imaging',
  LAB: 'lab',
  HIGHER_CENTRE: 'higher_centre',
  INTERDEPARTMENTAL: 'interdepartmental',
  SECOND_OPINION: 'second_opinion',
} as const;

export const REFERRAL_STATUS = {
  CREATED: 'created',
  SENT: 'sent',
  ACKNOWLEDGED: 'acknowledged',
  APPOINTMENT_SCHEDULED: 'appointment_scheduled',
  REPORT_RECEIVED: 'report_received',
  CLOSED: 'closed',
  CANCELLED: 'cancelled',
} as const;

export const URGENCY_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  routine:   { label: 'Routine',   color: 'text-green-700',  bgColor: 'bg-green-50'  },
  urgent:    { label: 'Urgent',    color: 'text-orange-700', bgColor: 'bg-orange-50' },
  emergency: { label: 'Emergency', color: 'text-red-700',    bgColor: 'bg-red-50'    },
};

// ─── Common Referral Destinations (Indian Gynaecology) ──────────────────────

export const COMMON_REFERRAL_SPECIALTIES = [
  { value: 'sonography', label: 'Sonography / Radiology' },
  { value: 'fetal_medicine', label: 'Fetal Medicine Specialist' },
  { value: 'endocrinology', label: 'Endocrinologist' },
  { value: 'oncology_gynae', label: 'Gynaecological Oncologist' },
  { value: 'oncology_surgical', label: 'Surgical Oncologist' },
  { value: 'urology', label: 'Urologist / Urogynecologist' },
  { value: 'neonatology', label: 'Neonatologist' },
  { value: 'physician', label: 'Physician / Internist' },
  { value: 'cardiology', label: 'Cardiologist' },
  { value: 'dermatology', label: 'Dermatologist' },
  { value: 'psychiatry', label: 'Psychiatrist' },
  { value: 'physiotherapy', label: 'Physiotherapist' },
  { value: 'dietician', label: 'Dietician / Nutritionist' },
  { value: 'genetics', label: 'Genetic Counsellor' },
  { value: 'anaesthesia', label: 'Anaesthesiologist' },
  { value: 'higher_centre', label: 'Tertiary Care / Higher Centre' },
  { value: 'other', label: 'Other' },
];

export const COMMON_IMAGING_REFERRALS = [
  'TVS (Transvaginal Sonography)',
  'TAS (Transabdominal Sonography)',
  'NT Scan (Nuchal Translucency)',
  'Anomaly Scan (Level 2)',
  'Growth Scan',
  'Doppler Study',
  'Fetal Echo',
  'HSG (Hysterosalpingography)',
  'MRI Pelvis',
  'CT Scan',
  'Mammography',
  'Breast USG',
  'DEXA Scan (Bone Density)',
];

// ─── Referral Letter Generator ──────────────────────────────────────────────

export interface LetterContext {
  clinicName: string;
  clinicAddress: string;
  clinicPhone: string;
  doctorName: string;
  doctorQualification: string;
  doctorRegNumber: string;
  patientName: string;
  patientAge: number | string;
  patientGender: string;
  patientPhone?: string;
  patientAddress?: string;
}

/**
 * Generate a referral letter from structured data.
 * Returns HTML that can be printed or converted to PDF.
 */
export function generateReferralLetter(
  referral: ReferralInput,
  context: LetterContext
): string {
  const today = new Date().toLocaleDateString('en-IN', {
    day: '2-digit', month: 'long', year: 'numeric',
  });

  const investigationsList = (referral.investigations_done || [])
    .map(i => `<li>${i.name}${i.date ? ` (${i.date})` : ''}${i.result ? ` — ${i.result}` : ''}</li>`)
    .join('\n');

  const requestedList = (referral.investigations_requested || [])
    .map(i => `<li>${i.name}${i.notes ? ` — ${i.notes}` : ''}</li>`)
    .join('\n');

  return `<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; color: #222; font-size: 14px; line-height: 1.6; }
  .header { text-align: center; border-bottom: 2px solid #1a56db; padding-bottom: 15px; margin-bottom: 20px; }
  .header h1 { margin: 0; font-size: 22px; color: #1a56db; }
  .header p { margin: 2px 0; font-size: 12px; color: #555; }
  .date-ref { display: flex; justify-content: space-between; margin-bottom: 15px; font-size: 13px; }
  .to-section { margin-bottom: 15px; }
  .to-section strong { color: #1a56db; }
  .patient-box { background: #f8f9fa; border: 1px solid #ddd; border-radius: 6px; padding: 12px; margin-bottom: 15px; }
  .patient-box h3 { margin: 0 0 8px 0; font-size: 14px; color: #333; }
  .patient-box .row { display: flex; gap: 20px; font-size: 13px; }
  .section { margin-bottom: 15px; }
  .section h3 { font-size: 14px; color: #1a56db; border-bottom: 1px solid #e0e0e0; padding-bottom: 4px; margin-bottom: 8px; }
  .urgency-badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; }
  .urgency-routine { background: #dcfce7; color: #166534; }
  .urgency-urgent { background: #fef3c7; color: #92400e; }
  .urgency-emergency { background: #fee2e2; color: #991b1b; }
  .footer { margin-top: 40px; border-top: 1px solid #ddd; padding-top: 15px; }
  .signature { margin-top: 40px; text-align: right; }
  .signature .name { font-weight: bold; }
  ul { margin: 4px 0; padding-left: 20px; }
  @media print { body { margin: 0; padding: 10mm; } }
</style>
</head>
<body>
  <div class="header">
    <h1>${context.clinicName}</h1>
    <p>${context.clinicAddress}</p>
    <p>Phone: ${context.clinicPhone}</p>
  </div>

  <div class="date-ref">
    <span>Date: ${today}</span>
    <span class="urgency-badge urgency-${referral.urgency || 'routine'}">
      ${(referral.urgency || 'routine').toUpperCase()}
    </span>
  </div>

  <div class="to-section">
    <strong>To:</strong> ${referral.referred_to_name}<br/>
    ${referral.referred_to_specialty ? `<em>${referral.referred_to_specialty}</em><br/>` : ''}
    ${referral.referred_to_hospital ? `${referral.referred_to_hospital}<br/>` : ''}
    ${referral.referred_to_address ? `${referral.referred_to_address}<br/>` : ''}
  </div>

  <p>Dear Doctor,</p>
  <p>I am referring the following patient for your expert opinion and management:</p>

  <div class="patient-box">
    <h3>Patient Details</h3>
    <div class="row">
      <span><strong>Name:</strong> ${context.patientName}</span>
      <span><strong>Age/Gender:</strong> ${context.patientAge}y / ${context.patientGender}</span>
      ${context.patientPhone ? `<span><strong>Phone:</strong> ${context.patientPhone}</span>` : ''}
    </div>
  </div>

  <div class="section">
    <h3>Reason for Referral</h3>
    <p>${referral.reason}</p>
  </div>

  ${referral.provisional_diagnosis ? `
  <div class="section">
    <h3>Provisional Diagnosis</h3>
    <p>${referral.provisional_diagnosis}</p>
  </div>` : ''}

  ${referral.clinical_summary ? `
  <div class="section">
    <h3>Clinical Summary</h3>
    <p>${referral.clinical_summary}</p>
  </div>` : ''}

  ${investigationsList ? `
  <div class="section">
    <h3>Investigations Done</h3>
    <ul>${investigationsList}</ul>
  </div>` : ''}

  ${requestedList ? `
  <div class="section">
    <h3>Investigations Requested</h3>
    <ul>${requestedList}</ul>
  </div>` : ''}

  ${referral.notes ? `
  <div class="section">
    <h3>Additional Notes</h3>
    <p>${referral.notes}</p>
  </div>` : ''}

  <p>Kindly evaluate and advise. Your opinion will be highly appreciated.</p>
  <p>Thanking you,</p>

  <div class="signature">
    <div class="name">Dr. ${context.doctorName}</div>
    <div>${context.doctorQualification}</div>
    <div>Reg. No.: ${context.doctorRegNumber}</div>
    <div>${context.clinicName}</div>
  </div>
</body>
</html>`;
}

// ─── CRUD Functions ─────────────────────────────────────────────────────────

export async function createReferral(
  supabase: SupabaseClient,
  input: ReferralInput
): Promise<{ data: Referral | null; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('referrals')
      .insert({
        ...input,
        status: 'created',
        investigations_done: input.investigations_done || [],
        investigations_requested: input.investigations_requested || [],
      })
      .select('*')
      .single();

    if (error) return { data: null, error: error.message };
    return { data: data as Referral, error: null };
  } catch (err) {
    return { data: null, error: String(err) };
  }
}

export async function updateReferral(
  supabase: SupabaseClient,
  id: string,
  updates: Partial<ReferralInput> & { status?: string; appointment_date?: string; report_summary?: string; report_received?: boolean }
): Promise<{ data: Referral | null; error: string | null }> {
  try {
    // Auto-set timestamps based on status
    const extra: Record<string, unknown> = {};
    if (updates.status === 'sent') extra.sent_at = new Date().toISOString();
    if (updates.status === 'acknowledged') extra.acknowledged_at = new Date().toISOString();
    if (updates.status === 'closed') extra.closed_at = new Date().toISOString();
    if (updates.report_received) extra.report_received = true;

    const { data, error } = await supabase
      .from('referrals')
      .update({ ...updates, ...extra })
      .eq('id', id)
      .select('*')
      .single();

    if (error) return { data: null, error: error.message };
    return { data: data as Referral, error: null };
  } catch (err) {
    return { data: null, error: String(err) };
  }
}

export async function getEncounterReferrals(
  supabase: SupabaseClient,
  encounterId: string
): Promise<{ data: Referral[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('referrals')
      .select('*')
      .eq('encounter_id', encounterId)
      .order('created_at', { ascending: false });

    if (error) return { data: [], error: error.message };
    return { data: (data || []) as Referral[], error: null };
  } catch (err) {
    return { data: [], error: String(err) };
  }
}

export async function getPatientReferrals(
  supabase: SupabaseClient,
  patientId: string,
  options: { status?: string; limit?: number } = {}
): Promise<{ data: Referral[]; error: string | null }> {
  try {
    let query = supabase
      .from('referrals')
      .select('*')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
      .limit(options.limit || 50);

    if (options.status) {
      query = query.eq('status', options.status);
    }

    const { data, error } = await query;
    if (error) return { data: [], error: error.message };
    return { data: (data || []) as Referral[], error: null };
  } catch (err) {
    return { data: [], error: String(err) };
  }
}

/**
 * Get pending referrals (sent but no report received yet).
 * Useful for a "Pending Reports" dashboard widget.
 */
export async function getPendingReferrals(
  supabase: SupabaseClient,
  doctorId?: string
): Promise<{ data: Referral[]; error: string | null }> {
  try {
    let query = supabase
      .from('referrals')
      .select('*, patients(id, name, phone, mrn)')
      .in('status', ['created', 'sent', 'acknowledged', 'appointment_scheduled'])
      .eq('report_received', false)
      .order('created_at', { ascending: true });

    if (doctorId) {
      query = query.eq('referring_doctor_id', doctorId);
    }

    const { data, error } = await query;
    if (error) return { data: [], error: error.message };
    return { data: (data || []) as Referral[], error: null };
  } catch (err) {
    return { data: [], error: String(err) };
  }
}
