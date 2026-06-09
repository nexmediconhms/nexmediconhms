'use client'
/**
 * src/components/ipd/DeliveryRecord.tsx
 *
 * Comprehensive Delivery Record for Indian Gynaecologist clinics.
 *
 * Covers: delivery type, baby details (APGAR, cry, weight, length),
 * episiotomy, perineal tear, blood loss, placenta, cord, anesthesia,
 * personnel, breastfeeding, and newborn vaccinations.
 *
 * Auto-syncs obstetric fields to the discharge_summaries table so
 * the Discharge Workflow Page shows them pre-filled.
 *
 * USAGE: <DeliveryRecord admissionId="..." patientId="..." bedId="..." />
 *        Render as a tab inside /ipd/[bedId]/page.tsx
 */

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { runPostDeliverySync, getUpcomingVaccinations, type SyncResult } from '@/lib/post-delivery-sync'
import { getIndiaToday } from '@/lib/utils'
import {
  Baby, Save, Loader2, CheckCircle, AlertCircle,
  Heart, Stethoscope, Scissors, User, Clock,
  Plus, Trash2, ChevronDown, ChevronUp,
  Syringe, ShieldCheck, Users,
} from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────
interface DeliveryRecordData {
  id?: string
  ipd_admission_id: string
  patient_id: string
  baby_number: number
  // Delivery
  delivery_date: string
  delivery_time: string
  delivery_type: string
  delivery_outcome: string
  indication: string
  labour_duration_hours: string
  labour_type: string
  induction_method: string
  // Baby
  baby_sex: string
  baby_weight_kg: string
  baby_length_cm: string
  head_circumference_cm: string
  chest_circumference_cm: string
  apgar_1min: string
  apgar_5min: string
  apgar_10min: string
  cry_at_birth: string
  resuscitation_needed: boolean
  resuscitation_details: string
  baby_condition: string
  nicu_admission: boolean
  nicu_reason: string
  congenital_anomaly: string
  vitamin_k_given: boolean
  bcg_given: boolean
  opv_zero_given: boolean
  hep_b_given: boolean
  // Mother
  episiotomy: string
  perineal_tear: string
  tear_repaired: boolean
  blood_loss_ml: string
  pph: boolean
  pph_management: string
  placenta_delivery: string
  placenta_delivery_time: string
  placenta_weight_gm: string
  placenta_complete: boolean
  cord_vessels: string
  cord_around_neck: string
  cord_length_cm: string
  uterus_well_contracted: boolean
  oxytocin_after_delivery: boolean
  catheterised: boolean
  mother_condition: string
  // Anesthesia
  anesthesia_type: string
  anesthesiologist: string
  // Personnel
  delivering_doctor: string
  assistant: string
  pediatrician: string
  nurse_on_duty: string
  // Breastfeeding
  breastfeeding_initiated: boolean
  breastfeeding_time: string
  lactation_advice: string
  // Notes
  delivery_notes: string
  complications: string
  postpartum_notes: string
}

const EMPTY_RECORD: Omit<DeliveryRecordData, 'ipd_admission_id' | 'patient_id'> = {
  baby_number: 1,
  delivery_date: getIndiaToday(),
  delivery_time: '',
  delivery_type: '',
  delivery_outcome: 'Live Birth',
  indication: '',
  labour_duration_hours: '',
  labour_type: 'Spontaneous',
  induction_method: '',
  baby_sex: '',
  baby_weight_kg: '',
  baby_length_cm: '',
  head_circumference_cm: '',
  chest_circumference_cm: '',
  apgar_1min: '',
  apgar_5min: '',
  apgar_10min: '',
  cry_at_birth: 'Immediate',
  resuscitation_needed: false,
  resuscitation_details: '',
  baby_condition: 'Healthy',
  nicu_admission: false,
  nicu_reason: '',
  congenital_anomaly: '',
  vitamin_k_given: true,
  bcg_given: false,
  opv_zero_given: false,
  hep_b_given: false,
  episiotomy: 'None',
  perineal_tear: 'None',
  tear_repaired: false,
  blood_loss_ml: '',
  pph: false,
  pph_management: '',
  placenta_delivery: 'Spontaneous',
  placenta_delivery_time: '',
  placenta_weight_gm: '',
  placenta_complete: true,
  cord_vessels: '3 (2A+1V)',
  cord_around_neck: 'None',
  cord_length_cm: '',
  uterus_well_contracted: true,
  oxytocin_after_delivery: true,
  catheterised: false,
  mother_condition: 'Stable',
  anesthesia_type: 'None',
  anesthesiologist: '',
  delivering_doctor: '',
  assistant: '',
  pediatrician: '',
  nurse_on_duty: '',
  breastfeeding_initiated: false,
  breastfeeding_time: '',
  lactation_advice: '',
  delivery_notes: '',
  complications: '',
  postpartum_notes: '',
}

