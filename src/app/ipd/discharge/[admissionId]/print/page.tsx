'use client'
/**
 * src/app/ipd/discharge/[admissionId]/print/page.tsx
 *
 * Professional Discharge Summary — Print / PDF Page
 *
 * Opens in a clean window with NO navigation or app shell.
 * Designed for browser Print → PDF or direct printing.
 *
 * Pulls data from:
 *   - ipd_admissions (admission details)
 *   - patients (demographics)
 *   - discharge_summaries (clinical summary, advice, medications)
 *   - delivery_records (obstetric/baby details)
 *   - surgery_records (surgical procedure details)
 *   - encounters (doctor round notes)
 *   - lab_orders (investigation results)
 *   - prescriptions (discharge medications)
 *
 * Hospital letterhead from getHospitalSettings().
 *
 * USAGE: Navigate to /ipd/discharge/[admissionId]/print
 *        Or window.open('/ipd/discharge/[admissionId]/print', '_blank')
 */

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { formatDate, getHospitalSettings } from '@/lib/utils'

export default function DischargeSummaryPrintPage() {
  const params = useParams()
  const admissionId = params.admissionId as string

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [admission, setAdmission] = useState<any>(null)
  const [patient, setPatient] = useState<any>(null)
  const [ds, setDs] = useState<any>(null)
  const [delivery, setDelivery] = useState<any>(null)
  const [surgery, setSurgery] = useState<any>(null)
  const [encounters, setEncounters] = useState<any[]>([])
  const [labs, setLabs] = useState<any[]>([])
  const [prescriptions, setPrescriptions] = useState<any[]>([])
  const [charges, setCharges] = useState<any[]>([])
  const [totalBilled, setTotalBilled] = useState(0)

  const hs = typeof window !== 'undefined' ? getHospitalSettings() : {
    hospitalName: 'Hospital', address: '', phone: '', regNo: '', gstin: '',
    doctorName: 'Doctor', doctorQual: '', doctorReg: '', footerNote: '',
    doctorSignatureUrl: '',
  }

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      // 1. Admission
      const { data: adm } = await supabase.from('ipd_admissions')
        .select('*').eq('id', admissionId).single()
      if (!adm) { setError('Admission not found'); setLoading(false); return }
      setAdmission(adm)

      // 2. Patient
      const { data: pat } = await supabase.from('patients')
        .select('*').eq('id', adm.patient_id).single()
      if (pat) setPatient(pat)

      // 3. Discharge summary
      const { data: dsd } = await supabase.from('discharge_summaries')
        .select('*').eq('patient_id', adm.patient_id)
        .order('created_at', { ascending: false }).limit(1).single()
      if (dsd) setDs(dsd)

      // 4. Delivery record
      const { data: del } = await supabase.from('delivery_records')
        .select('*').eq('ipd_admission_id', admissionId)
        .order('baby_number', { ascending: true })
      if (del && del.length > 0) setDelivery(del)

      // 5. Surgery record
      const { data: sur } = await supabase.from('surgery_records')
        .select('*').eq('ipd_admission_id', admissionId)
        .order('surgery_date', { ascending: false }).limit(1).single()
      if (sur) setSurgery(sur)

      // 6. Encounters (doctor round notes)
      const { data: enc } = await supabase.from('encounters')
        .select('*').eq('patient_id', adm.patient_id)
        .gte('encounter_date', adm.admission_date)
        .order('created_at', { ascending: true })
      setEncounters(enc || [])

      // 7. Labs
      const { data: lab } = await supabase.from('lab_orders')
        .select('*').eq('patient_id', adm.patient_id)
        .eq('status', 'completed')
        .order('created_at', { ascending: false }).limit(20)
      setLabs(lab || [])

      // 8. Prescriptions
      const { data: rx } = await supabase.from('prescriptions')
        .select('*').eq('patient_id', adm.patient_id)
        .order('created_at', { ascending: false }).limit(5)
      setPrescriptions(rx || [])

      // 9. Charges total
      const { data: chg } = await supabase.from('ipd_charges')
        .select('amount').eq('admission_id', admissionId)
      if (chg) {
        setCharges(chg)
        setTotalBilled(chg.reduce((s: number, c: any) => s + (c.amount || 0), 0))
      }

    } catch (err: any) {
      setError(err.message || 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [admissionId])

  useEffect(() => { loadAll() }, [loadAll])

  // Auto-print after load
  useEffect(() => {
    if (!loading && !error && admission) {
      // Small delay to ensure render is complete
      const timer = setTimeout(() => {
        // Don't auto-print, let user click print
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [loading, error, admission])

  const daysBetween = (a: string, b: string) => {
    if (!a || !b) return 0
    return Math.max(1, Math.ceil((new Date(b).getTime() - new Date(a).getTime()) / 86400000))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">Loading discharge summary...</p>
      </div>
    )
  }

  if (error || !admission || !patient) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-red-500">{error || 'Data not found'}</p>
      </div>
    )
  }

  const admDate = ds?.admission_date || admission.admission_date
  const disDate = ds?.discharge_date || admission.discharge_date || ''
  const los = daysBetween(admDate, disDate)

  return (
    <>
      {/* Print Styles */}
      <style jsx global>{`
        @media print {
          body { margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
          .print-page { padding: 10mm 12mm !important; max-width: 100% !important; }
          .page-break { page-break-before: always; }
          @page { size: A4; margin: 8mm 10mm; }
        }
        @media screen {
          body { background: #e5e7eb; }
        }
      `}</style>

      {/* Print toolbar (screen only) */}
      <div className="no-print bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between sticky top-0 z-50 shadow-sm">
        <div className="flex items-center gap-3">
          <button onClick={() => window.history.back()}
            className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50">
            ← Back
          </button>
          <span className="text-sm text-gray-600">
            Discharge Summary — <strong>{patient.full_name}</strong> · MRN: {patient.mrn || '—'}
          </span>
        </div>
        <div className="flex gap-2">
          <button onClick={() => window.print()}
            className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg text-sm font-medium">
            🖨️ Print / Save as PDF
          </button>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* PRINTABLE DISCHARGE SUMMARY                                     */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="print-page max-w-[800px] mx-auto bg-white shadow-lg my-6 p-10 text-[12px] leading-relaxed text-gray-900"
           style={{ fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif" }}>

        {/* ── HOSPITAL LETTERHEAD ──────────────────────────────── */}
        <div className="text-center pb-3 mb-4 border-b-[3px] border-gray-800">
          <div className="text-[22px] font-bold tracking-[0.15em] uppercase text-gray-900">
            {hs.hospitalName}
          </div>
          <div className="text-[11px] text-gray-600 mt-1">{hs.address}</div>
          <div className="text-[10px] text-gray-500 mt-0.5">
            Tel: {hs.phone}
            {hs.regNo && <span className="ml-3">Reg. No: {hs.regNo}</span>}
            {hs.gstin && <span className="ml-3">GSTIN: {hs.gstin}</span>}
          </div>
          <div className="mt-3 text-[16px] font-bold tracking-[0.2em] uppercase border-t border-b border-gray-400 py-1.5 mx-16">
            Discharge Summary
          </div>
        </div>

        {/* ── PATIENT INFORMATION ──────────────────────────────── */}
        <table className="w-full text-[11px] border border-gray-400 mb-4" style={{ borderCollapse: 'collapse' }}>
          <tbody>
            <tr>
              <TD label="Patient Name" value={patient.full_name} bold />
              <TD label="MRN" value={patient.mrn || '—'} />
            </tr>
            <tr>
              <TD label="Age / Gender" value={`${patient.age || '—'} years / ${patient.gender || '—'}`} />
              <TD label="Blood Group" value={patient.blood_group || '—'} />
            </tr>
            <tr>
              <TD label="Mobile" value={patient.mobile || '—'} />
              <TD label="ABHA ID" value={patient.abha_id || '—'} />
            </tr>
            <tr>
              <TD label="Address" value={patient.address || '—'} full />
            </tr>
            <tr className="bg-gray-50">
              <TD label="Date of Admission" value={admDate ? formatDate(admDate) : '—'} />
              <TD label="Date of Discharge" value={disDate ? formatDate(disDate) : '—'} />
            </tr>
            <tr className="bg-gray-50">
              <TD label="Length of Stay" value={`${los} day${los !== 1 ? 's' : ''}`} />
              <TD label="Admitting Doctor" value={admission.admitting_doctor || ds?.signed_by || '—'} />
            </tr>
            <tr>
              <TD label="Ward / Bed" value={`${admission.ward || '—'} / Bed ${admission.bed_number || '—'}`} />
              <TD label="Insurance" value={admission.insurance_details || '—'} />
            </tr>
          </tbody>
        </table>

        {/* ── DIAGNOSIS ────────────────────────────────────────── */}
        <SectionBox title="Diagnosis">
          <div className="mb-1"><strong>Final Diagnosis: </strong>{ds?.final_diagnosis || admission.diagnosis_on_admission || '—'}</div>
          {ds?.secondary_diagnosis && <div><strong>Secondary: </strong>{ds.secondary_diagnosis}</div>}
        </SectionBox>

        {/* ── CLINICAL SUMMARY ─────────────────────────────────── */}
        {ds?.clinical_summary && (
          <SectionBox title="Clinical Summary">
            <div className="whitespace-pre-line">{ds.clinical_summary}</div>
          </SectionBox>
        )}

        {/* ── SURGERY / PROCEDURE DETAILS ──────────────────────── */}
        {surgery && (
          <SectionBox title="Surgery / Procedure Details" accent="border-orange-300 bg-orange-50/30">
            <table className="w-full text-[11px]" style={{ borderCollapse: 'collapse' }}>
              <tbody>
                <tr>
                  <TD label="Procedure" value={surgery.surgery_name || '—'} bold />
                  <TD label="Date" value={surgery.surgery_date ? formatDate(surgery.surgery_date) : '—'} />
                </tr>
                <tr>
                  <TD label="Approach" value={surgery.approach || '—'} />
                  <TD label="Anesthesia" value={surgery.anesthesia_type || '—'} />
                </tr>
                <tr>
                  <TD label="Surgeon" value={surgery.surgeon || '—'} />
                  <TD label="Anesthesiologist" value={surgery.anesthesiologist || '—'} />
                </tr>
                {surgery.indication && <tr><TD label="Indication" value={surgery.indication} full /></tr>}
                {surgery.findings && <tr><TD label="Findings" value={surgery.findings} full /></tr>}
                {surgery.procedure_details && <tr><TD label="Procedure Details" value={surgery.procedure_details} full /></tr>}
                {surgery.post_op_diagnosis && <tr><TD label="Post-Op Diagnosis" value={surgery.post_op_diagnosis} full /></tr>}
                {surgery.complications_intraop && <tr><TD label="Complications" value={surgery.complications_intraop} full /></tr>}
              </tbody>
            </table>
          </SectionBox>
        )}

        {/* ── DELIVERY / OBSTETRIC DETAILS ─────────────────────── */}
        {delivery && delivery.length > 0 && (
          <SectionBox title="Delivery / Obstetric Details" accent="border-pink-300 bg-pink-50/30">
            {delivery.map((d: any, idx: number) => (
              <div key={d.id} className={idx > 0 ? 'mt-3 pt-3 border-t border-pink-200' : ''}>
                {delivery.length > 1 && <div className="font-bold text-pink-800 text-[10px] mb-1">Baby {d.baby_number}</div>}
                <table className="w-full text-[11px]" style={{ borderCollapse: 'collapse' }}>
                  <tbody>
                    <tr>
                      <TD label="Delivery Type" value={d.delivery_type || '—'} />
                      <TD label="Date & Time" value={`${d.delivery_date ? formatDate(d.delivery_date) : '—'} ${d.delivery_time || ''}`} />
                    </tr>
                    <tr>
                      <TD label="Baby Sex" value={d.baby_sex || '—'} />
                      <TD label="Birth Weight" value={d.baby_weight_kg ? `${d.baby_weight_kg} kg` : '—'} />
                    </tr>
                    <tr>
                      <TD label="APGAR Score" value={[d.apgar_1min, d.apgar_5min, d.apgar_10min].filter(Boolean).join(' / ') || '—'} />
                      <TD label="Cry at Birth" value={d.cry_at_birth || '—'} />
                    </tr>
                    <tr>
                      <TD label="Baby Condition" value={d.baby_condition || '—'} />
                      <TD label="NICU Admission" value={d.nicu_admission ? `Yes — ${d.nicu_reason || ''}` : 'No'} />
                    </tr>
                    {d.episiotomy && d.episiotomy !== 'None' && (
                      <tr><TD label="Episiotomy" value={d.episiotomy} /><TD label="Perineal Tear" value={d.perineal_tear || 'None'} /></tr>
                    )}
                    {d.blood_loss_ml && <tr><TD label="Blood Loss" value={`${d.blood_loss_ml} ml`} /><TD label="Mother Condition" value={d.mother_condition || '—'} /></tr>}
                    {d.delivering_doctor && <tr><TD label="Delivering Doctor" value={d.delivering_doctor} /><TD label="Pediatrician" value={d.pediatrician || '—'} /></tr>}
                  </tbody>
                </table>
                {/* Newborn Vaccinations */}
                {(d.vitamin_k_given || d.bcg_given || d.opv_zero_given || d.hep_b_given) && (
                  <div className="mt-2 text-[10px]">
                    <strong>Vaccines Given at Birth: </strong>
                    {[d.vitamin_k_given && 'Vitamin K', d.bcg_given && 'BCG', d.opv_zero_given && 'OPV-0', d.hep_b_given && 'Hep-B'].filter(Boolean).join(', ')}
                  </div>
                )}
              </div>
            ))}
          </SectionBox>
        )}

        {/* ── INVESTIGATIONS ───────────────────────────────────── */}
        {(ds?.investigations || labs.length > 0) && (
          <SectionBox title="Investigations">
            {ds?.investigations && <div className="whitespace-pre-line mb-2">{ds.investigations}</div>}
            {labs.length > 0 && !ds?.investigations && (
              <table className="w-full text-[10px]" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr className="bg-gray-100">
                    <th className="text-left p-1 border border-gray-300">Test</th>
                    <th className="text-left p-1 border border-gray-300">Result</th>
                    <th className="text-left p-1 border border-gray-300">Normal Range</th>
                  </tr>
                </thead>
                <tbody>
                  {labs.slice(0, 15).map((l: any) => (
                    <tr key={l.id}>
                      <td className="p-1 border border-gray-200">{l.test_name}</td>
                      <td className="p-1 border border-gray-200 font-medium">{l.result_value || l.result || '—'}</td>
                      <td className="p-1 border border-gray-200 text-gray-500">{l.normal_range || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </SectionBox>
        )}

        {/* ── TREATMENT GIVEN ──────────────────────────────────── */}
        {ds?.treatment_given && (
          <SectionBox title="Treatment Given">
            <div className="whitespace-pre-line">{ds.treatment_given}</div>
          </SectionBox>
        )}

        {/* ── CONDITION AT DISCHARGE ───────────────────────────── */}
        {ds?.condition_at_discharge && (
          <SectionBox title="Condition at Discharge">
            <div>{ds.condition_at_discharge}</div>
          </SectionBox>
        )}

        {/* ── MEDICATIONS AT DISCHARGE ─────────────────────────── */}
        {ds?.medications_at_discharge && (
          <SectionBox title="Medications at Discharge" accent="border-blue-300 bg-blue-50/30">
            <div className="whitespace-pre-line font-medium">{ds.medications_at_discharge}</div>
          </SectionBox>
        )}

        {/* ── DISCHARGE ADVICE ─────────────────────────────────── */}
        {ds?.discharge_advice && (
          <SectionBox title="Discharge Advice">
            <div className="whitespace-pre-line">{ds.discharge_advice}</div>
          </SectionBox>
        )}

        {/* ── DIETARY ADVICE ───────────────────────────────────── */}
        {ds?.diet_advice && (
          <SectionBox title="Dietary Advice">
            <div className="whitespace-pre-line">{ds.diet_advice}</div>
          </SectionBox>
        )}

        {/* ── LACTATION ADVICE ─────────────────────────────────── */}
        {(ds?.lactation_advice || (delivery && delivery[0]?.lactation_advice)) && (
          <SectionBox title="Lactation / Breastfeeding Advice" accent="border-pink-300 bg-pink-50/30">
            <div className="whitespace-pre-line">{ds?.lactation_advice || delivery[0]?.lactation_advice}</div>
          </SectionBox>
        )}

        {/* ── FOLLOW-UP ────────────────────────────────────────── */}
        {(ds?.follow_up_date || ds?.follow_up_note) && (
          <SectionBox title="Follow-up" accent="border-green-300 bg-green-50/30">
            <div>
              {ds.follow_up_date && <><strong>Date: </strong>{formatDate(ds.follow_up_date)}</>}
              {ds.follow_up_note && <span className="ml-3">{ds.follow_up_note}</span>}
            </div>
          </SectionBox>
        )}

        {/* ── COMPLICATIONS ────────────────────────────────────── */}
        {ds?.complications && (
          <SectionBox title="Complications">
            <div className="whitespace-pre-line">{ds.complications}</div>
          </SectionBox>
        )}

        {/* ── BILLING SUMMARY (brief) ──────────────────────────── */}
        {totalBilled > 0 && (
          <div className="mt-4 text-[10px] text-gray-500 border-t border-gray-300 pt-2">
            <strong>Billing: </strong> Total Charges ₹{totalBilled.toLocaleString('en-IN')} · {charges.length} items
          </div>
        )}

        {/* ── FOOTER NOTE ──────────────────────────────────────── */}
        {hs.footerNote && (
          <div className="mt-4 text-[10px] text-gray-500 italic border-t border-gray-200 pt-2">
            {hs.footerNote}
          </div>
        )}

        {/* ── SIGNATURE BLOCK ──────────────────────────────────── */}
        <div className="flex justify-between items-end mt-12 pt-4 border-t-2 border-gray-800">
          {/* Left — meta info */}
          <div className="text-[9px] text-gray-400">
            <div>Printed: {new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</div>
            {ds?.version && <div>Version: {ds.version}</div>}
            {ds?.is_final && <div className="font-semibold text-green-700">✓ Finalised</div>}
          </div>

          {/* Center — Patient/Attendant signature */}
          <div className="text-center">
            <div className="border-t-2 border-gray-600 pt-1 mt-14 w-44">
              <div className="text-[10px] text-gray-600">Patient / Attendant Signature</div>
            </div>
          </div>

          {/* Right — Doctor signature */}
          <div className="text-right">
            {hs.doctorSignatureUrl && (
              <img src={hs.doctorSignatureUrl} alt="Signature" className="h-10 ml-auto mb-1" />
            )}
            <div className="border-t-2 border-gray-800 pt-1 mt-14 w-52">
              <div className="font-bold text-[12px]">{ds?.signed_by || hs.doctorName}</div>
              <div className="text-[10px] text-gray-500">{hs.doctorQual}</div>
              <div className="text-[10px] text-gray-500">Reg. No: {hs.doctorReg}</div>
              <div className="text-[10px] text-gray-500">{hs.hospitalName}</div>
            </div>
          </div>
        </div>

      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════
// HELPER COMPONENTS
// ═══════════════════════════════════════════════════════════════════

function SectionBox({ title, children, accent }: {
  title: string; children: React.ReactNode; accent?: string
}) {
  return (
    <div className={`mb-3 border rounded p-3 ${accent || 'border-gray-300'}`}>
      <div className="font-bold text-[11px] uppercase tracking-wide text-gray-700 mb-1.5 border-b border-gray-200 pb-1">
        {title}
      </div>
      {children}
    </div>
  )
}

function TD({ label, value, bold, full }: {
  label: string; value: string; bold?: boolean; full?: boolean
}) {
  return (
    <td
      colSpan={full ? 2 : 1}
      className="px-2 py-1.5 border border-gray-300 align-top"
      style={{ width: full ? '100%' : '50%' }}
    >
      <span className="text-gray-500">{label}: </span>
      <span className={bold ? 'font-bold' : 'font-medium'}>{value}</span>
    </td>
  )
}