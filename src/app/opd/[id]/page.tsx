'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import ConsultationAttachments from '@/components/shared/ConsultationAttachments'
import { supabase } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'
import type { Encounter } from '@/types'
import { ArrowLeft, Pill, Printer, Edit } from 'lucide-react'

export default function EncounterDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [encounter, setEncounter] = useState<Encounter | null>(null)
  const [prescription, setPrescription] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    Promise.all([
      supabase.from('encounters').select('*, patients(*)').eq('id', id).single(),
      supabase.from('prescriptions').select('*').eq('encounter_id', id).single(),
    ]).then(([{ data: enc }, { data: rx }]) => {
      setEncounter(enc)
      setPrescription(rx)
      setLoading(false)
    })
  }, [id])

  if (loading) return (
    <AppShell><div className="p-6 flex justify-center h-64 items-center">
      <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div></AppShell>
  )
  if (!encounter) return (
    <AppShell><div className="p-6 text-center py-20 text-gray-400">Encounter not found.</div></AppShell>
  )

  const ob = encounter.ob_data || {}
  const p = encounter.patients as any

  return (
    <AppShell>
      <div className="p-6 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-700"><ArrowLeft className="w-5 h-5" /></button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-gray-900">Consultation — {formatDate(encounter.encounter_date)}</h1>
            {p && <p className="text-sm text-gray-500">{p.full_name} · {p.mrn} · {p.age}y</p>}
          </div>
          <div className="flex gap-2">
            <Link href={`/opd/${id}/edit`} className="btn-secondary flex items-center gap-2 text-xs">
              <Edit className="w-3.5 h-3.5" /> Edit
            </Link>
            {prescription && (
              <Link href={`/opd/${id}/prescription`} className="btn-secondary flex items-center gap-2 text-xs">
                <Printer className="w-3.5 h-3.5" /> View/Print Rx
              </Link>
            )}
            {!prescription && (
              <Link href={`/opd/${id}/prescription`} className="btn-primary flex items-center gap-2 text-xs">
                <Pill className="w-3.5 h-3.5" /> Add Prescription
              </Link>
            )}
          </div>
        </div>

        {/* Vitals */}
        <div className="card p-5 mb-4">
          <h2 className="section-title">Vital Signs</h2>
          <div className="flex gap-3 flex-wrap">
            {encounter.pulse       && <Vital label="Pulse"       value={`${encounter.pulse} bpm`} />}
            {encounter.bp_systolic && <Vital label="BP"          value={`${encounter.bp_systolic}/${encounter.bp_diastolic} mmHg`} />}
            {encounter.temperature && <Vital label="Temp"        value={`${encounter.temperature}°C`} />}
            {encounter.spo2        && <Vital label="SpO₂"        value={`${encounter.spo2}%`} />}
            {encounter.weight      && <Vital label="Weight"      value={`${encounter.weight} kg`} />}
            {encounter.height      && <Vital label="Height"      value={`${encounter.height} cm`} />}
          </div>
          {!encounter.pulse && !encounter.bp_systolic && <p className="text-sm text-gray-400">No vitals recorded.</p>}
        </div>

        {/* Consultation */}
        <div className="card p-5 mb-4">
          <h2 className="section-title">Consultation</h2>
          {encounter.chief_complaint && <InfoRow label="Chief Complaint" value={encounter.chief_complaint} />}
          {encounter.diagnosis       && <InfoRow label="Diagnosis"       value={encounter.diagnosis} highlight />}
          {encounter.notes           && <InfoRow label="Clinical Notes"   value={encounter.notes} />}
        </div>

        {/* OB/GYN */}
        {ob && Object.keys(ob).some(k => (ob as any)[k]) && (
          <div className="card p-5 mb-4">
            <h2 className="section-title">Gynecology / OB Examination</h2>
            <div className="grid grid-cols-2 gap-x-8 gap-y-2">
              {ob.lmp         && <InfoRow label="LMP"          value={formatDate(ob.lmp)} />}
              {ob.edd         && <InfoRow label="EDD"          value={formatDate(ob.edd)} />}
              {ob.gestational_age && <InfoRow label="Gestational Age" value={ob.gestational_age} />}
              {(ob.gravida !== undefined) && <InfoRow label="Gravida/Para" value={`G${ob.gravida} P${ob.para} A${ob.abortion} L${ob.living}`} />}
              {ob.fhs         && <InfoRow label="FHS"          value={`${ob.fhs} bpm`} />}
              {ob.liquor      && <InfoRow label="Liquor"       value={ob.liquor} />}
              {ob.fundal_height && <InfoRow label="Fundal Height" value={`${ob.fundal_height} cm`} />}
              {ob.presentation && <InfoRow label="Presentation" value={ob.presentation} />}
              {ob.engagement  && <InfoRow label="Engagement"   value={ob.engagement} />}
              {ob.uterus_size && <InfoRow label="Uterus Size"  value={ob.uterus_size} />}
              {ob.scar_tenderness && <InfoRow label="Scar Tenderness" value={ob.scar_tenderness} />}
              {ob.fetal_movement  && <InfoRow label="Fetal Movement"  value={ob.fetal_movement} />}
              {ob.previous_cs     && <InfoRow label="Previous CS"     value={`${ob.previous_cs} CS`} />}
              {ob.multiple_pregnancy && <InfoRow label="Multiple Pregnancy" value="Twins / Multiple" />}
              {ob.gestational_diabetes && <InfoRow label="GDM" value="Yes" />}
              {ob.haemoglobin     && <InfoRow label="Haemoglobin"     value={`${ob.haemoglobin} g/dL`} />}
              {ob.blood_sugar_fasting && <InfoRow label="Fasting Sugar" value={`${ob.blood_sugar_fasting} mg/dL`} />}
              {ob.blood_sugar_pp  && <InfoRow label="PP Sugar"        value={`${ob.blood_sugar_pp} mg/dL`} />}
              {ob.cervix_speculum && <InfoRow label="Cervix (Speculum)" value={ob.cervix_speculum} />}
              {ob.cervix_pv  && <InfoRow label="Cervix (PV)"  value={ob.cervix_pv} />}
              {ob.os_pv      && <InfoRow label="Os"            value={ob.os_pv} />}
              {ob.uterus_position && <InfoRow label="Uterus Position" value={ob.uterus_position} />}
            </div>
            {ob.per_abdomen  && <InfoRow label="Per Abdomen"  value={ob.per_abdomen} />}
            {ob.per_speculum && <InfoRow label="Per Speculum" value={ob.per_speculum} />}
            {ob.per_vaginum  && <InfoRow label="Per Vaginum"  value={ob.per_vaginum} />}
            {(ob.right_ovary || ob.left_ovary) && (
              <div className="mt-2 grid grid-cols-2 gap-4">
                {ob.right_ovary && <InfoRow label="Right Ovary" value={ob.right_ovary} />}
                {ob.left_ovary  && <InfoRow label="Left Ovary"  value={ob.left_ovary} />}
              </div>
            )}

            {/* USG / Ultrasound Report */}
            {(ob.bpd || ob.hc || ob.ac || ob.fl || ob.afi || ob.efw || ob.placenta || ob.usg_remarks) && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">📊 USG Report {ob.usg_date ? `(${new Date(ob.usg_date).toLocaleDateString('en-IN', {day:'2-digit',month:'short',year:'numeric'})})` : ''}</h3>
                <div className="grid grid-cols-2 gap-x-8 gap-y-2">
                  {ob.usg_ga   && <InfoRow label="GA at USG"  value={ob.usg_ga} />}
                  {ob.efw      && <InfoRow label="EFW"        value={`${ob.efw} g (${(ob.efw/1000).toFixed(2)} kg)`} />}
                  {ob.bpd      && <InfoRow label="BPD"        value={`${ob.bpd} mm`} />}
                  {ob.hc       && <InfoRow label="HC"         value={`${ob.hc} mm`} />}
                  {ob.ac       && <InfoRow label="AC"         value={`${ob.ac} mm`} />}
                  {ob.fl       && <InfoRow label="FL"         value={`${ob.fl} mm`} />}
                  {ob.afi      && <InfoRow label="AFI"        value={`${ob.afi} cm${ob.afi < 5 ? ' ⚠️ LOW' : ob.afi > 25 ? ' ⚠️ HIGH' : ''}`} highlight={ob.afi < 5 || ob.afi > 25} />}
                  {ob.placenta && <InfoRow label="Placenta"   value={`${ob.placenta}${ob.placenta_grade ? ` · ${ob.placenta_grade}` : ''}`} highlight={ob.placenta === 'Previa' || ob.placenta === 'Low-lying'} />}
                  {ob.cord_loops && <InfoRow label="Cord"     value={ob.cord_loops} />}
                </div>
                {ob.usg_remarks && <InfoRow label="USG Remarks" value={ob.usg_remarks} />}
              </div>
            )}
          </div>
        )}

        {/* Procedures */}
        {encounter.procedures && (encounter.procedures as any[]).length > 0 && (
          <div className="card p-5 mb-4">
            <h2 className="section-title">🔪 Procedures Performed</h2>
            <div className="space-y-3">
              {(encounter.procedures as any[]).map((proc: any, i: number) => (
                <div key={i} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-bold text-gray-900 text-sm">{proc.name}</span>
                    {proc.anaesthesia && <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">{proc.anaesthesia}</span>}
                    {proc.surgeon && <span className="text-xs text-gray-500">by {proc.surgeon}</span>}
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                    {proc.indication && <InfoRow label="Indication" value={proc.indication} />}
                    {proc.findings && <InfoRow label="Findings" value={proc.findings} />}
                    {proc.complications && <InfoRow label="Complications" value={proc.complications} />}
                    {proc.notes && <InfoRow label="Notes" value={proc.notes} />}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Files & Attachments */}
        {encounter.patient_id && (
          <ConsultationAttachments
            patientId={encounter.patient_id}
            encounterId={id as string}
          />
        )}

        {/* Prescription preview */}
        {prescription && (
          <div className="card p-5">
            <div className="flex justify-between items-center mb-3">
              <h2 className="section-title mb-0">Prescription</h2>
              <Link href={`/opd/${id}/prescription`} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                <Printer className="w-3 h-3" /> Print
              </Link>
            </div>
            <div className="space-y-1">
              {Array.isArray(prescription.medications) && prescription.medications.map((m: any, i: number) => (
                <div key={i} className="flex gap-3 text-sm py-1 border-b border-gray-50">
                  <span className="text-gray-400 w-5 font-mono">{i+1}.</span>
                  <div>
                    <span className="font-semibold text-gray-900">{m.drug}</span>
                    <span className="text-gray-500"> — {m.dose} · {m.route} · {m.frequency} · {m.duration}</span>
                    {m.instructions && <span className="text-xs text-blue-600 ml-1">({m.instructions})</span>}
                  </div>
                </div>
              ))}
            </div>
            {prescription.follow_up_date && (
              <div className="mt-3 text-sm text-green-700 font-medium">
                ✅ Follow-up: {formatDate(prescription.follow_up_date)}
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  )
}

function Vital({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2 text-center min-w-[80px]">
      <div className="text-xs text-gray-400 mb-0.5">{label}</div>
      <div className="text-sm font-bold text-gray-800">{value}</div>
    </div>
  )
}

function InfoRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="py-1.5 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-400 font-semibold uppercase tracking-wide mr-2">{label}:</span>
      <span className={`text-sm ${highlight ? 'font-semibold text-blue-800' : 'text-gray-700'}`}>{value}</span>
    </div>
  )
}