interface Props {
  admissionId: string
  patientId: string
  bedId: string
  currentUser?: string
}

// ── Section collapse helper ──────────────────────────────────────
function Section({ title, icon: Icon, color, children, defaultOpen = true }: {
  title: string; icon: any; color: string; children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button onClick={() => setOpen(!open)}
        className={`w-full flex items-center justify-between px-4 py-3 ${color} text-left`}>
        <span className="flex items-center gap-2 font-medium text-sm">
          <Icon className="w-4 h-4" /> {title}
        </span>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {open && <div className="p-4 space-y-3">{children}</div>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════
export default function DeliveryRecord({ admissionId, patientId, bedId, currentUser }: Props) {
  const [records, setRecords] = useState<DeliveryRecordData[]>([])
  const [activeIdx, setActiveIdx] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [tableExists, setTableExists] = useState(true)
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [patientData, setPatientData] = useState<any>(null)
  const [showVaxSchedule, setShowVaxSchedule] = useState(false)

  // Current record being edited
  const form = records[activeIdx] || null

  // ── Load existing records ─────────────────────────────────────
  const loadRecords = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error: err } = await supabase
        .from('delivery_records')
        .select('*')
        .eq('ipd_admission_id', admissionId)
        .order('baby_number', { ascending: true })

      if (err) {
        if (err.message?.includes('relation') && err.message?.includes('does not exist')) {
          setTableExists(false)
          setError('The delivery_records table does not exist yet. Please run the SQL migration first.')
        } else {
          throw err
        }
        setLoading(false)
        return
      }

      // Load patient data for sync
      const { data: patData } = await supabase
        .from('patients').select('full_name, mobile, mrn, ob_data').eq('id', patientId).single()
      if (patData) setPatientData(patData)

      if (data && data.length > 0) {
        const mapped = data.map((d: any) => ({
          ...EMPTY_RECORD,
          ...d,
          delivery_date: d.delivery_date || '',
          baby_weight_kg: d.baby_weight_kg?.toString() || '',
          baby_length_cm: d.baby_length_cm?.toString() || '',
          head_circumference_cm: d.head_circumference_cm?.toString() || '',
          chest_circumference_cm: d.chest_circumference_cm?.toString() || '',
          apgar_1min: d.apgar_1min?.toString() || '',
          apgar_5min: d.apgar_5min?.toString() || '',
          apgar_10min: d.apgar_10min?.toString() || '',
          blood_loss_ml: d.blood_loss_ml?.toString() || '',
          placenta_weight_gm: d.placenta_weight_gm?.toString() || '',
          cord_length_cm: d.cord_length_cm?.toString() || '',
          labour_duration_hours: d.labour_duration_hours?.toString() || '',
          ipd_admission_id: admissionId,
          patient_id: patientId,
        }))
        setRecords(mapped)
      } else {
        // Create a default empty record
        setRecords([{ ...EMPTY_RECORD, ipd_admission_id: admissionId, patient_id: patientId }])
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load delivery records')
    } finally {
      setLoading(false)
    }
  }, [admissionId, patientId])

  useEffect(() => { loadRecords() }, [loadRecords])

  // ── Update form field ─────────────────────────────────────────
  function setField(field: keyof DeliveryRecordData, value: any) {
    setRecords(prev => {
      const updated = [...prev]
      updated[activeIdx] = { ...updated[activeIdx], [field]: value }
      return updated
    })
    setSaved(false)
  }

  // ── Add baby (for twins/multiples) ────────────────────────────
  function addBaby() {
    const newBabyNumber = records.length + 1
    setRecords(prev => [...prev, {
      ...EMPTY_RECORD,
      ipd_admission_id: admissionId,
      patient_id: patientId,
      baby_number: newBabyNumber,
      delivery_date: prev[0]?.delivery_date || getIndiaToday(),
      delivery_type: prev[0]?.delivery_type || '',
      delivering_doctor: prev[0]?.delivering_doctor || '',
      anesthesia_type: prev[0]?.anesthesia_type || '',
    }])
    setActiveIdx(records.length)
  }

  // ── Remove baby record ────────────────────────────────────────
  async function removeBaby(idx: number) {
    if (records.length <= 1) return
    const rec = records[idx]
    if (rec.id) {
      await supabase.from('delivery_records').delete().eq('id', rec.id)
    }
    setRecords(prev => prev.filter((_, i) => i !== idx))
    setActiveIdx(Math.max(0, activeIdx - 1))
  }

  // ── Save ──────────────────────────────────────────────────────
  async function saveRecord() {
    if (!form) return
    setSaving(true)
    setError('')

    const payload: any = {
      ipd_admission_id: admissionId,
      patient_id: patientId,
      baby_number: form.baby_number,
      delivery_date: form.delivery_date || null,
      delivery_time: form.delivery_time || null,
      delivery_type: form.delivery_type || null,
      delivery_outcome: form.delivery_outcome || null,
      indication: form.indication || null,
      labour_duration_hours: form.labour_duration_hours ? Number(form.labour_duration_hours) : null,
      labour_type: form.labour_type || null,
      induction_method: form.induction_method || null,
      baby_sex: form.baby_sex || null,
      baby_weight_kg: form.baby_weight_kg ? Number(form.baby_weight_kg) : null,
      baby_length_cm: form.baby_length_cm ? Number(form.baby_length_cm) : null,
      head_circumference_cm: form.head_circumference_cm ? Number(form.head_circumference_cm) : null,
      chest_circumference_cm: form.chest_circumference_cm ? Number(form.chest_circumference_cm) : null,
      apgar_1min: form.apgar_1min ? Number(form.apgar_1min) : null,
      apgar_5min: form.apgar_5min ? Number(form.apgar_5min) : null,
      apgar_10min: form.apgar_10min ? Number(form.apgar_10min) : null,
      cry_at_birth: form.cry_at_birth || null,
      resuscitation_needed: form.resuscitation_needed,
      resuscitation_details: form.resuscitation_details || null,
      baby_condition: form.baby_condition || null,
      nicu_admission: form.nicu_admission,
      nicu_reason: form.nicu_reason || null,
      congenital_anomaly: form.congenital_anomaly || null,
      vitamin_k_given: form.vitamin_k_given,
      bcg_given: form.bcg_given,
      opv_zero_given: form.opv_zero_given,
      hep_b_given: form.hep_b_given,
      episiotomy: form.episiotomy || null,
      perineal_tear: form.perineal_tear || null,
      tear_repaired: form.tear_repaired,
      blood_loss_ml: form.blood_loss_ml ? Number(form.blood_loss_ml) : null,
      pph: form.pph,
      pph_management: form.pph_management || null,
      placenta_delivery: form.placenta_delivery || null,
      placenta_delivery_time: form.placenta_delivery_time || null,
      placenta_weight_gm: form.placenta_weight_gm ? Number(form.placenta_weight_gm) : null,
      placenta_complete: form.placenta_complete,
      cord_vessels: form.cord_vessels || null,
      cord_around_neck: form.cord_around_neck || null,
      cord_length_cm: form.cord_length_cm ? Number(form.cord_length_cm) : null,
      uterus_well_contracted: form.uterus_well_contracted,
      oxytocin_after_delivery: form.oxytocin_after_delivery,
      catheterised: form.catheterised,
      mother_condition: form.mother_condition || null,
      anesthesia_type: form.anesthesia_type || null,
      anesthesiologist: form.anesthesiologist || null,
      delivering_doctor: form.delivering_doctor || null,
      assistant: form.assistant || null,
      pediatrician: form.pediatrician || null,
      nurse_on_duty: form.nurse_on_duty || null,
      breastfeeding_initiated: form.breastfeeding_initiated,
      breastfeeding_time: form.breastfeeding_time || null,
      lactation_advice: form.lactation_advice || null,
      delivery_notes: form.delivery_notes || null,
      complications: form.complications || null,
      postpartum_notes: form.postpartum_notes || null,
      updated_at: new Date().toISOString(),
      updated_by: currentUser || null,
    }

    try {
      if (form.id) {
        const { error: upErr } = await supabase
          .from('delivery_records')
          .update(payload)
          .eq('id', form.id)
        if (upErr) throw upErr
      } else {
        payload.created_by = currentUser || null
        const { data: newRec, error: insErr } = await supabase
          .from('delivery_records')
          .insert(payload)
          .select()
          .single()
        if (insErr) throw insErr
        if (newRec) {
          setRecords(prev => {
            const updated = [...prev]
            updated[activeIdx] = { ...updated[activeIdx], id: newRec.id }
            return updated
          })
        }
      }

      // Auto-sync to discharge_summaries (first baby only)
      if (activeIdx === 0) {
        await syncToDischarge()
      }

      // Run full post-delivery sync (follow-ups, vaccinations, patient profile)
      if (form.delivery_date && form.delivery_type && activeIdx === 0) {
        setSyncing(true)
        try {
          const syncRes = await runPostDeliverySync({
            patientId,
            admissionId,
            deliveryDate: form.delivery_date,
            deliveryTime: form.delivery_time,
            deliveryType: form.delivery_type,
            babySex: form.baby_sex,
            babyWeightKg: form.baby_weight_kg,
            apgar1: form.apgar_1min,
            apgar5: form.apgar_5min,
            motherName: patientData?.full_name || '',
            motherMobile: patientData?.mobile || '',
            motherMrn: patientData?.mrn || '',
            doctorName: form.delivering_doctor,
            complications: form.complications,
            lactationAdvice: form.lactation_advice,
          })
          setSyncResult(syncRes)
        } catch (syncErr: any) {
          console.error('Post-delivery sync error:', syncErr)
        } finally {
          setSyncing(false)
        }
      }

      setSaved(true)
      setTimeout(() => setSaved(false), 5000)
    } catch (err: any) {
      setError(`Save failed: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  // ── Sync delivery fields to discharge_summaries ───────────────
  async function syncToDischarge() {
    if (!form) return
    try {
      const { data: ds } = await supabase
        .from('discharge_summaries')
        .select('id')
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      const dsPayload: any = {
        delivery_type: form.delivery_type || null,
        baby_sex: form.baby_sex || null,
        baby_weight: form.baby_weight_kg ? `${form.baby_weight_kg} kg` : null,
        apgar_score: [form.apgar_1min, form.apgar_5min].filter(Boolean).join('/') || null,
        baby_birth_time: form.delivery_time || null,
        delivery_date: form.delivery_date || null,
        complications: form.complications || null,
        lactation_advice: form.lactation_advice || null,
        updated_at: new Date().toISOString(),
      }

      if (ds?.id) {
        await supabase.from('discharge_summaries').update(dsPayload).eq('id', ds.id)
      }
    } catch {
      // Non-critical — silently fail
    }
  }

  // ── Loading state ─────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-pink-500" />
        <span className="ml-2 text-gray-500 text-sm">Loading delivery records...</span>
      </div>
    )
  }

  if (!tableExists) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
        <AlertCircle className="w-8 h-8 text-yellow-500 mx-auto mb-3" />
        <h3 className="font-semibold text-gray-800 mb-2">Database Setup Required</h3>
        <p className="text-sm text-gray-600 mb-4">
          The <code className="bg-gray-100 px-1 rounded">delivery_records</code> table doesn't exist yet.
          Please run the SQL migration file in your Supabase SQL Editor.
        </p>
        <p className="text-xs text-gray-500">
          Go to Supabase Dashboard → SQL Editor → paste the contents of
          <code className="bg-gray-100 px-1 rounded ml-1">delivery_records_migration.sql</code> → Run
        </p>
      </div>
    )
  }

  if (!form) return null

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
          <Baby className="w-5 h-5 text-pink-500" /> Delivery Record
        </h3>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="text-xs text-green-600 flex items-center gap-1">
              <CheckCircle className="w-3 h-3" /> Saved
            </span>
          )}
          <button onClick={saveRecord} disabled={saving}
            className="bg-pink-600 hover:bg-pink-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Record
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
          <button onClick={() => setError('')} className="ml-auto text-red-400 hover:text-red-600">×</button>
        </div>
      )}

      {syncing && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-700 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Syncing follow-ups, vaccination schedule, and patient profile...
        </div>
      )}

      {syncResult && !syncing && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm">
          <p className="font-medium text-green-800 mb-2 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4" /> Post-Delivery Auto-Sync Complete
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div className="bg-white rounded p-2 text-center border">
              <div className="font-bold text-green-700 text-lg">{syncResult.motherFollowupsCreated}</div>
              <div className="text-gray-500">Mother Follow-ups</div>
            </div>
            <div className="bg-white rounded p-2 text-center border">
              <div className="font-bold text-blue-700 text-lg">{syncResult.vaccinationApptsCreated}</div>
              <div className="text-gray-500">Vaccination Appts</div>
            </div>
            <div className="bg-white rounded p-2 text-center border">
              <div className={`font-bold text-lg ${syncResult.dischargeSynced ? 'text-green-700' : 'text-gray-400'}`}>
                {syncResult.dischargeSynced ? '✓' : '—'}
              </div>
              <div className="text-gray-500">Discharge Synced</div>
            </div>
            <div className="bg-white rounded p-2 text-center border">
              <div className={`font-bold text-lg ${syncResult.patientSynced ? 'text-green-700' : 'text-gray-400'}`}>
                {syncResult.patientSynced ? '✓' : '—'}
              </div>
              <div className="text-gray-500">Patient Updated</div>
            </div>
          </div>
          {syncResult.errors.length > 0 && (
            <div className="mt-2 text-xs text-red-600">
              {syncResult.errors.map((e, i) => <p key={i}>⚠ {e}</p>)}
            </div>
          )}
          <p className="text-xs text-gray-500 mt-2">
            WhatsApp reminders will be sent automatically before each follow-up and vaccination date.
          </p>
        </div>
      )}

      {/* Baby tabs (for twins/multiples) */}
      {records.length > 1 && (
        <div className="flex gap-2 items-center">
          {records.map((r, i) => (
            <button key={i} onClick={() => setActiveIdx(i)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium flex items-center gap-1 ${
                activeIdx === i ? 'bg-pink-100 text-pink-700 border border-pink-300' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>
              <Baby className="w-3 h-3" /> Baby {r.baby_number} {r.baby_sex ? `(${r.baby_sex})` : ''}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={addBaby}
          className="text-xs text-pink-600 hover:text-pink-800 flex items-center gap-1 border border-pink-200 rounded px-2 py-1 hover:bg-pink-50">
          <Plus className="w-3 h-3" /> Add Baby (Twins/Multiple)
        </button>
        {records.length > 1 && (
          <button onClick={() => removeBaby(activeIdx)}
            className="text-xs text-red-400 hover:text-red-600 flex items-center gap-1 border border-red-200 rounded px-2 py-1 hover:bg-red-50">
            <Trash2 className="w-3 h-3" /> Remove Baby {form.baby_number}
          </button>
        )}
      </div>

      {/* ═══════ DELIVERY DETAILS ═══════ */}
      <Section title="Delivery Details" icon={Clock} color="bg-blue-50 text-blue-800">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Field label="Delivery Date" value={form.delivery_date} onChange={v => setField('delivery_date', v)} type="date" />
          <Field label="Delivery Time" value={form.delivery_time} onChange={v => setField('delivery_time', v)} placeholder="HH:MM" />
          <Select label="Delivery Type *" value={form.delivery_type} onChange={v => setField('delivery_type', v)}
            options={['', 'Normal (Vaginal)', 'LSCS (Caesarean)', 'Vacuum Assisted', 'Forceps Delivery', 'Breech', 'Water Birth']} />
          <Select label="Outcome" value={form.delivery_outcome} onChange={v => setField('delivery_outcome', v)}
            options={['Live Birth', 'Stillbirth', 'IUD (Intrauterine Death)']} />
          <Select label="Labour Type" value={form.labour_type} onChange={v => setField('labour_type', v)}
            options={['Spontaneous', 'Induced', 'Augmented']} />
          {(form.labour_type === 'Induced' || form.labour_type === 'Augmented') && (
            <Select label="Induction Method" value={form.induction_method} onChange={v => setField('induction_method', v)}
              options={['', 'Oxytocin', 'Misoprostol', 'Dinoprostone (PGE2)', 'Foley Catheter', 'ARM (Amniotomy)', 'Combination']} />
          )}
          <Field label="Labour Duration (hrs)" value={form.labour_duration_hours} onChange={v => setField('labour_duration_hours', v)} placeholder="e.g., 8" />
          {(form.delivery_type?.includes('LSCS') || form.delivery_type?.includes('Vacuum') || form.delivery_type?.includes('Forceps')) && (
            <div className="md:col-span-2">
              <Field label="Indication" value={form.indication} onChange={v => setField('indication', v)}
                placeholder="e.g., Fetal distress, CPD, Failed induction, Prolonged labour" />
            </div>
          )}
        </div>
      </Section>

      {/* ═══════ BABY DETAILS ═══════ */}
      <Section title={`Baby ${form.baby_number} Details`} icon={Baby} color="bg-pink-50 text-pink-800">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Select label="Sex *" value={form.baby_sex} onChange={v => setField('baby_sex', v)}
            options={['', 'Male', 'Female', 'Ambiguous']} />
          <Field label="Weight (kg) *" value={form.baby_weight_kg} onChange={v => setField('baby_weight_kg', v)} placeholder="e.g., 2.8" />
          <Field label="Length (cm)" value={form.baby_length_cm} onChange={v => setField('baby_length_cm', v)} placeholder="e.g., 48" />
          <Field label="Head Circ. (cm)" value={form.head_circumference_cm} onChange={v => setField('head_circumference_cm', v)} placeholder="e.g., 34" />
          <Field label="Chest Circ. (cm)" value={form.chest_circumference_cm} onChange={v => setField('chest_circumference_cm', v)} placeholder="e.g., 32" />
        </div>

        <div className="border-t pt-3 mt-2">
          <p className="text-xs text-gray-500 font-medium mb-2">APGAR Score</p>
          <div className="grid grid-cols-3 gap-3">
            <Field label="At 1 min" value={form.apgar_1min} onChange={v => setField('apgar_1min', v)} placeholder="0-10" />
            <Field label="At 5 min" value={form.apgar_5min} onChange={v => setField('apgar_5min', v)} placeholder="0-10" />
            <Field label="At 10 min" value={form.apgar_10min} onChange={v => setField('apgar_10min', v)} placeholder="0-10" />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 border-t pt-3 mt-2">
          <Select label="Cry at Birth" value={form.cry_at_birth} onChange={v => setField('cry_at_birth', v)}
            options={['Immediate', 'Delayed', 'Absent', 'Weak']} />
          <Toggle label="Resuscitation Needed" checked={form.resuscitation_needed} onChange={v => setField('resuscitation_needed', v)} />
          <Select label="Baby Condition" value={form.baby_condition} onChange={v => setField('baby_condition', v)}
            options={['Healthy', 'Observation', 'NICU', 'Critical']} />
        </div>
        {form.resuscitation_needed && (
          <Field label="Resuscitation Details" value={form.resuscitation_details} onChange={v => setField('resuscitation_details', v)}
            placeholder="Steps taken, duration, medications used..." />
        )}
        <div className="grid grid-cols-2 gap-3">
          <Toggle label="NICU Admission" checked={form.nicu_admission} onChange={v => setField('nicu_admission', v)} />
          {form.nicu_admission && (
            <Field label="NICU Reason" value={form.nicu_reason} onChange={v => setField('nicu_reason', v)}
              placeholder="e.g., Low birth weight, RDS, MAS" />
          )}
        </div>
        <Field label="Congenital Anomaly (if any)" value={form.congenital_anomaly} onChange={v => setField('congenital_anomaly', v)} placeholder="None / Describe" />
      </Section>

      {/* ═══════ NEWBORN VACCINATIONS ═══════ */}
      <Section title="Newborn Vaccinations" icon={Syringe} color="bg-green-50 text-green-800" defaultOpen={false}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Toggle label="Vitamin K (Inj.)" checked={form.vitamin_k_given} onChange={v => setField('vitamin_k_given', v)} />
          <Toggle label="BCG" checked={form.bcg_given} onChange={v => setField('bcg_given', v)} />
          <Toggle label="OPV-0 (Oral Polio)" checked={form.opv_zero_given} onChange={v => setField('opv_zero_given', v)} />
          <Toggle label="Hepatitis B" checked={form.hep_b_given} onChange={v => setField('hep_b_given', v)} />
        </div>
      </Section>

      {/* ═══════ MOTHER — PERINEUM & BLOOD LOSS ═══════ */}
      <Section title="Mother — Perineum, Placenta & Blood Loss" icon={Heart} color="bg-red-50 text-red-800">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Select label="Episiotomy" value={form.episiotomy} onChange={v => setField('episiotomy', v)}
            options={['None', 'Medio-lateral (Right)', 'Medio-lateral (Left)', 'Midline', 'J-shaped']} />
          <Select label="Perineal Tear" value={form.perineal_tear} onChange={v => setField('perineal_tear', v)}
            options={['None', '1st Degree', '2nd Degree', '3rd Degree', '4th Degree']} />
          {(form.episiotomy !== 'None' || form.perineal_tear !== 'None') && (
            <Toggle label="Tear/Episiotomy Repaired" checked={form.tear_repaired} onChange={v => setField('tear_repaired', v)} />
          )}
          <Field label="Blood Loss (ml)" value={form.blood_loss_ml} onChange={v => setField('blood_loss_ml', v)} placeholder="e.g., 300" />
          <Toggle label="PPH (Postpartum Haemorrhage)" checked={form.pph} onChange={v => setField('pph', v)} />
          {form.pph && (
            <Field label="PPH Management" value={form.pph_management} onChange={v => setField('pph_management', v)}
              placeholder="Oxytocin, Misoprostol, Uterine massage, Balloon tamponade..." />
          )}
        </div>

        <div className="border-t pt-3 mt-2">
          <p className="text-xs text-gray-500 font-medium mb-2">Placenta & Cord</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Select label="Placenta Delivery" value={form.placenta_delivery} onChange={v => setField('placenta_delivery', v)}
              options={['Spontaneous', 'Manual Removal', 'Incomplete']} />
            <Field label="Placenta Time" value={form.placenta_delivery_time} onChange={v => setField('placenta_delivery_time', v)} placeholder="e.g., 5 min after delivery" />
            <Toggle label="Placenta Complete" checked={form.placenta_complete} onChange={v => setField('placenta_complete', v)} />
            <Select label="Cord Vessels" value={form.cord_vessels} onChange={v => setField('cord_vessels', v)}
              options={['3 (2A+1V)', '2 (Single Umbilical Artery)']} />
            <Select label="Cord Around Neck" value={form.cord_around_neck} onChange={v => setField('cord_around_neck', v)}
              options={['None', 'Loose - 1 loop', 'Loose - 2 loops', 'Tight - 1 loop', 'Tight - 2 loops', '3+ loops']} />
          </div>
        </div>

        <div className="border-t pt-3 mt-2">
          <p className="text-xs text-gray-500 font-medium mb-2">Postpartum Checks</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Toggle label="Uterus Well Contracted" checked={form.uterus_well_contracted} onChange={v => setField('uterus_well_contracted', v)} />
            <Toggle label="Oxytocin Given Post-Delivery" checked={form.oxytocin_after_delivery} onChange={v => setField('oxytocin_after_delivery', v)} />
            <Toggle label="Catheterised" checked={form.catheterised} onChange={v => setField('catheterised', v)} />
            <Select label="Mother Condition" value={form.mother_condition} onChange={v => setField('mother_condition', v)}
              options={['Stable', 'Under Observation', 'ICU', 'Critical']} />
          </div>
        </div>
      </Section>

      {/* ═══════ ANESTHESIA & PERSONNEL ═══════ */}
      <Section title="Anesthesia & Personnel" icon={Users} color="bg-purple-50 text-purple-800" defaultOpen={false}>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Select label="Anesthesia Type" value={form.anesthesia_type} onChange={v => setField('anesthesia_type', v)}
            options={['None', 'Epidural', 'Spinal', 'General (GA)', 'Local', 'Pudendal Block', 'Combined Spinal-Epidural']} />
          {form.anesthesia_type !== 'None' && (
            <Field label="Anesthesiologist" value={form.anesthesiologist} onChange={v => setField('anesthesiologist', v)} placeholder="Dr. name" />
          )}
          <Field label="Delivering Doctor *" value={form.delivering_doctor} onChange={v => setField('delivering_doctor', v)} placeholder="Dr. name" />
          <Field label="Assistant" value={form.assistant} onChange={v => setField('assistant', v)} placeholder="Dr./Nurse name" />
          <Field label="Pediatrician" value={form.pediatrician} onChange={v => setField('pediatrician', v)} placeholder="Dr. name" />
          <Field label="Nurse on Duty" value={form.nurse_on_duty} onChange={v => setField('nurse_on_duty', v)} placeholder="Nurse name" />
        </div>
      </Section>

      {/* ═══════ BREASTFEEDING ═══════ */}
      <Section title="Breastfeeding & Lactation" icon={Heart} color="bg-amber-50 text-amber-800" defaultOpen={false}>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Toggle label="Breastfeeding Initiated" checked={form.breastfeeding_initiated} onChange={v => setField('breastfeeding_initiated', v)} />
          <Select label="Initiation Time" value={form.breastfeeding_time} onChange={v => setField('breastfeeding_time', v)}
            options={['', 'Within 30 minutes', 'Within 1 hour', '1-2 hours', 'After 2 hours', 'Not initiated']} />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Lactation Advice</label>
          <textarea value={form.lactation_advice} onChange={e => setField('lactation_advice', e.target.value)}
            rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            placeholder="Exclusive breastfeeding for 6 months, proper latch technique explained..." />
        </div>
      </Section>

      {/* ═══════ NOTES ═══════ */}
      <Section title="Notes & Complications" icon={Stethoscope} color="bg-gray-50 text-gray-800" defaultOpen={false}>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Delivery Notes</label>
            <textarea value={form.delivery_notes} onChange={e => setField('delivery_notes', e.target.value)}
              rows={3} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              placeholder="Detailed delivery narrative..." />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Complications</label>
            <textarea value={form.complications} onChange={e => setField('complications', e.target.value)}
              rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              placeholder="None / Describe any complications..." />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Postpartum Notes</label>
            <textarea value={form.postpartum_notes} onChange={e => setField('postpartum_notes', e.target.value)}
              rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              placeholder="Post-delivery observations, recovery notes..." />
          </div>
        </div>
      </Section>

      {/* Vaccination Schedule Preview */}
      {form.delivery_date && (
        <div className="border border-blue-200 rounded-lg overflow-hidden">
          <button onClick={() => setShowVaxSchedule(!showVaxSchedule)}
            className="w-full flex items-center justify-between px-4 py-3 bg-blue-50 text-blue-800 text-left">
            <span className="flex items-center gap-2 font-medium text-sm">
              <Syringe className="w-4 h-4" /> Baby Vaccination Schedule (Indian NIS)
            </span>
            {showVaxSchedule ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {showVaxSchedule && (
            <div className="p-4">
              <p className="text-xs text-gray-500 mb-3">
                Based on baby's date of birth: <strong>{form.delivery_date}</strong>.
                Appointments are auto-created when you save the delivery record.
              </p>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th className="text-left p-2">Vaccine</th>
                    <th className="text-left p-2">Due Date</th>
                    <th className="text-left p-2">Age</th>
                    <th className="text-left p-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {getUpcomingVaccinations(form.delivery_date).map((v, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="p-2 text-gray-700">{v.name}</td>
                      <td className="p-2 text-gray-600">{v.dueDate}</td>
                      <td className="p-2 text-gray-500 text-xs">{v.note}</td>
                      <td className="p-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          v.isPast ? 'bg-gray-100 text-gray-500'
                            : v.daysFromNow <= 7 ? 'bg-red-100 text-red-700'
                            : v.daysFromNow <= 30 ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-green-100 text-green-700'
                        }`}>
                          {v.isPast ? 'Done/Past' : v.daysFromNow <= 0 ? 'Due today' : `In ${v.daysFromNow}d`}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Bottom save button */}
      <div className="flex justify-end pt-2">
        <button onClick={saveRecord} disabled={saving}
          className="bg-pink-600 hover:bg-pink-700 text-white px-6 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Delivery Record
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// FORM HELPERS
// ═══════════════════════════════════════════════════════════════════

function Field({ label, value, onChange, type = 'text', placeholder }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string
}) {
  return (
    <div>
      <label className="text-xs text-gray-500 block mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-pink-500 focus:border-pink-500" />
    </div>
  )
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: string[]
}) {
  return (
    <div>
      <label className="text-xs text-gray-500 block mb-1">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-pink-500 focus:border-pink-500 bg-white">
        {options.map(o => <option key={o} value={o}>{o || '— Select —'}</option>)}
      </select>
    </div>
  )
}

function Toggle({ label, checked, onChange }: {
  label: string; checked: boolean; onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700 py-1">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        className="w-4 h-4 rounded border-gray-300 text-pink-600 focus:ring-pink-500" />
      {label}
    </label>
  )
}