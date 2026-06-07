'use client'
import { Suspense, useEffect, useState, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import ConsultationAttachments from '@/components/shared/ConsultationAttachments'
import ConsultationFeeCollector from '@/components/billing/ConsultationFeeCollector'
import SmartMic from '@/components/shared/SmartMic'
import { supabase } from '@/lib/supabase'
import { useAuth, loadClinicUser } from '@/lib/auth'
import { calculateBMI, calculateEDD, calculateGA, getHospitalSettings, getIndiaToday, formatDate, minFollowUpDate, isSunday } from '@/lib/utils'
import type { Patient, OBData, Procedure, ObstetricEntry, AbortionEntry, Medication } from '@/types'
import type { OCRResult } from '@/lib/ocr'
import { ArrowLeft, Save, ChevronRight, AlertCircle, ScanLine, Camera, Loader2, Sparkles, X, Plus, Trash2, CheckCircle, Shield } from 'lucide-react'
import Toast from '@/components/shared/Toast'
import AutoSaveIndicator from '@/components/shared/AutoSaveIndicator'
import type { AutoSaveStatus } from '@/lib/useAutoSave'
import { searchDrugs } from '@/lib/drug-database'
import { runPrescriptionSafetyChecks } from '@/lib/prescription-safety'
import type { ClinicalAlert } from '@/components/clinical/ClinicalSafetyModal'
import ClinicalSafetyModal from '@/components/clinical/ClinicalSafetyModal'
import { audit, auditSafetyOverride } from '@/lib/audit'
import { createFollowUp, handleVisitCompletion, syncAppointmentFromOPD } from '@/lib/services/appointmentService'

// ── Prescription constants ────────────────────────────────────
const RX_ROUTES = ['Oral', 'IV', 'IM', 'Topical', 'Sublingual', 'Inhalation', 'Rectal', 'Nasal']
const RX_FREQS = [
  'Once daily', 'Twice daily', 'Thrice daily', 'Four times daily',
  'Every 6 hours', 'Every 8 hours', 'At bedtime', 'SOS / As needed', 'Once weekly',
]
const RX_COMMON_DRUGS = [
  'Folic Acid 5mg', 'Iron + Folic Acid', 'Calcium 500mg', 'Vitamin D3 60000 IU',
  'Progesterone 200mg SR', 'Dydrogesterone 10mg', 'Methyldopa 250mg', 'Labetalol 100mg',
  'Nifedipine 10mg', 'Nifedipine 30mg SR', 'Metformin 500mg', 'Metformin 1000mg',
  'Tranexamic acid 500mg', 'Mefenamic acid 500mg', 'Norethisterone 5mg',
  'Clomiphene 50mg', 'Letrozole 2.5mg', 'Azithromycin 500mg', 'Amoxicillin 500mg',
  'Metronidazole 400mg', 'Ondansetron 4mg', 'Domperidone 10mg', 'Pantoprazole 40mg',
  'Paracetamol 500mg', 'Ibuprofen 400mg',
]
const RX_REPORT_OPTIONS = [
  'CBC (Complete Blood Count)', 'Hb (Haemoglobin)', 'Blood group & Rh',
  'Blood sugar fasting', 'Blood sugar PP (post-prandial)', 'HbA1c',
  'Thyroid function test (TSH, T3, T4)', 'LH / FSH', 'Prolactin',
  'AMH (Anti-Mullerian Hormone)', 'Beta-hCG (Pregnancy test)', 'CA-125',
  'Lipid profile', 'Liver function test (LFT)', 'Kidney function test (KFT)',
  'Coagulation profile (PT, INR, aPTT)', 'Serum iron & ferritin',
  'Vitamin D3', 'Vitamin B12',
  'Urine routine & microscopy', 'Urine culture & sensitivity',
  'USG Pelvis (Transvaginal)', 'USG Pelvis (Transabdominal)', 'USG Abdomen',
  'USG Pelvis for follicular study', 'USG Obstetric (dating / anomaly)',
  'Fetal growth scan', 'Colour Doppler study', 'Mammography',
  'PAP smear / cervical cytology', 'High vaginal swab (HVS) culture', 'Colposcopy',
  'ECG', 'ECHO (Echocardiogram)',
  'OGTT (Glucose tolerance test)', 'Semen analysis (husband)',
]
const emptyMed = (): Medication => ({
  drug: '', dose: '', route: 'Oral', frequency: 'Twice daily', duration: '', instructions: '',
})

// ── Tab types ─────────────────────────────────────────────────
type Tab = 'vitals' | 'consultation' | 'obgyn' | 'prescription'

// ── Vitals state ──────────────────────────────────────────────
interface Vitals {
  pulse: string; bp_systolic: string; bp_diastolic: string
  temperature: string; spo2: string; weight: string; height: string
}
const EMPTY_VITALS: Vitals = {
  pulse: '', bp_systolic: '', bp_diastolic: '',
  temperature: '', spo2: '', weight: '', height: '',
}

// ── Highlight tracking ────────────────────────────────────────
type VitalsHL = Partial<Record<keyof Vitals, boolean>>
type OBHL = Partial<Record<keyof OBData, boolean>>
interface ConsultHL { chiefComplaint?: boolean; diagnosis?: boolean; notes?: boolean; hpi?: boolean }

// ── Ordinal suffix helper ─────────────────────────────────────
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return String(n) + (s[(v - 20) % 10] || s[v] || s[0])
}

// v5 FIX: Resolve a usable doctor name without refusing to save when
// clinic_users.full_name is just empty in the DB. Returns:
//   { ok: true, doctorName }  — proceed with the save
//   { ok: false, reason }     — abort with this user-facing message
// The original OPD-4 guard refused to save whenever user.full_name was empty,
// which made the app unusable for any clinic_users row missing that field.
// This version distinguishes "no session" (real auth problem — refuse) from
// "session valid but full_name empty" (data-quality issue — degrade gracefully
// and log a warning so the admin can fix the row).
async function resolveSavingDoctor(
  ctxUser: { full_name?: string; email?: string } | null,
): Promise<{ ok: true; doctorName: string } | { ok: false; reason: string }> {
  if (ctxUser?.full_name) return { ok: true, doctorName: ctxUser.full_name }

  // No full_name on the in-memory user — verify the session is alive before
  // any DB write. A truly signed-out user gets the original guard message.
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    return {
      ok: false,
      reason:
        'Your session has expired. Please sign in again before saving — ' +
        'we do not want to attribute this encounter to the wrong doctor.',
    }
  }

  // Session is valid — try a fresh read of clinic_users in case our cached
  // copy is stale.
  let doctorName = ''
  try {
    const refreshed = await loadClinicUser()
    if (refreshed?.full_name) doctorName = refreshed.full_name
  } catch { /* fall through to next fallback */ }

  // Last-resort fallbacks: auth email, then hospital settings.
  if (!doctorName) {
    try {
      const { data: { user: au } } = await supabase.auth.getUser()
      doctorName = au?.email || ''
    } catch { /* ignore */ }
  }
  if (!doctorName && typeof window !== 'undefined') {
    try {
      const hs = getHospitalSettings()
      doctorName = (hs as any)?.doctorName || ''
    } catch { /* ignore */ }
  }
  if (!doctorName) doctorName = 'Unknown Doctor'

  console.warn(
    '[OPD] Saving with fallback doctor name:', doctorName,
    '— clinic_users.full_name is empty for the signed-in user. Please update the row in Settings → Manage Users.',
  )

  return { ok: true, doctorName }
}

function NewConsultationContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const patientId = searchParams.get('patient')
  const prefillFlag = searchParams.get('prefill')
  const { user } = useAuth()

  const [patient, setPatient] = useState<Patient | null>(null)
  const [tab, setTab] = useState<Tab>('vitals')
  const [vitals, setVitals] = useState<Vitals>(EMPTY_VITALS)
  const [ob, setOB] = useState<OBData>({})
  const [chiefComplaint, setChiefComplaint] = useState('')
  const [hpi, setHpi] = useState('')
  const [diagnosis, setDiagnosis] = useState('')
  const [notes, setNotes] = useState('')
  const [procedures, setProcedures] = useState<Procedure[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [lastDiagnosis, setLastDiagnosis] = useState('')
  const [visitedToday, setVisitedToday] = useState(false)

  // OCR highlights
  const [vHL, setVHL] = useState<VitalsHL>({})
  const [obHL, setObHL] = useState<OBHL>({})
  const [cHL, setCHL] = useState<ConsultHL>({})

  // ── Doctor note camera state ──────────────────────────────────
  const [noteOcrLoading, setNoteOcrLoading] = useState(false)
  const [noteOcrPreview, setNoteOcrPreview] = useState<any>(null)
  const [noteOcrError, setNoteOcrError] = useState('')
  const [noteApplied, setNoteApplied] = useState(false)
  const [noteMedsQueue, setNoteMedsQueue] = useState('')

  // ── Draft auto-save status (for visual indicator) ──
  const [draftStatus, setDraftStatus] = useState<AutoSaveStatus>('idle')

  // ── Prescription state (combined on same page) ──────────────
  const [rxMeds, setRxMeds] = useState<Medication[]>([emptyMed()])
  const [rxAdvice, setRxAdvice] = useState('')
  const [rxDietaryAdvice, setRxDietaryAdvice] = useState('')
  const [rxReportsNeeded, setRxReportsNeeded] = useState('')
  const [rxFollowUpDate, setRxFollowUpDate] = useState('')
  const [rxFollowUpTime, setRxFollowUpTime] = useState('10:00')
  const [rxDrugSuggestion, setRxDrugSuggestion] = useState<{ idx: number; list: string[] } | null>(null)
  const [rxSafetyAlerts, setRxSafetyAlerts] = useState<ClinicalAlert[]>([])
  const [rxShowSafetyModal, setRxShowSafetyModal] = useState(false)
  const [rxSafetyChecked, setRxSafetyChecked] = useState(false)
  const [showBillingPrompt, setShowBillingPrompt] = useState(false)
  const [savedEncounterId, setSavedEncounterId] = useState<string | null>(null)

  // ── Consultation Fee Gate state ─────────────────────────────────
  // Shows fee collection screen before allowing consultation form access
  const [feeGateStatus, setFeeGateStatus] = useState<'checking' | 'required' | 'paid' | 'skipped'>('checking')
  const [hasTodayBill, setHasTodayBill] = useState(false)
  const [isNewCaseForFee, setIsNewCaseForFee] = useState(true)

  // Draft key — persists form state across navigation for this patient
  const draftKey = patientId ? `opd_draft_${patientId}` : null

  // FIX CRITICAL #1: Guard flag to prevent auto-save from firing during initial reset
  const [draftReady, setDraftReady] = useState(false)

  // Voice state removed — SmartMic component handles everything

  // Derived
  const bmi = calculateBMI(parseFloat(vitals.weight), parseFloat(vitals.height))
  const edd = ob.lmp ? calculateEDD(ob.lmp) : ''
  const ga = ob.lmp ? calculateGA(ob.lmp) : ''

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║  BUG #1 FIX — New Consultation Shows Old Data                      ║
  // ║                                                                    ║
  // ║  FILE TO EDIT: src/app/opd/new/[patientId]/page.tsx                ║
  // ║                                                                    ║
  // ║  INSTRUCTIONS:                                                     ║
  // ║  1. Open the OPD new consultation page file                        ║
  // ║  2. Find all the useState declarations (near the top of the        ║
  // ║     component function)                                            ║
  // ║  3. Find the FIRST useEffect in the file                           ║
  // ║  4. ADD the new useEffect shown below BEFORE that first useEffect  ║
  // ║  5. Save the file                                                  ║
  // ║                                                                    ║
  // ║  WHY THIS IS NEEDED:                                               ║
  // ║  When a doctor clicks "New Consultation" for a patient, the form   ║
  // ║  should be completely empty. But currently:                         ║
  // ║  - Old vitals (BP, pulse, weight) from last visit show up          ║
  // ║  - Old chief complaint and diagnosis appear                        ║
  // ║  - Old notes from previous visit fill the notes field              ║
  // ║  - sessionStorage draft from an interrupted session loads           ║
  // ║                                                                    ║
  // ║  This is DANGEROUS because a doctor might save old data as a new   ║
  // ║  consultation without realizing it was from the previous visit.    ║
  // ║                                                                    ║
  // ║  IMPACT AFTER FIX:                                                 ║
  // ║  ✅ Every new consultation starts with a completely empty form     ║
  // ║  ✅ No risk of accidentally saving old data as new entry           ║
  // ║  ✅ Clean slate every time, even if doctor navigated away before   ║
  // ╚══════════════════════════════════════════════════════════════════════╝


  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // ADD this useEffect BEFORE any other useEffects in the component.
  // It should be the FIRST useEffect after all the useState declarations.
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  // ── 🧹 CLEAN FORM ON MOUNT — always start fresh ──────────────────────
  // This runs once when the page opens for a new consultation.
  // It clears any leftover draft data and resets all form fields.
  useEffect(() => {
    // Clear any saved draft from a previous unfinished session
    try {
      sessionStorage.removeItem(`opd_draft_${patientId}`)
    } catch {
      // sessionStorage might not be available (SSR) — that's fine
    }

    // Reset all form fields to empty/default values
    // (These are the setter functions from your useState declarations)
    setVitals({
      pulse: '',
      bp_systolic: '',
      bp_diastolic: '',
      temperature: '',
      spo2: '',
      weight: '',
      height: '',
    })
    setChiefComplaint('')
    setDiagnosis('')
    setNotes('')
    setHpi('')
    setProcedures([])
    setOB({})

    // Reset OCR highlight indicators
    setVHL({})
    setCHL({})
    setObHL({})

    // Reset error and status flags
    setError('')
    setVisitedToday(false)
    setNoteApplied(false)
    setNoteOcrError('')
    setNoteOcrPreview(null)
    setNoteMedsQueue('')

    // FIX CRITICAL #1: Mark draft as NOT ready during reset, then enable after a tick
    setDraftReady(false)
    setTimeout(() => setDraftReady(true), 100)

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId])
  // ↑ [patientId] means: re-run this reset whenever the patient changes
  //   (or when the page first loads)


  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // EXPLANATION FOR BEGINNERS:
  //
  // useEffect is a React feature that runs code when something happens.
  //
  // useEffect(() => {
  //   // code here runs when the page loads
  // }, [patientId])
  //
  // The [patientId] at the end is like saying:
  // "Run this code when the page first opens, and also if the patient changes"
  //
  // Inside, we call all the "setter" functions (like setVitals, setDiagnosis)
  // with empty values. This is like erasing a whiteboard before writing.
  //
  // The sessionStorage.removeItem line deletes any saved draft.
  // sessionStorage is like a temporary notepad in the browser — it remembers
  // things even if you navigate to another page. We need to clear it so
  // old drafts don't show up as new consultation data.
  //
  // WHY IS THIS SAFE?
  // - This only runs at the START (page mount)
  // - It doesn't affect the save logic at all
  // - After the user starts typing, their new data is in the form
  // - The patient data (name, age, MRN) loads separately and is NOT reset
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


  useEffect(() => {
    if (!patientId) { router.push('/opd'); return }

    // 2. Load OCR prefill from forms page scanner
    try {
      const ocrKey = `ocr_prefill_${patientId}`
      const ocr = JSON.parse(sessionStorage.getItem(ocrKey) || 'null')
      if (ocr && prefillFlag) {
        if (ocr.vitals) {
          setVitals(prev => ({
            ...prev,
            ...(ocr.vitals.pulse && { pulse: String(ocr.vitals.pulse) }),
            ...(ocr.vitals.bp_systolic && { bp_systolic: String(ocr.vitals.bp_systolic) }),
            ...(ocr.vitals.bp_diastolic && { bp_diastolic: String(ocr.vitals.bp_diastolic) }),
            ...(ocr.vitals.temperature && { temperature: String(ocr.vitals.temperature) }),
            ...(ocr.vitals.spo2 && { spo2: String(ocr.vitals.spo2) }),
            ...(ocr.vitals.weight && { weight: String(ocr.vitals.weight) }),
            ...(ocr.vitals.height && { height: String(ocr.vitals.height) }),
          }))
        }
        if (ocr.vitals?.chief_complaint) setChiefComplaint(ocr.vitals.chief_complaint)
        if (ocr.vitals?.notes) setHpi(ocr.vitals.notes)
        if (ocr.vitals?.diagnosis) setDiagnosis(ocr.vitals.diagnosis)
        if (ocr.ob_data) {
          setOB(prev => ({ ...prev, ...ocr.ob_data }))
        }
        // Clear prefill after applying
        sessionStorage.removeItem(ocrKey)
      }
    } catch { /* ignore */ }

    // 3. Load patient + pre-fill height from last encounter
    Promise.all([
      supabase.from('patients').select('*').eq('id', patientId).single(),
      supabase.from('encounters')
        .select('height, diagnosis')
        .eq('patient_id', patientId)
        .order('encounter_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]).then(([{ data: pat }, { data: lastEnc }]) => {
      if (pat) setPatient(pat)
      if (lastEnc?.height && !vitals.height) {
        setVitals(prev => ({ ...prev, height: String(lastEnc.height) }))
      }
      if (lastEnc?.diagnosis) {
        setLastDiagnosis(lastEnc.diagnosis)
      }
    })
    const today = getIndiaToday() as string

    (async () => {
      try {
        const { data } = await supabase
          .from('encounters')
          .select('id')
          .eq('patient_id', patientId)
          .eq('encounter_date', today)
          .limit(1)
          .maybeSingle()

        setVisitedToday(!!data?.id)
      } catch {
        // ignore
      }
    })()


  }, [patientId])

  // ── Fee Gate: Check if patient already has a bill for today ──────────
  // If they do, skip the fee gate. If not, show fee collection before consultation.
  useEffect(() => {
    if (!patientId) return

    async function checkTodayBill() {
      try {
        const today = getIndiaToday()
        // Check if patient has any bill created today
        const { data: todayBills } = await supabase
          .from('bills')
          .select('id, status')
          .eq('patient_id', patientId)
          .gte('created_at', today + 'T00:00:00')
          .limit(1)

        if (todayBills && todayBills.length > 0) {
          // Patient already has a bill for today — skip fee gate
          setHasTodayBill(true)
          setFeeGateStatus('paid')
        } else {
          // Check if this is a new or returning patient
          const { count } = await supabase
            .from('encounters')
            .select('id', { count: 'exact', head: true })
            .eq('patient_id', patientId)

          setIsNewCaseForFee((count || 0) === 0)
          setFeeGateStatus('required')
        }
      } catch {
        // On error, allow consultation to proceed (non-blocking)
        setFeeGateStatus('paid')
      }
    }

    // Check if fee was already collected in this session (e.g., from registration page)
    const sessionKey = `fee_collected_${patientId}_${getIndiaToday()}`
    if (typeof window !== 'undefined' && sessionStorage.getItem(sessionKey)) {
      setFeeGateStatus('paid')
      return
    }

    checkTodayBill()
  }, [patientId])


  // Auto-save draft to sessionStorage on any change
  useEffect(() => {
    if (!patientId) return
    // FIX CRITICAL #1: Don't auto-save until the initial reset is complete
    if (!draftReady) return
    const key = `opd_draft_${patientId}`
    try {
      sessionStorage.setItem(key, JSON.stringify({ vitals, ob, chiefComplaint, hpi, diagnosis, notes }))
      // Flash saved indicator briefly
      setDraftStatus('saved')
      const t = setTimeout(() => setDraftStatus('idle'), 2000)
      return () => clearTimeout(t)
    } catch { /* ignore */ }
  }, [vitals, ob, chiefComplaint, hpi, diagnosis, notes, patientId, draftReady])

  // ── Field setters ─────────────────────────────────────────────
  function setV(k: keyof Vitals, v: string) { setVitals(p => ({ ...p, [k]: v })) }
  function setO(k: keyof OBData, v: any) { setOB(p => ({ ...p, [k]: v })) }

  // ── Highlight helper: apply then clear after 2 s ──────────────
  function flashHL<T>(setter: React.Dispatch<React.SetStateAction<T>>, hl: T) {
    setter(hl)
    setTimeout(() => setter({} as T), 2000)
  }

  // ── OCR callback ──────────────────────────────────────────────
  const handleOCRResult = useCallback((result: OCRResult) => {
    const vitalsHL: VitalsHL = {}
    const obHL_: OBHL = {}
    const cHL_: ConsultHL = {}

    // ── Vitals section ─────────────────────────────────────────
    if (result.vitals) {
      const v = result.vitals
      if (v.pulse) { setV('pulse', v.pulse); vitalsHL.pulse = true }
      if (v.bp_systolic) { setV('bp_systolic', v.bp_systolic); vitalsHL.bp_systolic = true }
      if (v.bp_diastolic) { setV('bp_diastolic', v.bp_diastolic); vitalsHL.bp_diastolic = true }
      if (v.temperature) { setV('temperature', v.temperature); vitalsHL.temperature = true }
      if (v.spo2) { setV('spo2', v.spo2); vitalsHL.spo2 = true }
      if (v.weight) { setV('weight', v.weight); vitalsHL.weight = true }
      if (v.height) { setV('height', v.height); vitalsHL.height = true }

      if (v.chief_complaint) { setChiefComplaint(v.chief_complaint); cHL_.chiefComplaint = true }
      if (v.diagnosis) { setDiagnosis(v.diagnosis); cHL_.diagnosis = true }
      if (v.notes) { setNotes(v.notes); cHL_.notes = true }
    }

    // ── OB/GYN section ─────────────────────────────────────────
    if (result.ob_data) {
      const o = result.ob_data
      // Helper to set and flag
      const applyOB = (k: keyof OBData, val: any) => {
        if (val !== undefined && val !== null && val !== '') {
          setO(k, typeof val === 'string' ? val : val)
            ; (obHL_ as any)[k] = true
        }
      }
      applyOB('lmp', o.lmp)
      applyOB('gravida', o.gravida)
      applyOB('para', o.para)
      applyOB('abortion', o.abortion)
      applyOB('living', o.living)
      applyOB('fhs', o.fhs)
      applyOB('liquor', o.liquor)
      applyOB('fundal_height', o.fundal_height)
      applyOB('presentation', o.presentation)
      applyOB('engagement', o.engagement)
      applyOB('uterus_size', o.uterus_size)
      applyOB('scar_tenderness', o.scar_tenderness)
      applyOB('fetal_movement', o.fetal_movement)
      applyOB('per_abdomen', o.per_abdomen)
      applyOB('cervix_speculum', o.cervix_speculum)
      applyOB('discharge_speculum', o.discharge_speculum)
      applyOB('bleeding_speculum', o.bleeding_speculum)
      applyOB('per_speculum', o.per_speculum)
      applyOB('cervix_pv', o.cervix_pv)
      applyOB('os_pv', o.os_pv)
      applyOB('uterus_position', o.uterus_position)
      applyOB('per_vaginum', o.per_vaginum)
      applyOB('right_ovary', o.right_ovary)
      applyOB('left_ovary', o.left_ovary)
      // ── New fields ──────────────────────────────────────────
      applyOB('menstrual_regularity', o.menstrual_regularity)
      applyOB('menstrual_flow', o.menstrual_flow)
      applyOB('post_menstrual_days', o.post_menstrual_days)
      applyOB('post_menstrual_pain', o.post_menstrual_pain)
      applyOB('urine_pregnancy_result', o.urine_pregnancy_result)
      applyOB('obstetric_history', o.obstetric_history)
      applyOB('abortion_entries', o.abortion_entries)
      applyOB('past_diabetes', o.past_diabetes)
      applyOB('past_hypertension', o.past_hypertension)
      applyOB('past_thyroid', o.past_thyroid)
      applyOB('past_surgery', o.past_surgery)
      applyOB('past_surgery_detail', o.past_surgery_detail)
      applyOB('income', o.income)
      applyOB('expenditure', o.expenditure)
    }

    flashHL(setVHL, vitalsHL)
    flashHL(setObHL, obHL_)
    flashHL(setCHL, cHL_)

    // Auto-jump to the tab where most data landed
    const vitalsCount = Object.keys(vitalsHL).length
    const obCount = Object.keys(obHL_).length
    const cCount = Object.keys(cHL_).length

    if (obCount > vitalsCount && obCount > cCount) setTab('obgyn')
    else if (cCount >= vitalsCount) setTab('consultation')
    else setTab('vitals')
  }, [])

  // startVoice removed — SmartMic handles STT + AI correction

  // ── Doctor Note Camera: send photo to OCR API ─────────────────
  async function handleNotePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setNoteOcrLoading(true)
    setNoteOcrError('')
    setNoteOcrPreview(null)
    setNoteApplied(false)
    try {
      const fd = new FormData()
      fd.append('image', file)
      fd.append('mode', 'autofill')
      fd.append('context', `OPD consultation note for gynecology patient ${patient?.full_name || ''} — extract chief complaint, diagnosis, vitals, history, plan, medications, follow-up`)
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const res = await fetch('/api/doctor-note-ocr', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `OCR failed (${res.status})`)
      }
      const data = await res.json()
      setNoteOcrPreview(data)
    } catch (err: any) {
      setNoteOcrError(err.message || 'Failed to read note. Ensure AI key is configured (/ai-setup).')
    } finally {
      setNoteOcrLoading(false)
    }
  }

  // ── Doctor Note Camera: apply extracted fields to form ─────────
  const handleDoctorNote = useCallback((data: any) => {
    const f = data?.fields || {}
    const vitalsHL: VitalsHL = {}
    const cHL_: ConsultHL = {}
    const obHL_: OBHL = {}

    // Vitals
    if (f.pulse) { setV('pulse', String(f.pulse)); vitalsHL.pulse = true }
    if (f.bp_systolic) { setV('bp_systolic', String(f.bp_systolic)); vitalsHL.bp_systolic = true }
    if (f.bp_diastolic) { setV('bp_diastolic', String(f.bp_diastolic)); vitalsHL.bp_diastolic = true }
    if (f.temperature) { setV('temperature', String(f.temperature)); vitalsHL.temperature = true }
    if (f.spo2) { setV('spo2', String(f.spo2)); vitalsHL.spo2 = true }
    if (f.weight) { setV('weight', String(f.weight)); vitalsHL.weight = true }
    if (f.height) { setV('height', String(f.height)); vitalsHL.height = true }

    // Chief complaint — only fill if currently empty
    if (f.chief_complaint) {
      setChiefComplaint(prev => prev.trim() ? prev : f.chief_complaint)
      cHL_.chiefComplaint = true
    }
    // Diagnosis — only fill if currently empty
    if (f.diagnosis) {
      setDiagnosis(prev => prev.trim() ? prev : f.diagnosis)
      cHL_.diagnosis = true
    }

    // HPI — build from history + duration
    const hpiLines: string[] = []
    if (f.history) hpiLines.push(f.history)
    if (f.duration) hpiLines.push(`Duration: ${f.duration}`)
    if (hpiLines.length > 0) {
      setHpi(prev => prev.trim() ? prev : hpiLines.join('\n'))
      cHL_.hpi = true
    }

    // Clinical notes — build from findings, plan, investigations, advice, follow-up
    const noteLines: string[] = []
    if (f.examination_findings) noteLines.push(`O/E: ${f.examination_findings}`)
    if (f.treatment_plan) noteLines.push(`Plan: ${f.treatment_plan}`)
    if (f.investigations_ordered) noteLines.push(`Ix: ${f.investigations_ordered}`)
    if (f.advice) noteLines.push(`Advice: ${f.advice}`)
    if (f.follow_up_date) noteLines.push(`Follow-up: ${f.follow_up_date}`)
    if (noteLines.length > 0) {
      setNotes(prev => prev.trim() ? prev + '\n\n' + noteLines.join('\n') : noteLines.join('\n'))
      cHL_.notes = true
    }

    // Medications → queue as amber banner for prescription reference
    if (Array.isArray(f.medicines) && f.medicines.length > 0) {
      const medStr = f.medicines
        .map((m: any) => `• ${m.name || ''} ${m.dose || ''} ${m.frequency || ''} ${m.days ? `× ${m.days}` : ''}`.trim())
        .join('\n')
      setNoteMedsQueue(medStr)
    }

    // OB/GYN fields (if ANC note)
    if (f.lmp) { setO('lmp', f.lmp); (obHL_ as any).lmp = true }
    if (f.edd) { setO('edd', f.edd); (obHL_ as any).edd = true }
    if (f.gravida != null) { setO('gravida', f.gravida); (obHL_ as any).gravida = true }
    if (f.para != null) { setO('para', f.para); (obHL_ as any).para = true }
    if (f.gestational_age_weeks) { setO('gestational_age', `${f.gestational_age_weeks} weeks`); (obHL_ as any).gestational_age = true }
    if (f.fundal_height) { setO('fundal_height', f.fundal_height); (obHL_ as any).fundal_height = true }
    if (f.fhs) { setO('fhs', f.fhs); (obHL_ as any).fhs = true }

    // Flash highlights and auto-jump to most-filled tab
    flashHL(setVHL, vitalsHL)
    flashHL(setCHL, cHL_)
    flashHL(setObHL, obHL_)

    const vc = Object.keys(vitalsHL).length
    const cc = Object.keys(cHL_).length
    const oc = Object.keys(obHL_).length
    if (oc > 0 && oc >= vc && oc >= cc) setTab('obgyn')
    else if (cc > 0) setTab('consultation')
    else if (vc > 0) setTab('vitals')

    setNoteApplied(true)
    setTimeout(() => setNoteApplied(false), 4000)
  }, [patient])

  // ── Prescription helper functions ─────────────────────────────
  function updateRxMed(idx: number, field: keyof Medication, val: string) {
    setRxMeds(prev => prev.map((m, i) => (i === idx ? { ...m, [field]: val } : m)))
  }
  function addRxMed() { setRxMeds(prev => [...prev, emptyMed()]) }
  function removeRxMed(idx: number) {
    setRxMeds(prev => (prev.length === 1 ? [emptyMed()] : prev.filter((_, i) => i !== idx)))
  }
  function handleRxDrugInput(idx: number, val: string) {
    updateRxMed(idx, 'drug', val)
    setRxSafetyChecked(false)
    if (val.length >= 2) {
      const dbMatches = searchDrugs(val, 4).map(d => `${d.generic} ${d.strengths[0] ?? ''}`.trim())
      const commonMatches = RX_COMMON_DRUGS.filter(d => d.toLowerCase().includes(val.toLowerCase()))
      const allMatches = Array.from(new Set([...dbMatches, ...commonMatches])).slice(0, 8)
      setRxDrugSuggestion(allMatches.length ? { idx, list: allMatches } : null)
    } else {
      setRxDrugSuggestion(null)
    }
  }

  // ── Save All (Encounter + Prescription) ───────────────────────
  async function handleSaveAll() {
    if (!patientId) return
    if (!chiefComplaint.trim() && !diagnosis.trim()) {
      setError('Please enter at least a chief complaint or diagnosis.')
      return
    }

    // ── OPD-4 fix (v5): verify session and resolve a usable doctor name ──
    // The original guard refused to save whenever user.full_name was empty,
    // which deadlocked any signed-in user whose clinic_users row lacks that
    // field. We now refuse ONLY when there is no Supabase session.
    const resolved = await resolveSavingDoctor(user)
    if (!resolved.ok) { setError(resolved.reason); return }
    const doctorName = resolved.doctorName

    // Run safety check on medications if any exist
    const validMeds = rxMeds.filter(m => m.drug.trim())
    if (validMeds.length > 0 && !rxSafetyChecked) {
      const isPregnant = !!(ob.lmp || ob.edd)
      const result = await runPrescriptionSafetyChecks({
        medications: validMeds,
        patientId: patientId,
        patientAge: patient?.age,
        patientWeight: vitals.weight ? parseFloat(vitals.weight) : undefined,
        isPregnant,
        gestationalAge: ga || undefined,
      })
      if (result.hasAlerts) {
        setRxSafetyAlerts(result.alerts)
        setRxShowSafetyModal(true)
        return
      }
      setRxSafetyChecked(true)
    }

    setSaving(true)
    setError('')

    const today = getIndiaToday()

    const obPayload: OBData = { ...ob }
    if (ob.lmp) { obPayload.edd = edd; obPayload.gestational_age = ga }

    // ── Step 1: Save encounter ──────────────────────────────────
    const { data: enc, error: encErr } = await supabase
      .from('encounters')
      .insert({
        patient_id: patientId,
        encounter_type: 'OPD',
        encounter_date: today,
        chief_complaint: chiefComplaint.trim() || null,
        pulse: vitals.pulse ? parseInt(vitals.pulse) : null,
        bp_systolic: vitals.bp_systolic ? parseInt(vitals.bp_systolic) : null,
        bp_diastolic: vitals.bp_diastolic ? parseInt(vitals.bp_diastolic) : null,
        temperature: vitals.temperature ? parseFloat(vitals.temperature) : null,
        spo2: vitals.spo2 ? parseInt(vitals.spo2) : null,
        weight: vitals.weight ? parseFloat(vitals.weight) : null,
        height: vitals.height ? parseFloat(vitals.height) : null,
        diagnosis: diagnosis.trim() || null,
        notes: (hpi.trim() ? 'HPI: ' + hpi.trim() + (notes.trim() ? '\n\n' + notes.trim() : '') : notes.trim()) || null,
        ob_data: obPayload,
        procedures: procedures.length > 0 ? procedures : null,
        // OPD-4 (v5): use the resolved doctor name — always the signed-in
        // user when available, with a clearly-logged fallback only when
        // clinic_users.full_name is empty.
        doctor_name: doctorName,
      })
      .select('id')
      .single()

    if (encErr || !enc) {
      setSaving(false)
      setError(`Failed to save encounter: ${encErr?.message}`)
      return
    }

    // ── Step 2: Save prescription ───────────────────────────────
    if (validMeds.length > 0 || rxAdvice.trim() || rxReportsNeeded.trim() || rxFollowUpDate) {
      const rxPayload = {
        encounter_id: enc.id,
        patient_id: patientId,
        medications: validMeds,
        advice: rxAdvice.trim() || null,
        dietary_advice: rxDietaryAdvice.trim() || null,
        reports_needed: rxReportsNeeded.trim() || null,
        follow_up_date: rxFollowUpDate || null,
      }
      const { error: rxErr } = await supabase.from('prescriptions').insert(rxPayload)
      if (rxErr) {
        console.warn('[OPD] prescription save failed (non-fatal):', rxErr.message)
        // Non-fatal — encounter was already saved successfully
      }
    }

    // ── Step 3: Post-save actions (same as before) ──────────────
    // Notification
    try {
      const { default: notify } = await import('@/lib/notifications')
      await notify.opdConsultationSaved(patientId!, patient?.full_name || '', diagnosis.trim() || undefined)
    } catch { /* non-fatal */ }

    // Link attachments
    try {
      await supabase.from('consultation_attachments')
        .update({ encounter_id: enc.id })
        .eq('patient_id', patientId)
        .is('encounter_id', null)
      await supabase.from('consultation_files_db')
        .update({ encounter_id: enc.id })
        .eq('patient_id', patientId)
        .is('encounter_id', null)
    } catch { /* non-fatal */ }

    // Queue sync
    try {
      const todayDate = getIndiaToday()
      const { data: existingRow } = await supabase
        .from('opd_queue')
        .select('id, status, encounter_id, token_number')
        .eq('patient_id', patientId)
        .eq('queue_date', todayDate)
        .maybeSingle()

      if (existingRow) {
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
        if (!existingRow.encounter_id) patch.encounter_id = enc.id
        if (existingRow.status === 'waiting' || existingRow.status === 'vitals_done') {
          patch.status = 'in_progress'
          patch.called_at = new Date().toISOString()
        }
        await supabase.from('opd_queue').update(patch).eq('id', existingRow.id)
      } else {
        // OPD-2 fix (June 2026): race-safe token allocation.  Pre-fix
        // code did SELECT-MAX → INSERT, which silently dropped patients
        // on concurrent inserts (the unique constraint kicked in but
        // the second insert vanished into a console.warn).  Now we
        // retry up to MAX_TOKEN_RETRIES on 23505 unique-violation.
        const MAX_TOKEN_RETRIES = 5
        let success = false
        for (let attempt = 0; attempt < MAX_TOKEN_RETRIES; attempt++) {
          const { data: maxRow } = await supabase
            .from('opd_queue')
            .select('token_number')
            .eq('queue_date', todayDate)
            .order('token_number', { ascending: false })
            .limit(1)
            .maybeSingle()
          const nextToken = ((maxRow?.token_number as number) || 0) + 1
          const { error: insErr } = await supabase.from('opd_queue').insert({
            patient_id: patientId,
            queue_date: todayDate,
            token_number: nextToken,
            status: 'in_progress',
            priority: 'normal',
            notes: 'Auto-created from consultation',
            called_at: new Date().toISOString(),
            encounter_id: enc.id,
          })
          if (!insErr) { success = true; break }
          const code = String((insErr as any)?.code || '')
          const msg = String((insErr as any)?.message || '').toLowerCase()
          if (code === '23505' || msg.includes('duplicate') || msg.includes('unique')) {
            await new Promise(r => setTimeout(r, 10 + Math.floor(Math.random() * 40)))
            continue
          }
          throw insErr
        }
        if (!success) {
          console.warn(
            '[OPD] queue token allocation failed after retries — encounter ' +
            'is saved but queue auto-creation gave up.  Reception can add ' +
            'the patient to the queue manually.',
          )
        }
      }
    } catch (queueErr) {
      console.warn('[OPD] queue sync failed (non-fatal):', queueErr)
    }

    // Audit
    try { await audit('create', 'prescription', enc.id, patient?.full_name ?? '') } catch { /* non-fatal */ }

    // Visit completion + appointment sync
    try { await handleVisitCompletion(patientId) } catch { /* non-fatal */ }
    try { await syncAppointmentFromOPD(patientId, patient?.full_name || '') } catch { /* non-fatal */ }

    // Follow-up creation
    if (rxFollowUpDate) {
      try {
        await createFollowUp(patientId, enc.id, rxFollowUpDate, {
          patientName: patient?.full_name || '',
          mrn: patient?.mrn || '',
          mobile: (patient as any)?.mobile || null,
          encounterDateLabel: today || '',
          followUpTime: rxFollowUpTime || '10:00',
        })
      } catch (err) {
        console.warn('[OPD] follow-up creation failed (non-fatal):', err)
      }
    }

    // ── OPD-3 fix (June 2026) ──────────────────────────────────────
    // Pre-fix queue status was previously written as 'completed' which
    // is NOT a valid value in the QueueStatus union (`'waiting' |
    // 'vitals_done' | 'in_progress' | 'done' | 'cancelled'`).  The
    // queue page filters by those literals, so tokens flipped to
    // 'completed' disappeared from the UI entirely — daily "patients
    // seen today" counters were permanently zero, CA reports
    // under-counted OPD visits, etc.  We now use the canonical 'done'
    // value and stamp done_at for the daily-revenue join.
    try {
      const todayForQueue = getIndiaToday()
      await supabase
        .from('opd_queue')
        .update({ status: 'done', done_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('patient_id', patientId)
        .eq('queue_date', todayForQueue)
        .in('status', ['in_progress', 'vitals_done', 'waiting'])
    } catch { /* non-fatal */ }

    // Clear draft
    if (patientId) { try { sessionStorage.removeItem(`opd_draft_${patientId}`) } catch { } }

    setSaving(false)
    setSavedEncounterId(enc.id)
    setShowBillingPrompt(true)
  }

  // ── Safety acknowledge handler ────────────────────────────────
  async function handleRxSafetyAcknowledge(overrideReason?: string) {
    setRxShowSafetyModal(false)
    setRxSafetyChecked(true)
    if (overrideReason && savedEncounterId) {
      await auditSafetyOverride('drug_interaction', savedEncounterId, patient?.full_name ?? '', {
        alerts: rxSafetyAlerts.map(a => ({ level: a.level, title: a.title, category: a.category })),
        overrideReason,
        medications: rxMeds.filter(m => m.drug.trim()).map(m => m.drug),
      })
    }
    // FIX MAJOR #6: Use setTimeout(0) to let React state update (rxSafetyChecked=true)
    // before re-triggering save. Without this, handleSaveAll reads stale state and
    // re-triggers the safety modal in an infinite loop.
    setTimeout(() => handleSaveAll(), 0)
  }


  async function handleSave() {
    if (!patientId) return
    if (!chiefComplaint.trim() && !diagnosis.trim()) {
      setError('Please enter at least a chief complaint or diagnosis.')
      return
    }

    // ── OPD-4 fix (v5): same resolution as handleSaveAll above ──
    const resolved = await resolveSavingDoctor(user)
    if (!resolved.ok) { setError(resolved.reason); return }
    const doctorName = resolved.doctorName

    // ── OPD-1 fix (June 2026): run prescription-safety here too ──
    // Pre-fix this code path bypassed drug-interaction, allergy, and
    // dose validation entirely (handleSaveAll above did run them but
    // this handler skipped them).  A doctor saving via this button
    // could write a Warfarin + Aspirin prescription without any of the
    // hard-stop alerts firing.  The safety modules all exist and work
    // — they just weren't being invoked here.  Now they are.
    const validMeds = rxMeds.filter(m => m.drug.trim())
    if (validMeds.length > 0 && !rxSafetyChecked) {
      const isPregnant = !!(ob.lmp || ob.edd)
      try {
        const result = await runPrescriptionSafetyChecks({
          medications: validMeds,
          patientId: patientId,
          patientAge: patient?.age,
          patientWeight: vitals.weight ? parseFloat(vitals.weight) : undefined,
          isPregnant,
          gestationalAge: ga || undefined,
        })
        if (result.hasAlerts) {
          setRxSafetyAlerts(result.alerts)
          setRxShowSafetyModal(true)
          // The modal's acknowledge handler re-triggers handleSaveAll(),
          // which goes through the same encounter+prescription save +
          // queue update path.  We do NOT continue here so the alert
          // forces an explicit clinician decision before persistence.
          return
        }
        setRxSafetyChecked(true)
      } catch (e) {
        // If the safety check itself fails, surface the error rather
        // than silently saving — failure here is rare (DB outage) but
        // we'd rather block save than save without checks.
        console.error('[OPD] prescription safety check failed:', e)
        setError(
          'Prescription safety check could not run.  Please retry.  If this ' +
          'persists, save the encounter without medications first and add ' +
          'them from the prescription page.',
        )
        return
      }
    }

    setSaving(true)
    setError('')

    // // Check if an encounter already exists for this patient today
    const today = getIndiaToday()

    // Optional: check but DO NOT block
    try {
      const { data: existing } = await supabase
        .from('encounters')
        .select('id')
        .eq('patient_id', patientId)
        .eq('encounter_date', today)
        .limit(1)
        .maybeSingle()

      // No action — just informational
      if (existing?.id) {
        console.log("Patient already visited today")
      }
    } catch (err) {
      // ignore error
    }


    const obPayload: OBData = { ...ob }
    if (ob.lmp) { obPayload.edd = edd; obPayload.gestational_age = ga }

    const { data: enc, error: encErr } = await supabase
      .from('encounters')
      .insert({
        patient_id: patientId,
        encounter_type: 'OPD',
        encounter_date: today,
        chief_complaint: chiefComplaint.trim() || null,
        pulse: vitals.pulse ? parseInt(vitals.pulse) : null,
        bp_systolic: vitals.bp_systolic ? parseInt(vitals.bp_systolic) : null,
        bp_diastolic: vitals.bp_diastolic ? parseInt(vitals.bp_diastolic) : null,
        temperature: vitals.temperature ? parseFloat(vitals.temperature) : null,
        spo2: vitals.spo2 ? parseInt(vitals.spo2) : null,
        weight: vitals.weight ? parseFloat(vitals.weight) : null,
        height: vitals.height ? parseFloat(vitals.height) : null,
        diagnosis: diagnosis.trim() || null,
        notes: (hpi.trim() ? 'HPI: ' + hpi.trim() + (notes.trim() ? '\n\n' + notes.trim() : '') : notes.trim()) || null,
        ob_data: obPayload,
        procedures: procedures.length > 0 ? procedures : null,
        // OPD-4: gated above on a confirmed user, so always the actual
        // signed-in clinician.  No fallback to hospital default.
        doctor_name: doctorName,
      })
      .select('id')
      .single()

    setSaving(false)
    if (encErr || !enc) { setError(`Failed to save: ${encErr?.message}`); return }

    // Send notification for OPD consultation
    try {
      const { default: notify } = await import('@/lib/notifications')
      await notify.opdConsultationSaved(patientId!, patient?.full_name || '', diagnosis.trim() || undefined)
    } catch { /* non-fatal */ }

    // Link any files uploaded before save (encounter_id was null) to the new encounter
    try {
      await supabase.from('consultation_attachments')
        .update({ encounter_id: enc.id })
        .eq('patient_id', patientId)
        .is('encounter_id', null)
      await supabase.from('consultation_files_db')
        .update({ encounter_id: enc.id })
        .eq('patient_id', patientId)
        .is('encounter_id', null)
    } catch { /* tables may not exist yet — ignore */ }

    // Sync today's OPD queue row with this encounter (Gap 2 + Gap 3)
    // - If a queue row exists: link encounter_id + flip status to in_progress.
    // - If no queue row exists (walk-in / bypass): auto-create one in_progress
    //   so the queue stays the source of truth for visit counts and stats.
    try {
      const todayDate = getIndiaToday()
      const { data: existingRow } = await supabase
        .from('opd_queue')
        .select('id, status, encounter_id, token_number')
        .eq('patient_id', patientId)
        .eq('queue_date', todayDate)
        .maybeSingle()

      if (existingRow) {
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
        if (!existingRow.encounter_id) patch.encounter_id = enc.id
        if (existingRow.status === 'waiting' || existingRow.status === 'vitals_done') {
          patch.status = 'in_progress'
          patch.called_at = new Date().toISOString()
        }
        await supabase.from('opd_queue').update(patch).eq('id', existingRow.id)
      } else {
        // OPD-2 fix (June 2026): race-safe token allocation, mirrors
        // the first site above. See that site's comment for the full
        // rationale.
        const MAX_TOKEN_RETRIES = 5
        let success = false
        for (let attempt = 0; attempt < MAX_TOKEN_RETRIES; attempt++) {
          const { data: maxRow } = await supabase
            .from('opd_queue')
            .select('token_number')
            .eq('queue_date', todayDate)
            .order('token_number', { ascending: false })
            .limit(1)
            .maybeSingle()
          const nextToken = ((maxRow?.token_number as number) || 0) + 1
          const { error: insErr } = await supabase.from('opd_queue').insert({
            patient_id: patientId,
            queue_date: todayDate,
            token_number: nextToken,
            status: 'in_progress',
            priority: 'normal',
            notes: 'Auto-created from direct consultation',
            called_at: new Date().toISOString(),
            encounter_id: enc.id,
          })
          if (!insErr) { success = true; break }
          const code = String((insErr as any)?.code || '')
          const msg = String((insErr as any)?.message || '').toLowerCase()
          if (code === '23505' || msg.includes('duplicate') || msg.includes('unique')) {
            await new Promise(r => setTimeout(r, 10 + Math.floor(Math.random() * 40)))
            continue
          }
          throw insErr
        }
        if (!success) {
          console.warn('[OPD] queue token allocation gave up after retries (non-fatal)')
        }
      }
    } catch (queueErr) {
      // non-fatal: encounter save succeeded; queue sync can be retried by reception
      console.warn('[OPD] queue sync failed (non-fatal):', queueErr)
    }

    // Clear draft after successful save
    if (patientId) { try { sessionStorage.removeItem(`opd_draft_${patientId}`) } catch { } }
    router.push(`/opd/${enc.id}/prescription`)
  }

  // ── Input class helper ────────────────────────────────────────
  function vc(k: keyof Vitals) { return vHL[k] ? 'input ocr-filled' : 'input' }
  function oc(k: keyof OBData) { return (obHL as any)[k] ? 'input ocr-filled' : 'input' }
  function cc(k: keyof ConsultHL) { return (cHL as any)[k] ? 'input ocr-filled' : 'input' }

  // MicBtn removed — use SmartMic from @/components/shared/SmartMic instead

  if (!patient) {
    return (
      <AppShell>
        <div className="p-6 flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </AppShell>
    )
  }

  // ══════════════════════════════════════════════════════════════════
  // FEE GATE — Collect consultation/registration fee before consultation
  // Shows when patient doesn't have a bill for today yet.
  // ══════════════════════════════════════════════════════════════════
  if (feeGateStatus === 'required' && patient) {
    return (
      <AppShell>
        <div className="p-6 max-w-lg mx-auto mt-8">
          {/* Patient info banner */}
          <div className="mb-4 flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
              <span className="text-lg font-bold text-blue-700">{patient.full_name.charAt(0)}</span>
            </div>
            <div>
              <div className="font-semibold text-blue-800 text-sm">{patient.full_name}</div>
              <div className="text-xs text-blue-600">
                MRN: <span className="font-mono font-bold">{patient.mrn}</span>
                {patient.age && <span className="ml-2">{patient.age}y</span>}
                {patient.gender && <span className="ml-1">· {patient.gender}</span>}
              </div>
            </div>
          </div>

          {/* Fee Collector */}
          <ConsultationFeeCollector
            patientId={patient.id}
            patientName={patient.full_name}
            mrn={patient.mrn || ''}
            isNewCase={isNewCaseForFee}
            contextLabel="Collect fee before starting OPD consultation"
            onPaymentComplete={(billId, invoiceNumber, amount, method) => {
              // Mark fee as collected in session to avoid re-showing
              const sessionKey = `fee_collected_${patientId}_${getIndiaToday()}`
              try { sessionStorage.setItem(sessionKey, 'true') } catch {}
              setFeeGateStatus('paid')
            }}
            onSkip={(billId, invoiceNumber) => {
              // Mark as skipped — allow consultation to proceed
              const sessionKey = `fee_collected_${patientId}_${getIndiaToday()}`
              try { sessionStorage.setItem(sessionKey, 'skipped') } catch {}
              setFeeGateStatus('skipped')
            }}
            onCancel={() => {
              // Go back to patient profile
              router.push(`/patients/${patientId}`)
            }}
            showCancel={true}
          />
        </div>
      </AppShell>
    )
  }

  // Show loading while checking fee status
  if (feeGateStatus === 'checking' && patient) {
    return (
      <AppShell>
        <div className="p-6 flex items-center justify-center h-64">
          <div className="text-center">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-gray-500">Checking payment status...</p>
          </div>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div className="p-6 max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-4 mb-5">
          <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-700">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-gray-900">New OPD Consultation</h1>
            <p className="text-sm text-gray-500">
              <strong className="text-blue-700">{patient.full_name}</strong>
              <span className="text-gray-400"> · {patient.mrn} · {patient.age}y · {patient.gender}</span>
            </p>
          </div>
          <div className="flex gap-2 items-center">
            <AutoSaveIndicator status={draftStatus} className="mr-2" />
            <Link href={`/patients/${patient.id}`} className="btn-secondary text-xs">Cancel</Link>
            {tab === 'prescription' ? (
              <button onClick={handleSaveAll} disabled={saving}
                className="btn-primary flex items-center gap-2 disabled:opacity-60">
                {saving
                  ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <CheckCircle className="w-4 h-4" />}
                Save All & Bill
              </button>
            ) : (
              <button onClick={handleSave} disabled={saving}
                className="btn-primary flex items-center gap-2 disabled:opacity-60">
                {saving
                  ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <Save className="w-4 h-4" />}
                Save & Continue to Prescription
              </button>
            )}
          </div>
        </div>

        {/* Error — sticky toast at bottom of screen */}
        <Toast message={error} type="error" onDismiss={() => setError('')} />
        {visitedToday && (
          <div className="mb-4 bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            Patient already has an OPD consultation today. You can still create a NEW consultation (allowed).
          </div>
        )}


        {/* ══ UNIFIED SMART DOCUMENT SCANNER ══════════════════════ */}
        <div className="mb-5 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-sm font-bold text-blue-800 flex items-center gap-2">
                📷 Upload Medical Document
              </p>
              <p className="text-xs text-blue-500 mt-0.5">
                Upload any photo — handwritten doctor note, printed OPD form, ANC card, or prescription.
                AI automatically detects the type and fills the correct fields.
              </p>
            </div>
            <label className={`flex-shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold cursor-pointer transition-all
              ${noteOcrLoading ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'}`}>
              {noteOcrLoading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Reading…</>
                : <><Camera className="w-4 h-4" /> Upload Photo</>}
              <input
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp"
                onChange={handleNotePhoto}
                disabled={noteOcrLoading}
                className="hidden"
              />
            </label>
          </div>

          {/* Error */}
          {noteOcrError && (
            <div className="mt-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2 text-xs text-red-700">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span className="flex-1">{noteOcrError}</span>
              <button onClick={() => setNoteOcrError('')}><X className="w-3.5 h-3.5" /></button>
            </div>
          )}

          {/* Applied success */}
          {noteApplied && (
            <div className="mt-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-xs text-green-800 flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
              ✅ Document processed! Fields highlighted in yellow were auto-filled — please review before saving.
            </div>
          )}

          {/* Preview panel — shown before applying */}
          {noteOcrPreview && !noteApplied && (
            <div className="mt-3 bg-white border border-blue-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold text-blue-800 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  AI Extracted — review before applying
                  <span className="font-normal text-blue-500 ml-1">
                    ({Math.round((noteOcrPreview.confidence || 0) * 100)}% confidence
                    {noteOcrPreview.formType && noteOcrPreview.formType !== 'unknown' && (
                      <> · Detected: {
                        noteOcrPreview.formType === 'ob_exam' ? '🩺 OB/GYN Form' :
                          noteOcrPreview.formType === 'vitals' ? '💉 Vitals Form' :
                            noteOcrPreview.formType === 'encounter' ? '📋 Consultation Note' :
                              noteOcrPreview.formType
                      }</>
                    )})
                  </span>
                </p>
                <button onClick={() => setNoteOcrPreview(null)} className="text-blue-300 hover:text-blue-600">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs mb-3">
                {Object.entries(noteOcrPreview.fields || {}).map(([k, v]: any) => {
                  if (!v || typeof v === 'object') return null
                  return (
                    <div key={k} className="flex gap-1.5">
                      <span className="text-blue-400 capitalize min-w-[110px] font-medium">{k.replace(/_/g, ' ')}:</span>
                      <span className="text-blue-900 font-semibold">{String(v)}</span>
                    </div>
                  )
                })}
                {Array.isArray(noteOcrPreview.fields?.medicines) && noteOcrPreview.fields.medicines.length > 0 && (
                  <div className="col-span-2">
                    <span className="text-blue-400 font-medium">Medications:</span>
                    <ul className="mt-0.5 space-y-0.5 pl-2">
                      {noteOcrPreview.fields.medicines.map((m: any, i: number) => (
                        <li key={i} className="text-blue-900">• {m.name} {m.dose || ''} {m.frequency || ''} {m.days ? `× ${m.days}` : ''}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { handleDoctorNote(noteOcrPreview); setNoteOcrPreview(null) }}
                  className="btn-primary text-xs flex items-center gap-1.5 py-1.5">
                  <Sparkles className="w-3.5 h-3.5" /> Apply to Form
                </button>
                <button onClick={() => setNoteOcrPreview(null)} className="btn-secondary text-xs py-1.5">
                  Discard
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Medications queued from doctor note */}
        {noteMedsQueue && (
          <div className="mb-5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3">
            <span className="text-base flex-shrink-0">💊</span>
            <div className="flex-1">
              <p className="text-xs font-bold text-amber-700 mb-1">Medications from doctor note — add these in the Prescription step:</p>
              <pre className="text-xs text-amber-800 font-mono whitespace-pre-wrap">{noteMedsQueue}</pre>
            </div>
            <button onClick={() => setNoteMedsQueue('')} className="text-amber-400 hover:text-amber-700 flex-shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Tab Bar */}
        <div className="flex border-b border-gray-200 mb-5 bg-white rounded-t-xl overflow-hidden shadow-sm">
          {([
            { id: 'vitals' as Tab, label: 'Vitals & Complaints' },
            { id: 'consultation' as Tab, label: 'Consultation & Diagnosis' },
            { id: 'obgyn' as Tab, label: 'Gynecology / OB Exam' },
            { id: 'prescription' as Tab, label: '💊 Prescription' },
          ]).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex-1 py-3 text-sm font-medium transition-colors border-b-2
                ${tab === t.id
                  ? 'border-blue-600 text-blue-700 bg-blue-50'
                  : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ════════════════════════════════════════════════════════
            TAB 1 — VITALS
        ════════════════════════════════════════════════════════ */}
        {tab === 'vitals' && (
          <div className="space-y-5">
            <div className="card p-5">
              <h2 className="section-title">Vital Signs</h2>
              <div className="grid grid-cols-3 gap-4">
                <VitalCard label="Pulse" unit="bpm" placeholder="72"
                  color="red" value={vitals.pulse}
                  highlighted={!!vHL.pulse}
                  onChange={v => setV('pulse', v)} />

                {/* BP — two inputs */}
                <div>
                  <label className="label">Blood Pressure</label>
                  <div className="flex items-center gap-2">
                    <input className={`input text-center ${vHL.bp_systolic ? 'ocr-filled' : ''}`}
                      placeholder="120" maxLength={3}
                      value={vitals.bp_systolic}
                      onChange={e => setV('bp_systolic', e.target.value.replace(/\D/g, ''))} />
                    <span className="text-gray-400 font-bold">/</span>
                    <input className={`input text-center ${vHL.bp_diastolic ? 'ocr-filled' : ''}`}
                      placeholder="80" maxLength={3}
                      value={vitals.bp_diastolic}
                      onChange={e => setV('bp_diastolic', e.target.value.replace(/\D/g, ''))} />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">mmHg (systolic / diastolic)</p>
                </div>

                <VitalCard label="Temperature" unit="°C" placeholder="37.0"
                  color="orange" value={vitals.temperature}
                  highlighted={!!vHL.temperature}
                  onChange={v => setV('temperature', v)} />
                <VitalCard label="SpO₂" unit="%" placeholder="98"
                  color="blue" value={vitals.spo2}
                  highlighted={!!vHL.spo2}
                  onChange={v => setV('spo2', v)} />
                <VitalCard label="Weight" unit="kg" placeholder="60.0"
                  color="green" value={vitals.weight}
                  highlighted={!!vHL.weight}
                  onChange={v => setV('weight', v)} />
                <VitalCard label="Height" unit="cm" placeholder="160"
                  color="purple" value={vitals.height}
                  highlighted={!!vHL.height}
                  onChange={v => setV('height', v)} />
              </div>

              {bmi && (
                <div className="mt-4 inline-flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2">
                  <span className="text-xs text-gray-500 font-semibold">BMI:</span>
                  <span className={`font-bold text-sm
                    ${parseFloat(bmi) < 18.5 ? 'text-blue-600'
                      : parseFloat(bmi) < 25 ? 'text-green-600'
                        : parseFloat(bmi) < 30 ? 'text-yellow-600'
                          : 'text-red-600'}`}>
                    {bmi} kg/m²
                  </span>
                  <span className="text-xs text-gray-400">
                    {parseFloat(bmi) < 18.5 ? '(Underweight)'
                      : parseFloat(bmi) < 25 ? '(Normal)'
                        : parseFloat(bmi) < 30 ? '(Overweight)'
                          : '(Obese)'}
                  </span>
                </div>
              )}
            </div>

            {/* Chief Complaint */}
            <div className="card p-5">
              <h2 className="section-title">Chief Complaint</h2>
              <div className="flex items-center justify-between mb-1">
                <label className="label">Chief Complaint *</label>
                <SmartMic field="cc" value={chiefComplaint} onChange={setChiefComplaint} context="Chief Complaint" />
              </div>
              <textarea className={`${cHL.chiefComplaint ? 'input ocr-filled' : 'input'} resize-none`}
                rows={3}
                placeholder="e.g. Lower abdominal pain for 3 days, irregular periods..."
                value={chiefComplaint}
                onChange={e => setChiefComplaint(e.target.value)} />
            </div>

            <div className="flex justify-end">
              <button onClick={() => setTab('consultation')} className="btn-primary flex items-center gap-2">
                Next: Consultation <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════
            TAB 2 — CONSULTATION
        ════════════════════════════════════════════════════════ */}
        {tab === 'consultation' && (
          <div className="space-y-5">
            <div className="card p-5">
              <h2 className="section-title">Consultation Notes</h2>
              <div className="space-y-4">

                {/* HPI */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="label">History of Present Illness</label>
                    <SmartMic field="hpi" value={hpi} onChange={setHpi} context="History of Present Illness" />
                  </div>
                  <textarea className="input resize-none" rows={3}
                    placeholder="Onset, duration, character, associated symptoms..."
                    value={hpi} onChange={e => setHpi(e.target.value)} />
                </div>

                {/* Diagnosis */}
                <div>
                  <label className="label">Diagnosis / Impression</label>
                  <input className={cHL.diagnosis ? 'input ocr-filled' : 'input'}
                    placeholder="e.g. Polycystic Ovarian Syndrome (PCOS)"
                    value={diagnosis} onChange={e => setDiagnosis(e.target.value)} />
                </div>

                {/* Clinical Notes */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="label">Clinical Notes</label>
                    <SmartMic field="notes" value={notes} onChange={setNotes} context="Clinical Notes" />
                  </div>
                  <textarea className={`${cHL.notes ? 'input ocr-filled' : 'input'} resize-none`}
                    rows={4}
                    placeholder="Examination findings, assessment, plan..."
                    value={notes} onChange={e => setNotes(e.target.value)} />
                </div>

              </div>
            </div>

            {/* ── Procedure Log ── */}
            <div className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="section-title mb-0">🔪 Procedures Performed</h2>
                <button
                  type="button"
                  onClick={() => setProcedures(prev => [...prev, { name: '', indication: '', findings: '', complications: '', surgeon: getHospitalSettings().doctorName, anaesthesia: '', notes: '' }])}
                  className="text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg"
                >
                  + Add Procedure
                </button>
              </div>

              {procedures.length === 0 ? (
                <p className="text-xs text-gray-400 italic">No procedures recorded. Click "Add Procedure" if a procedure was performed during this visit.</p>
              ) : (
                <div className="space-y-4">
                  {procedures.map((proc, idx) => (
                    <div key={idx} className="border border-gray-200 rounded-lg p-4 bg-gray-50 relative">
                      <button
                        type="button"
                        onClick={() => setProcedures(prev => prev.filter((_, i) => i !== idx))}
                        className="absolute top-2 right-2 text-red-400 hover:text-red-600 text-xs"
                        title="Remove procedure"
                      >✕</button>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="col-span-2">
                          <label className="label">Procedure Name *</label>
                          <select
                            className="input"
                            value={proc.name}
                            onChange={e => {
                              const val = e.target.value
                              setProcedures(prev => prev.map((p, i) => i === idx ? { ...p, name: val } : p))
                            }}
                          >
                            <option value="">Select procedure...</option>
                            {[
                              'D&C (Dilatation & Curettage)',
                              'Colposcopy',
                              'Cervical Biopsy',
                              'LEEP / LLETZ',
                              'Hysteroscopy',
                              'IUD Insertion',
                              'IUD Removal',
                              'MVA (Manual Vacuum Aspiration)',
                              'Endometrial Biopsy',
                              'Bartholin Cyst I&D',
                              'Cervical Cerclage',
                              'Amniocentesis',
                              'ECV (External Cephalic Version)',
                              'Episiotomy Repair',
                              'Perineal Tear Repair',
                              'Normal Vaginal Delivery',
                              'Assisted Vaginal Delivery',
                              'Caesarean Section (LSCS)',
                              'Tubal Ligation',
                              'Laparoscopy (Diagnostic)',
                              'Laparoscopy (Operative)',
                              'Hysterectomy',
                              'Ovarian Cystectomy',
                              'Pap Smear',
                              'Other',
                            ].map(p => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="label">Indication</label>
                          <input className="input" placeholder="Why was this done?"
                            value={proc.indication || ''}
                            onChange={e => setProcedures(prev => prev.map((p, i) => i === idx ? { ...p, indication: e.target.value } : p))} />
                        </div>
                        <div>
                          <label className="label">Anaesthesia</label>
                          <select className="input"
                            value={proc.anaesthesia || ''}
                            onChange={e => setProcedures(prev => prev.map((p, i) => i === idx ? { ...p, anaesthesia: e.target.value } : p))}>
                            <option value="">Select</option>
                            {['None', 'Local', 'Spinal', 'Epidural', 'General', 'IV Sedation'].map(a => <option key={a}>{a}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="label">Surgeon / Performed By</label>
                          <input className="input" placeholder="Doctor name"
                            value={proc.surgeon || ''}
                            onChange={e => setProcedures(prev => prev.map((p, i) => i === idx ? { ...p, surgeon: e.target.value } : p))} />
                        </div>
                        <div>
                          <label className="label">Complications</label>
                          <input className="input" placeholder="None / describe"
                            value={proc.complications || ''}
                            onChange={e => setProcedures(prev => prev.map((p, i) => i === idx ? { ...p, complications: e.target.value } : p))} />
                        </div>
                        <div className="col-span-2">
                          <label className="label">Findings</label>
                          <textarea className="input resize-none" rows={2} placeholder="Procedure findings..."
                            value={proc.findings || ''}
                            onChange={e => setProcedures(prev => prev.map((p, i) => i === idx ? { ...p, findings: e.target.value } : p))} />
                        </div>
                        <div className="col-span-2">
                          <label className="label">Additional Notes</label>
                          <textarea className="input resize-none" rows={2} placeholder="Post-procedure instructions, follow-up..."
                            value={proc.notes || ''}
                            onChange={e => setProcedures(prev => prev.map((p, i) => i === idx ? { ...p, notes: e.target.value } : p))} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-between">
              <button onClick={() => setTab('vitals')} className="btn-secondary flex items-center gap-2">
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <button onClick={() => setTab('obgyn')} className="btn-primary flex items-center gap-2">
                Next: OB/GYN <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════
            TAB 3 — OB/GYN
        ════════════════════════════════════════════════════════ */}
        {tab === 'obgyn' && (
          <div className="space-y-5">

            {/* ── MENSTRUAL HISTORY (NEW) ──────────────────────── */}
            <div className="card p-5">
              <h2 className="section-title">Menstrual History</h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <label className="label">Cycle Regularity</label>
                  <select className="input bg-white"
                    value={ob.menstrual_regularity || ''}
                    onChange={e => setO('menstrual_regularity', e.target.value)}>
                    <option value="">Select</option>
                    <option>Regular</option>
                    <option>Irregular</option>
                  </select>
                </div>
                <div>
                  <label className="label">Flow</label>
                  <select className="input bg-white"
                    value={ob.menstrual_flow || ''}
                    onChange={e => setO('menstrual_flow', e.target.value)}>
                    <option value="">Select</option>
                    <option>Scanty</option>
                    <option>Normal</option>
                    <option>Heavy</option>
                  </select>
                </div>
                <div>
                  <label className="label">Post-Menstrual Spotting (days)</label>
                  <input className="input" type="number" min="0" max="30"
                    placeholder="e.g. 2"
                    value={ob.post_menstrual_days || ''}
                    onChange={e => setO('post_menstrual_days', e.target.value)} />
                </div>
                <div>
                  <label className="label">Post-Menstrual Pain</label>
                  <select className="input bg-white"
                    value={ob.post_menstrual_pain || ''}
                    onChange={e => setO('post_menstrual_pain', e.target.value)}>
                    <option value="">None / Not reported</option>
                    <option>Mild</option>
                    <option>Moderate</option>
                    <option>Severe</option>
                  </select>
                </div>
                <div className="col-span-2 sm:col-span-4">
                  <label className="label">Urine Pregnancy Test Result (~3 months)</label>
                  <input className="input"
                    placeholder="e.g. Positive, Negative, Not done"
                    value={ob.urine_pregnancy_result || ''}
                    onChange={e => setO('urine_pregnancy_result', e.target.value)} />
                </div>
              </div>
            </div>

            {/* A — Obstetric History */}
            <div className="card p-5">
              <h2 className="section-title">A. Obstetric History</h2>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="label">LMP</label>
                  <input className={oc('lmp')} type="date"
                    max={getIndiaToday()}
                    value={ob.lmp || ''} onChange={e => setO('lmp', e.target.value)} />
                </div>
                <div>
                  <label className="label">EDD (auto-calculated)</label>
                  <input className="input bg-blue-50 font-semibold text-blue-700" readOnly
                    value={edd || 'Enter LMP to calculate'} />
                </div>
                <div>
                  <label className="label">Gestational Age (auto)</label>
                  <input className="input bg-blue-50 font-semibold text-blue-700" readOnly
                    value={ga || 'Enter LMP to calculate'} />
                </div>
                {(['gravida', 'para', 'abortion', 'living'] as (keyof OBData)[]).map(k => (
                  <div key={k}>
                    <label className="label capitalize">{k}</label>
                    <input className={oc(k)} type="number" min="0" placeholder="0"
                      value={(ob as any)[k] ?? ''}
                      onChange={e => {
                        const val = parseInt(e.target.value) || 0
                        setO(k, val)
                        // ── Auto-sync abortion entries when count changes ──
                        if (k === 'abortion') {
                          const current = ob.abortion_entries || []
                          if (val > current.length) {
                            // Add blank entries to match count
                            const toAdd = Array.from({ length: val - current.length }, () => ({
                              type: '' as AbortionEntry['type'],
                              weeks: '',
                              method: '' as AbortionEntry['method'],
                              years_ago: '',
                            }))
                            setO('abortion_entries', [...current, ...toAdd])
                          } else if (val < current.length) {
                            // Trim extra entries
                            setO('abortion_entries', current.slice(0, val))
                          }
                        }
                      }} />
                  </div>
                ))}
              </div>

              {/* ── Abortion Details — inline, auto-shown when abortion > 0 ── */}
              {(ob.abortion ?? 0) > 0 && (
                <div className="mt-4 border border-orange-200 rounded-xl bg-orange-50/40 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-orange-800 flex items-center gap-2">
                      📋 Abortion Details
                      <span className="text-xs font-normal text-orange-600">
                        — {ob.abortion} {(ob.abortion ?? 0) === 1 ? 'entry' : 'entries'} (fill details below)
                      </span>
                    </h3>
                    {/* Allow manual add if count doesn't match */}
                    {(ob.abortion_entries || []).length < (ob.abortion ?? 0) && (
                      <button type="button"
                        className="text-xs btn-secondary py-1 px-3"
                        onClick={() => setO('abortion_entries', [
                          ...(ob.abortion_entries || []),
                          { type: '', weeks: '', method: '', years_ago: '' } as AbortionEntry,
                        ])}>
                        + Add Entry
                      </button>
                    )}
                  </div>

                  {/* Column headers */}
                  <div className="hidden sm:grid grid-cols-4 gap-3 text-xs font-semibold text-orange-700 uppercase tracking-wide mb-2 px-1">
                    <span>1. Type</span>
                    <span>2. Duration (weeks)</span>
                    <span>3. Method</span>
                    <span>4. Year</span>
                  </div>

                  <div className="space-y-2">
                    {(ob.abortion_entries || []).map((entry, idx) => (
                      <div key={idx}
                        className="grid grid-cols-4 gap-3 items-end border border-orange-200 rounded-lg px-3 py-3 bg-white relative">

                        {/* Remove button */}
                        <button type="button"
                          className="absolute top-1.5 right-2 text-red-400 hover:text-red-600 text-xs font-bold leading-none"
                          title="Remove this entry"
                          onClick={() => {
                            const updated = (ob.abortion_entries || []).filter((_, i) => i !== idx)
                            setO('abortion_entries', updated)
                            setO('abortion', updated.length)
                          }}>✕</button>

                        {/* Abortion number label */}
                        <div className="absolute -left-3 -top-2 w-5 h-5 bg-orange-500 text-white rounded-full text-[10px] flex items-center justify-center font-bold">
                          {idx + 1}
                        </div>

                        {/* 1. Type — Spontaneous or Induced */}
                        <div>
                          <label className="label text-xs text-orange-700">Type</label>
                          <select className="input bg-white text-sm"
                            value={entry.type || ''}
                            onChange={e => {
                              const updated = [...(ob.abortion_entries || [])]
                              updated[idx] = { ...updated[idx], type: e.target.value as AbortionEntry['type'] }
                              setO('abortion_entries', updated)
                            }}>
                            <option value="">Select type…</option>
                            <option value="Spontaneous">Spontaneous</option>
                            <option value="Induced">Induced</option>
                          </select>
                        </div>

                        {/* 2. Duration in weeks */}
                        <div>
                          <label className="label text-xs text-orange-700">Duration (weeks)</label>
                          <input className="input text-sm" type="number" min="4" max="28"
                            placeholder="e.g. 8"
                            value={entry.weeks || ''}
                            onChange={e => {
                              const updated = [...(ob.abortion_entries || [])]
                              updated[idx] = { ...updated[idx], weeks: e.target.value }
                              setO('abortion_entries', updated)
                            }} />
                          <p className="text-[10px] text-gray-400 mt-0.5">gestation at time of abortion</p>
                        </div>

                        {/* 3. Method — MTP Kit, D&C, etc. */}
                        <div>
                          <label className="label text-xs text-orange-700">Method</label>
                          <select className="input bg-white text-sm"
                            value={entry.method || ''}
                            onChange={e => {
                              const updated = [...(ob.abortion_entries || [])]
                              updated[idx] = { ...updated[idx], method: e.target.value as AbortionEntry['method'] }
                              setO('abortion_entries', updated)
                            }}>
                            <option value="">Select method…</option>
                            <option value="MTP Kit">MTP Kit</option>
                            <option value="D&C">D&amp;C (Dilation &amp; Curettage)</option>
                            <option value="Suction Evacuation">Suction Evacuation (MVA)</option>
                            <option value="Natural">Natural / Expectant</option>
                            <option value="Surgical">Surgical (Other)</option>
                          </select>
                        </div>

                        {/* 4. Year */}
                        <div>
                          <label className="label text-xs text-orange-700">Year</label>
                          <input className="input text-sm" type="number"
                            min="1970" max={new Date().getFullYear()}
                            placeholder={`e.g. ${new Date().getFullYear() - 2}`}
                            value={entry.years_ago || ''}
                            onChange={e => {
                              const updated = [...(ob.abortion_entries || [])]
                              updated[idx] = { ...updated[idx], years_ago: e.target.value }
                              setO('abortion_entries', updated)
                            }} />
                          <p className="text-[10px] text-gray-400 mt-0.5">year it occurred</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Per-pregnancy details table (NEW) ── */}
              <div className="mt-5">
                <div className="flex items-center justify-between mb-3">
                  <label className="label mb-0 text-gray-700">Pregnancy-wise Details</label>
                  <button type="button"
                    className="text-xs btn-secondary py-1 px-3"
                    onClick={() => {
                      const current = ob.obstetric_history || []
                      setO('obstetric_history', [
                        ...current,
                        { pregnancy_no: current.length + 1, type: '', delivery_mode: '', outcome: '', baby_gender: '', age_of_child: '' } as ObstetricEntry,
                      ])
                    }}>
                    + Add Row
                  </button>
                </div>

                {(!ob.obstetric_history || ob.obstetric_history.length === 0) ? (
                  <p className="text-xs text-gray-400 italic">Click "+ Add Row" to enter details of each past pregnancy.</p>
                ) : (
                  <>
                    {/* Column headers */}
                    <div className="hidden sm:grid grid-cols-7 gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 px-1">
                      <span>#</span>
                      <span>Type</span>
                      <span>Mode</span>
                      <span>Outcome</span>
                      <span>Gender</span>
                      <span>Child Age</span>
                      <span></span>
                    </div>
                    {(ob.obstetric_history || []).map((entry, idx) => (
                      <div key={idx}
                        className="grid grid-cols-7 gap-2 items-center border border-gray-200 rounded-lg px-3 py-2 mb-2 bg-gray-50 text-sm">
                        <span className="font-semibold text-gray-600 text-xs">{ordinal(idx + 1)}</span>
                        <select className="input text-xs bg-white col-span-1"
                          value={entry.type || ''}
                          onChange={e => {
                            const updated = [...(ob.obstetric_history || [])]
                            updated[idx] = { ...updated[idx], type: e.target.value as ObstetricEntry['type'] }
                            setO('obstetric_history', updated)
                          }}>
                          <option value="">—</option>
                          <option>Full Term</option>
                          <option>Preterm</option>
                        </select>
                        <select className="input text-xs bg-white col-span-1"
                          value={entry.delivery_mode || ''}
                          onChange={e => {
                            const updated = [...(ob.obstetric_history || [])]
                            updated[idx] = { ...updated[idx], delivery_mode: e.target.value as ObstetricEntry['delivery_mode'] }
                            setO('obstetric_history', updated)
                          }}>
                          <option value="">—</option>
                          <option>Normal</option>
                          <option>CS</option>
                        </select>
                        <select className="input text-xs bg-white col-span-1"
                          value={entry.outcome || ''}
                          onChange={e => {
                            const updated = [...(ob.obstetric_history || [])]
                            updated[idx] = { ...updated[idx], outcome: e.target.value as ObstetricEntry['outcome'] }
                            setO('obstetric_history', updated)
                          }}>
                          <option value="">—</option>
                          <option>Live</option>
                          <option>Expired</option>
                        </select>
                        <select className="input text-xs bg-white col-span-1"
                          value={entry.baby_gender || ''}
                          onChange={e => {
                            const updated = [...(ob.obstetric_history || [])]
                            updated[idx] = { ...updated[idx], baby_gender: e.target.value as ObstetricEntry['baby_gender'] }
                            setO('obstetric_history', updated)
                          }}>
                          <option value="">—</option>
                          <option value="M">Male</option>
                          <option value="F">Female</option>
                        </select>
                        <input className="input text-xs col-span-1"
                          placeholder="e.g. 3 yrs"
                          value={entry.age_of_child || ''}
                          onChange={e => {
                            const updated = [...(ob.obstetric_history || [])]
                            updated[idx] = { ...updated[idx], age_of_child: e.target.value }
                            setO('obstetric_history', updated)
                          }} />
                        <button type="button"
                          onClick={() => {
                            const updated = (ob.obstetric_history || []).filter((_, i) => i !== idx)
                            setO('obstetric_history', updated)
                          }}
                          className="text-red-400 hover:text-red-600 text-center text-xs font-bold">
                          ✕
                        </button>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>

            {/* B — ANC */}
            <div className="card p-5">
              <h2 className="section-title">B. Antenatal Examination</h2>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="label">FHS (bpm)</label>
                  <input className={oc('fhs')} type="number" min="50" max="200" placeholder="140"
                    value={ob.fhs ?? ''} onChange={e => setO('fhs', parseInt(e.target.value) || undefined)} />
                </div>
                <div>
                  <label className="label">Liquor</label>
                  <select className={oc('liquor')} value={ob.liquor || ''} onChange={e => setO('liquor', e.target.value)}>
                    <option value="">Select</option>
                    {['Normal', 'Reduced', 'Increased', 'Absent', 'Not assessed'].map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Fundal Height (cm)</label>
                  <input className={oc('fundal_height')} type="number" placeholder="30"
                    value={ob.fundal_height ?? ''} onChange={e => setO('fundal_height', parseFloat(e.target.value) || undefined)} />
                </div>
                <div>
                  <label className="label">Presentation</label>
                  <select className={oc('presentation')} value={ob.presentation || ''} onChange={e => setO('presentation', e.target.value)}>
                    <option value="">Select</option>
                    {['Cephalic', 'Breech', 'Transverse', 'Oblique', 'Not assessed'].map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Engagement</label>
                  <select className={oc('engagement')} value={ob.engagement || ''} onChange={e => setO('engagement', e.target.value)}>
                    <option value="">Select</option>
                    {['Engaged', 'Not engaged', '2/5', '3/5', '4/5', '5/5'].map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* C — Per Abdomen */}
            <div className="card p-5">
              <h2 className="section-title">C. Per Abdomen</h2>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="label">Uterus Size</label>
                  <select className={oc('uterus_size')} value={ob.uterus_size || ''} onChange={e => setO('uterus_size', e.target.value)}>
                    <option value="">Select</option>
                    {['Not gravid', '6 wks', '8 wks', '10 wks', '12 wks', '16 wks', '20 wks', '24 wks', '28 wks', '32 wks', '36 wks', '40 wks'].map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Scar Tenderness</label>
                  <select className={oc('scar_tenderness')} value={ob.scar_tenderness || ''} onChange={e => setO('scar_tenderness', e.target.value)}>
                    <option value="">Select</option>
                    {['Present', 'Absent', 'Not applicable'].map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Fetal Movement</label>
                  <select className={oc('fetal_movement')} value={ob.fetal_movement || ''} onChange={e => setO('fetal_movement', e.target.value)}>
                    <option value="">Select</option>
                    {['Present', 'Reduced', 'Absent', 'Not assessed'].map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>

                {/* ── Clinical Risk Fields ── */}
                <div>
                  <label className="label">Previous CS</label>
                  <select className={oc('previous_cs')} value={ob.previous_cs ?? ''} onChange={e => setO('previous_cs', e.target.value ? Number(e.target.value) : undefined)}>
                    <option value="">None</option>
                    {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n} previous CS</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Multiple Pregnancy</label>
                  <select className={oc('multiple_pregnancy')} value={ob.multiple_pregnancy ? 'yes' : ''} onChange={e => setO('multiple_pregnancy', e.target.value === 'yes')}>
                    <option value="">Singleton</option>
                    <option value="yes">Twins / Multiple</option>
                  </select>
                </div>
                <div>
                  <label className="label">Gestational Diabetes</label>
                  <select className={oc('gestational_diabetes')} value={ob.gestational_diabetes ? 'yes' : ''} onChange={e => setO('gestational_diabetes', e.target.value === 'yes')}>
                    <option value="">No</option>
                    <option value="yes">Yes — GDM</option>
                  </select>
                </div>
                <div>
                  <label className="label">Haemoglobin (g/dL)</label>
                  <input type="number" step="0.1" min="3" max="20" className={oc('haemoglobin')}
                    placeholder="e.g. 10.5"
                    value={ob.haemoglobin ?? ''} onChange={e => setO('haemoglobin', e.target.value ? Number(e.target.value) : undefined)} />
                </div>
                <div>
                  <label className="label">Fasting Blood Sugar (mg/dL)</label>
                  <input type="number" min="30" max="500" className={oc('blood_sugar_fasting')}
                    placeholder="e.g. 92"
                    value={ob.blood_sugar_fasting ?? ''} onChange={e => setO('blood_sugar_fasting', e.target.value ? Number(e.target.value) : undefined)} />
                </div>
                <div>
                  <label className="label">PP Blood Sugar (mg/dL)</label>
                  <input type="number" min="30" max="500" className={oc('blood_sugar_pp')}
                    placeholder="e.g. 130"
                    value={ob.blood_sugar_pp ?? ''} onChange={e => setO('blood_sugar_pp', e.target.value ? Number(e.target.value) : undefined)} />
                </div>

                <div className="col-span-3">
                  <div className="flex items-center justify-between mb-1">
                    <label className="label">Per Abdomen Findings</label>
                    <SmartMic field="per_abdomen" value={ob.per_abdomen || ''} onChange={v => setO('per_abdomen', v)} context="Per Abdomen findings" />
                  </div>
                  <textarea className={`${oc('per_abdomen')} resize-none`} rows={2}
                    placeholder="Free text..." value={ob.per_abdomen || ''} onChange={e => setO('per_abdomen', e.target.value)} />
                </div>
              </div>
            </div>

            {/* D — Per Speculum */}
            <div className="card p-5">
              <h2 className="section-title">D. Per Speculum</h2>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="label">Cervix</label>
                  <select className={oc('cervix_speculum')} value={ob.cervix_speculum || ''} onChange={e => setO('cervix_speculum', e.target.value)}>
                    <option value="">Select</option>
                    {['Healthy', 'Congested', 'Erosion', 'Growth', 'Not examined'].map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Discharge</label>
                  <input className={oc('discharge_speculum')} placeholder="e.g. white, scanty"
                    value={ob.discharge_speculum || ''} onChange={e => setO('discharge_speculum', e.target.value)} />
                </div>
                <div>
                  <label className="label">Bleeding</label>
                  <select className={oc('bleeding_speculum')} value={ob.bleeding_speculum || ''} onChange={e => setO('bleeding_speculum', e.target.value)}>
                    <option value="">Select</option>
                    {['Present', 'Absent', 'Not examined'].map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div className="col-span-3">
                  <div className="flex items-center justify-between mb-1">
                    <label className="label">Per Speculum Findings</label>
                    <SmartMic field="per_speculum" value={ob.per_speculum || ''} onChange={v => setO('per_speculum', v)} context="Per Speculum findings" />
                  </div>
                  <textarea className={`${oc('per_speculum')} resize-none`} rows={2}
                    placeholder="Additional findings..." value={ob.per_speculum || ''} onChange={e => setO('per_speculum', e.target.value)} />
                </div>
              </div>
            </div>

            {/* E — Per Vaginum */}
            <div className="card p-5">
              <h2 className="section-title">E. Per Vaginum (PV)</h2>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="label">Cervix Feel</label>
                  <select className={oc('cervix_pv')} value={ob.cervix_pv || ''} onChange={e => setO('cervix_pv', e.target.value)}>
                    <option value="">Select</option>
                    {['Firm', 'Soft', 'Not examined'].map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Os</label>
                  <select className={oc('os_pv')} value={ob.os_pv || ''} onChange={e => setO('os_pv', e.target.value)}>
                    <option value="">Select</option>
                    {['Closed', 'Fingertip', '1 cm', '2 cm', '3 cm', '4 cm', 'Fully dilated', 'Not examined'].map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Uterus Position</label>
                  <select className={oc('uterus_position')} value={ob.uterus_position || ''} onChange={e => setO('uterus_position', e.target.value)}>
                    <option value="">Select</option>
                    {['Anteverted', 'Retroverted', 'Mid-position', 'Not examined'].map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div className="col-span-3">
                  <div className="flex items-center justify-between mb-1">
                    <label className="label">PV Findings / Adnexa</label>
                    <SmartMic field="per_vaginum" value={ob.per_vaginum || ''} onChange={v => setO('per_vaginum', v)} context="Per Vaginum PV findings" />
                  </div>
                  <textarea className={`${oc('per_vaginum')} resize-none`} rows={2}
                    placeholder="Adnexa, fornices, masses..." value={ob.per_vaginum || ''} onChange={e => setO('per_vaginum', e.target.value)} />
                </div>
              </div>
            </div>

            {/* F — Ovary */}
            <div className="card p-5">
              <h2 className="section-title">F. Ovary Findings</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Right Ovary</label>
                  <textarea className={`${oc('right_ovary')} resize-none`} rows={2}
                    placeholder="Size, texture, cysts..." value={ob.right_ovary || ''} onChange={e => setO('right_ovary', e.target.value)} />
                </div>
                <div>
                  <label className="label">Left Ovary</label>
                  <textarea className={`${oc('left_ovary')} resize-none`} rows={2}
                    placeholder="Size, texture, cysts..." value={ob.left_ovary || ''} onChange={e => setO('left_ovary', e.target.value)} />
                </div>
              </div>
            </div>

            {/* G — USG / Ultrasound Report */}
            <div className="card p-5">
              <h2 className="section-title">G. USG / Ultrasound Report</h2>
              <p className="text-xs text-gray-400 mb-3">Enter structured USG findings. These are tracked across visits for trend analysis.</p>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="label">USG Date</label>
                  <input type="date" className={oc('usg_date')}
                    value={ob.usg_date || ''} onChange={e => setO('usg_date', e.target.value)} />
                </div>
                <div>
                  <label className="label">GA at USG</label>
                  <input className={oc('usg_ga')} placeholder="e.g. 28w3d"
                    value={ob.usg_ga || ''} onChange={e => setO('usg_ga', e.target.value)} />
                </div>
                <div>
                  <label className="label">EFW (grams)</label>
                  <input type="number" min="100" max="6000" className={oc('efw')}
                    placeholder="e.g. 1200"
                    value={ob.efw ?? ''} onChange={e => setO('efw', e.target.value ? Number(e.target.value) : undefined)} />
                </div>
                <div>
                  <label className="label">BPD (mm)</label>
                  <input type="number" min="10" max="120" className={oc('bpd')}
                    placeholder="e.g. 72"
                    value={ob.bpd ?? ''} onChange={e => setO('bpd', e.target.value ? Number(e.target.value) : undefined)} />
                </div>
                <div>
                  <label className="label">HC (mm)</label>
                  <input type="number" min="50" max="400" className={oc('hc')}
                    placeholder="e.g. 260"
                    value={ob.hc ?? ''} onChange={e => setO('hc', e.target.value ? Number(e.target.value) : undefined)} />
                </div>
                <div>
                  <label className="label">AC (mm)</label>
                  <input type="number" min="50" max="400" className={oc('ac')}
                    placeholder="e.g. 240"
                    value={ob.ac ?? ''} onChange={e => setO('ac', e.target.value ? Number(e.target.value) : undefined)} />
                </div>
                <div>
                  <label className="label">FL (mm)</label>
                  <input type="number" min="10" max="90" className={oc('fl')}
                    placeholder="e.g. 52"
                    value={ob.fl ?? ''} onChange={e => setO('fl', e.target.value ? Number(e.target.value) : undefined)} />
                </div>
                <div>
                  <label className="label">AFI (cm)</label>
                  <input type="number" step="0.1" min="0" max="40" className={oc('afi')}
                    placeholder="e.g. 12.5"
                    value={ob.afi ?? ''} onChange={e => setO('afi', e.target.value ? Number(e.target.value) : undefined)} />
                </div>
                <div>
                  <label className="label">Placenta Position</label>
                  <select className={oc('placenta')} value={ob.placenta || ''} onChange={e => setO('placenta', e.target.value)}>
                    <option value="">Select</option>
                    {['Anterior', 'Posterior', 'Fundal', 'Lateral', 'Low-lying', 'Previa'].map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Placenta Grade</label>
                  <select className={oc('placenta_grade')} value={ob.placenta_grade || ''} onChange={e => setO('placenta_grade', e.target.value)}>
                    <option value="">Select</option>
                    {['Grade 0', 'Grade I', 'Grade II', 'Grade III'].map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Cord Loops</label>
                  <select className={oc('cord_loops')} value={ob.cord_loops || ''} onChange={e => setO('cord_loops', e.target.value)}>
                    <option value="">None</option>
                    {['1 loop around neck', '2 loops around neck', 'Body loop', 'Multiple loops'].map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div className="col-span-3">
                  <label className="label">USG Remarks / Additional Findings</label>
                  <textarea className={`${oc('usg_remarks')} resize-none`} rows={2}
                    placeholder="e.g. Single live intrauterine fetus, cephalic, adequate liquor..."
                    value={ob.usg_remarks || ''} onChange={e => setO('usg_remarks', e.target.value)} />
                </div>
              </div>
            </div>

            {/* ── PAST MEDICAL & SURGICAL HISTORY (NEW) ──────────── */}
            <div className="card p-5">
              <h2 className="section-title">Past Medical & Surgical History</h2>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="label mb-3">Conditions (tick all that apply)</label>
                  <div className="flex flex-col gap-3 mt-1">
                    {(
                      [
                        { key: 'past_diabetes', label: 'Diabetic' },
                        { key: 'past_hypertension', label: 'Hypertension / BP' },
                        { key: 'past_thyroid', label: 'Thyroid Disorder' },
                      ] as Array<{ key: keyof OBData; label: string }>
                    ).map(({ key, label }) => (
                      <label key={key} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={!!(ob as any)[key]}
                          onChange={e => setO(key, e.target.checked)}
                          className="w-4 h-4 rounded accent-blue-600"
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="flex items-center gap-2 text-sm font-semibold cursor-pointer select-none mb-2">
                    <input
                      type="checkbox"
                      checked={!!ob.past_surgery}
                      onChange={e => setO('past_surgery', e.target.checked)}
                      className="w-4 h-4 rounded accent-blue-600"
                    />
                    Previous Surgery
                  </label>
                  {ob.past_surgery && (
                    <textarea
                      className="input resize-none mt-1"
                      rows={3}
                      placeholder="Describe: type of surgery, year, hospital..."
                      value={ob.past_surgery_detail || ''}
                      onChange={e => setO('past_surgery_detail', e.target.value)}
                    />
                  )}
                  {!ob.past_surgery && (
                    <p className="text-xs text-gray-400 mt-1 italic">Tick the checkbox above to add surgery details.</p>
                  )}
                </div>
              </div>
            </div>

            {/* ── SOCIOECONOMIC / CA DATA (NEW) ──────────────────── */}
            <div className="card p-5">
              <h2 className="section-title">Socioeconomic Information</h2>
              <p className="text-xs text-gray-400 mb-4">
                Optional — used for BPL / subsidy / insurance eligibility assessment.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Monthly Income (₹)</label>
                  <input className="input" type="number" min="0"
                    placeholder="e.g. 8000"
                    value={ob.income || ''}
                    onChange={e => setO('income', e.target.value)} />
                </div>
                <div>
                  <label className="label">Monthly Expenditure (₹)</label>
                  <input className="input" type="number" min="0"
                    placeholder="e.g. 6000"
                    value={ob.expenditure || ''}
                    onChange={e => setO('expenditure', e.target.value)} />
                </div>
              </div>
            </div>

            {/* OCR highlight note */}
            {Object.values(obHL).some(Boolean) && (
              <div className="flex items-center gap-2 text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2">
                <ScanLine className="w-3.5 h-3.5 flex-shrink-0" />
                Yellow fields were filled from the scanned form. Please verify before saving.
              </div>
            )}

            <div className="flex justify-between">
              <button onClick={() => setTab('consultation')} className="btn-secondary flex items-center gap-2">
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <button onClick={() => setTab('prescription')} className="btn-primary flex items-center gap-2">
                Next: Prescription <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

      </div>

      {/* ════════════════════════════════════════════════════════
          TAB 4 — PRESCRIPTION (Combined on same page)
      ════════════════════════════════════════════════════════ */}
      {tab === 'prescription' && (
        <div className="p-6 max-w-5xl mx-auto space-y-5">

          {/* Medications */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="section-title mb-0">Medications</h2>
              <button onClick={addRxMed} className="btn-secondary text-xs flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" /> Add Medicine
              </button>
            </div>

            <div className="space-y-3">
              {rxMeds.map((med, idx) => (
                <div key={idx} className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <div className="grid grid-cols-12 gap-3">
                    <div className="col-span-4 relative">
                      <label className="label">Medicine Name</label>
                      <input className="input bg-white" placeholder="e.g. Folic Acid 5mg"
                        value={med.drug}
                        onChange={e => handleRxDrugInput(idx, e.target.value)}
                        onBlur={() => setTimeout(() => setRxDrugSuggestion(null), 200)}
                      />
                      {rxDrugSuggestion?.idx === idx && rxDrugSuggestion.list.length > 0 && (
                        <div className="absolute top-full left-0 right-0 z-30 bg-white border border-gray-200 rounded-lg shadow-lg mt-1">
                          {rxDrugSuggestion.list.map(d => (
                            <button key={d} type="button"
                              onMouseDown={() => { updateRxMed(idx, 'drug', d); setRxDrugSuggestion(null) }}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b border-gray-50 last:border-0">
                              {d}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="col-span-2">
                      <label className="label">Dose</label>
                      <input className="input bg-white" placeholder="500mg"
                        value={med.dose} onChange={e => updateRxMed(idx, 'dose', e.target.value)} />
                    </div>
                    <div className="col-span-2">
                      <label className="label">Route</label>
                      <select className="input bg-white" value={med.route}
                        onChange={e => updateRxMed(idx, 'route', e.target.value)}>
                        {RX_ROUTES.map(r => <option key={r}>{r}</option>)}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className="label">Frequency</label>
                      <select className="input bg-white" value={med.frequency}
                        onChange={e => updateRxMed(idx, 'frequency', e.target.value)}>
                        {RX_FREQS.map(f => <option key={f}>{f}</option>)}
                      </select>
                    </div>
                    <div className="col-span-1">
                      <label className="label">Duration</label>
                      <input className="input bg-white" placeholder="7 days"
                        value={med.duration} onChange={e => updateRxMed(idx, 'duration', e.target.value)} />
                    </div>
                    <div className="col-span-1 flex items-end">
                      <button type="button" onClick={() => removeRxMed(idx)}
                        className="w-full p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
                        <Trash2 className="w-4 h-4 mx-auto" />
                      </button>
                    </div>
                    <div className="col-span-11">
                      <label className="label">Instructions</label>
                      <input className="input bg-white" placeholder="e.g. Take after food"
                        value={med.instructions ?? ''}
                        onChange={e => updateRxMed(idx, 'instructions', e.target.value)} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Advice & Follow-up */}
          <div className="card p-5">
            <h2 className="section-title">Advice & Follow-up</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label flex items-center gap-2">
                  Specific Advice
                  <SmartMic field="rx_advice" value={rxAdvice} onChange={setRxAdvice} context="Patient advice and instructions" size="sm" />
                </label>
                <textarea className="input resize-none" rows={3}
                  placeholder="Rest, avoid intercourse, etc."
                  value={rxAdvice} onChange={e => setRxAdvice(e.target.value)} />
              </div>
              <div>
                <label className="label flex items-center gap-2">
                  Dietary Advice
                  <SmartMic field="rx_dietary" value={rxDietaryAdvice} onChange={setRxDietaryAdvice} context="Dietary advice and nutrition" size="sm" />
                </label>
                <textarea className="input resize-none" rows={3}
                  placeholder="High protein diet, iron-rich foods..."
                  value={rxDietaryAdvice} onChange={e => setRxDietaryAdvice(e.target.value)} />
              </div>

              <div className="col-span-2">
                <label className="label">Reports / Investigations Needed</label>
                <div className="flex gap-2 mb-2 flex-wrap">
                  <select className="input flex-1 text-sm py-1.5"
                    onChange={e => {
                      const val = e.target.value
                      if (!val) return
                      setRxReportsNeeded(prev => {
                        const existing = prev.trim()
                        if (existing.includes(val)) return prev
                        return existing ? existing + ',\n' + val : val
                      })
                      e.target.value = ''
                    }}>
                    <option value="">+ Add from common list...</option>
                    {RX_REPORT_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <textarea className="input resize-none font-mono text-sm" rows={3}
                  placeholder="Selected investigations appear here. You can also type freely."
                  value={rxReportsNeeded} onChange={e => setRxReportsNeeded(e.target.value)} />
              </div>

              <div>
                <label className="label">Follow-up Date</label>
                <input className="input" type="date" min={minFollowUpDate()}
                  value={rxFollowUpDate}
                  onChange={e => {
                    const val = e.target.value
                    if (!val) { setRxFollowUpDate(''); return }
                    if (isSunday(val)) {
                      const d = new Date(val); d.setDate(d.getDate() + 1)
                      setRxFollowUpDate(d.toISOString().split('T')[0])
                    } else {
                      setRxFollowUpDate(val)
                    }
                  }} />
                {rxFollowUpDate && (
                  <div className="flex items-center gap-2 mt-2">
                    <label className="text-xs text-gray-500">Time:</label>
                    <input className="input py-1 px-2 text-sm w-28" type="time"
                      value={rxFollowUpTime} onChange={e => setRxFollowUpTime(e.target.value || '10:00')} />
                  </div>
                )}
                <div className="flex gap-2 mt-2">
                  {[{ l: '+1 week', d: 7 }, { l: '+2 weeks', d: 14 }, { l: '+1 month', d: 30 }, { l: '+3 months', d: 90 }].map(({ l, d }) => (
                    <button key={l} type="button"
                      onClick={() => {
                        const dt = new Date(); dt.setDate(dt.getDate() + d)
                        if (dt.getDay() === 0) dt.setDate(dt.getDate() + 1)
                        setRxFollowUpDate(dt.toISOString().split('T')[0])
                      }}
                      className="text-xs bg-blue-50 text-blue-600 hover:bg-blue-100 px-2 py-1 rounded border border-blue-100">
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Save All button */}
          <div className="flex justify-between items-center">
            <button onClick={() => setTab('obgyn')} className="btn-secondary flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" /> Back to OB/GYN
            </button>
            <div className="flex gap-3">
              <button onClick={handleSave} disabled={saving}
                className="btn-secondary flex items-center gap-2 text-xs disabled:opacity-60">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Encounter Only (Old Flow)
              </button>
              <button onClick={handleSaveAll} disabled={saving}
                className="btn-primary flex items-center gap-2 px-6 disabled:opacity-60">
                {saving
                  ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <CheckCircle className="w-4 h-4" />}
                Save All & Generate Bill
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ BILLING PROMPT — Shows after combined save ═══ */}
      {showBillingPrompt && patient && savedEncounterId && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="bg-white border-2 border-green-300 shadow-2xl rounded-2xl px-6 py-4 flex items-center gap-4 max-w-lg">
            <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <CheckCircle className="w-5 h-5 text-green-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-900">Consultation & Prescription saved!</p>
              <p className="text-xs text-gray-500">Generate bill for {patient.full_name}?</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Link
                href={`/billing?patientId=${patient.id}&patientName=${encodeURIComponent(patient.full_name ?? 'Patient')}&mrn=${patient.mrn ?? ''}&encounterType=OPD&view=new`}
                className="flex items-center gap-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-colors shadow-sm">
                💳 Bill Now
              </Link>
              <Link
                href={`/opd/${savedEncounterId}/prescription`}
                className="text-xs text-blue-600 hover:text-blue-800 px-2 py-2 font-medium">
                View/Print Rx
              </Link>
              <button onClick={() => setShowBillingPrompt(false)}
                className="text-xs text-gray-400 hover:text-gray-600 px-2 py-2">
                Later
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clinical Safety Modal */}
      {rxShowSafetyModal && rxSafetyAlerts.length > 0 && (
        <ClinicalSafetyModal
          alerts={rxSafetyAlerts}
          onAcknowledge={handleRxSafetyAcknowledge}
          onCancel={() => setRxShowSafetyModal(false)}
          patientName={patient?.full_name}
        />
      )}

      {/* Files & Photos — scoped to patient (no encounterId yet, available after save) */}
      {patientId && (
        <div className="mt-4 mx-4 mb-6">
          <ConsultationAttachments
            patientId={patientId}
            compact={false}
          />
        </div>
      )}

    </AppShell>
  )
}

// Bug #9 fix: Suspense wrapper so useSearchParams() doesn't cause hydration warning
export default function NewConsultationPage() {
  return (
    <Suspense fallback={
      <AppShell>
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </AppShell>
    }>
      <NewConsultationContent />
    </Suspense>
  )
}


// ── Reusable Vital input card ─────────────────────────────────
function VitalCard({
  label, unit, placeholder, color, value, highlighted, onChange,
}: {
  label: string; unit: string; placeholder: string
  color: string; highlighted: boolean; value: string
  onChange: (v: string) => void
}) {
  const ring: Record<string, string> = {
    red: 'focus:ring-red-400',
    orange: 'focus:ring-orange-400',
    blue: 'focus:ring-blue-400',
    green: 'focus:ring-green-400',
    purple: 'focus:ring-purple-400',
  }
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="number" step="any" placeholder={placeholder}
          className={`input ${ring[color] || ''} ${highlighted ? 'ocr-filled' : ''}`}
          value={value}
          onChange={e => onChange(e.target.value)}
        />
        <span className="text-xs text-gray-400 whitespace-nowrap">{unit}</span>
      </div>
    </div>
  )
}