import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

// ── Small helpers ─────────────────────────────────────────────
function fmtDate(d?: string | null): string {
  if (!d) return '—'
  try {
    return new Date(d).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'long', year: 'numeric',
    })
  } catch { return d }
}

function inr(n?: number | null): string {
  if (!n) return '₹0'
  return '₹' + Number(n).toLocaleString('en-IN')
}

function esc(s?: string | null): string {
  if (!s) return ''
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// ── Build full printable HTML bundle ─────────────────────────
function buildHTML(
  patient:       any,
  encounters:    any[],
  prescriptions: any[],
  bills:         any[],
  discharges:    any[],
  attachments:   any[],
): string {
  const hs = {
    name:    process.env.HOSPITAL_NAME    || 'NexMedicon Hospital',
    address: process.env.HOSPITAL_ADDRESS || '',
    phone:   process.env.HOSPITAL_PHONE   || '',
    regNo:   process.env.HOSPITAL_REG_NO  || '',
    gstin:   process.env.HOSPITAL_GSTIN   || '',
    doctor:  process.env.DOCTOR_NAME      || '',
    qual:    process.env.DOCTOR_QUAL      || '',
    reg:     process.env.DOCTOR_REG       || '',
  }

  const now = new Date().toLocaleDateString('en-IN', {
    day: '2-digit', month: 'long', year: 'numeric',
  })

  const paidBills  = bills.filter((b: any) => b.status === 'paid')
  const totalPaid  = paidBills.reduce((s: number, b: any) => s + (Number(b.net_amount) || 0), 0)

  // ── shared CSS ───────────────────────────────────────────────
  const css = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #111827; background: #f3f4f6; }

.page {
  background: #fff; width: 210mm; min-height: 297mm;
  margin: 24px auto; padding: 20mm 18mm;
  box-shadow: 0 2px 12px rgba(0,0,0,.1); page-break-after: always;
}
@media print {
  body { background: #fff; }
  .page { margin: 0; padding: 15mm 14mm; box-shadow: none; }
  .no-print { display: none !important; }
}

/* letterhead */
.lh { text-align: center; border-bottom: 2.5px solid #1e3a5f; padding-bottom: 10px; margin-bottom: 18px; }
.lh-name { font-size: 19px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: #1e3a5f; }
.lh-sub  { font-size: 11px; color: #6b7280; margin-top: 2px; }

/* page running header */
.ph { display:flex; justify-content:space-between; font-size:10px; color:#9ca3af;
      border-bottom:1px solid #e5e7eb; padding-bottom:5px; margin-bottom:14px; }

/* titles */
.doc-title    { font-size:17px; font-weight:700; color:#1e3a5f; text-align:center;
                margin-bottom:4px; text-transform:uppercase; letter-spacing:.5px; }
.doc-subtitle { font-size:11px; color:#6b7280; text-align:center; margin-bottom:18px; }

/* info table */
.it { width:100%; border-collapse:collapse; margin-bottom:14px; }
.it td { padding:5px 8px; vertical-align:top; font-size:12px; border-bottom:1px solid #f3f4f6; }
.it .lbl { color:#6b7280; width:36%; font-weight:600; font-size:11px;
           text-transform:uppercase; letter-spacing:.3px; }
.mono { font-family:monospace; }

/* section header */
.sh { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.4px;
      color:#374151; background:#f9fafb; border-left:3px solid #1e3a5f;
      padding:4px 8px; margin:13px 0 7px; }

/* text block */
.tb { white-space:pre-wrap; font-size:12px; color:#374151; line-height:1.6; padding:4px 0; }

/* data table */
.dt { width:100%; border-collapse:collapse; font-size:11px; margin-bottom:12px; }
.dt th { background:#1e3a5f; color:#fff; padding:6px 8px; text-align:left;
         font-size:10px; text-transform:uppercase; letter-spacing:.3px; }
.dt td { padding:5px 8px; border-bottom:1px solid #f0f0f0; vertical-align:top; }
.dt tr:nth-child(even) td { background:#f9fafb; }
.dt .tr { background:#eff6ff!important; font-weight:700; border-top:2px solid #1e3a5f; }

/* declaration */
.decl { border:1.5px solid #d1d5db; border-radius:6px; padding:14px;
        margin:18px 0; background:#f9fafb; }
.decl-title { font-weight:700; font-size:12px; margin-bottom:8px; color:#1e3a5f; }
.decl p { font-size:12px; line-height:1.7; color:#374151; }

/* signature */
.sig { margin-top:28px; text-align:right; }
.sig-line { border-top:1.5px solid #374151; width:200px; margin-left:auto; margin-bottom:6px; }
.sig-name { font-weight:700; font-size:13px; }
.sig-sub  { font-size:11px; color:#6b7280; margin-top:2px; }

/* inline sig (prescriptions) */
.sig2 { margin-top:20px; text-align:right; font-size:11px; color:#374151; }
.sig2-line { border-top:1px solid #9ca3af; width:160px; margin-left:auto; margin-bottom:4px; }

/* receipt block */
.rb { border:1px solid #e5e7eb; border-radius:6px; padding:12px; margin-bottom:12px; }
.rb-head { font-size:12px; font-weight:700; color:#1e3a5f; margin-bottom:8px;
           display:flex; justify-content:space-between; }
.rb-ref  { font-family:monospace; font-size:11px; color:#9ca3af; }
.rb-foot { font-size:11px; color:#6b7280; margin-top:8px; padding-top:6px; border-top:1px solid #f0f0f0; }

/* badges */
.by { background:#d1fae5; color:#065f46; padding:2px 8px; border-radius:999px; font-size:11px; font-weight:600; }
.bn { background:#f3f4f6; color:#6b7280; padding:2px 8px; border-radius:999px; font-size:11px; }

/* print bar */
.pbar {
  position:fixed; top:0; left:0; right:0; z-index:9999;
  background:#1e3a5f; color:#fff; padding:10px 20px;
  display:flex; align-items:center; justify-content:space-between;
  font-family:'Segoe UI',Arial,sans-serif; font-size:13px;
  box-shadow:0 2px 8px rgba(0,0,0,.3);
}
.pbar strong { font-size:14px; }
.pbar-sub { font-size:11px; color:#93c5fd; margin-top:2px; }
.pbtn {
  background:#22c55e; color:#fff; border:none; cursor:pointer;
  padding:8px 22px; border-radius:6px; font-size:13px; font-weight:700;
}
.pbtn:hover { background:#16a34a; }
`

  // ── Cover page ────────────────────────────────────────────────
  const cover = `
<div class="page">
  <div class="lh">
    <div class="lh-name">${esc(hs.name)}</div>
    ${hs.address ? `<div class="lh-sub">${esc(hs.address)}</div>` : ''}
    ${hs.phone   ? `<div class="lh-sub">Tel: ${esc(hs.phone)}</div>` : ''}
    ${(hs.regNo || hs.gstin)
      ? `<div class="lh-sub">${hs.regNo ? 'Reg: ' + esc(hs.regNo) : ''}${hs.regNo && hs.gstin ? ' · ' : ''}${hs.gstin ? 'GSTIN: ' + esc(hs.gstin) : ''}</div>`
      : ''}
  </div>

  <div class="doc-title">Medical Insurance Document Bundle</div>
  <div class="doc-subtitle">Generated on ${now}</div>

  <div class="sh">Patient Details</div>
  <table class="it">
    <tr><td class="lbl">Patient Name</td><td><strong>${esc(patient.full_name)}</strong></td></tr>
    <tr><td class="lbl">MRN</td><td class="mono">${esc(patient.mrn)}</td></tr>
    <tr><td class="lbl">Date of Birth</td><td>${fmtDate(patient.date_of_birth)}${patient.age ? ` (${patient.age} yrs)` : ''}</td></tr>
    <tr><td class="lbl">Gender</td><td>${esc(patient.gender) || '—'}</td></tr>
    <tr><td class="lbl">Blood Group</td><td>${esc(patient.blood_group) || '—'}</td></tr>
    <tr><td class="lbl">Mobile</td><td class="mono">${esc(patient.mobile)}</td></tr>
    ${patient.aadhaar_no ? `<tr><td class="lbl">Aadhaar No</td><td class="mono">${esc(patient.aadhaar_no)}</td></tr>` : ''}
    ${patient.abha_id    ? `<tr><td class="lbl">ABHA ID</td><td class="mono">${esc(patient.abha_id)}</td></tr>` : ''}
    ${patient.address    ? `<tr><td class="lbl">Address</td><td>${esc(patient.address)}</td></tr>` : ''}
  </table>

  <div class="sh">Insurance / Policy Details</div>
  <table class="it">
    <tr><td class="lbl">Mediclaim</td><td>${patient.mediclaim ? '<span class="by">Yes — Mediclaim Patient</span>' : '<span class="bn">No</span>'}</td></tr>
    <tr><td class="lbl">Claim Type</td><td>${patient.cashless ? '<span class="by">Cashless</span>' : 'Reimbursement'}</td></tr>
    ${patient.policy_tpa_name ? `<tr><td class="lbl">Insurance / TPA</td><td><strong>${esc(patient.policy_tpa_name)}</strong></td></tr>` : ''}
    ${patient.policy_number   ? `<tr><td class="lbl">Policy Number</td><td class="mono">${esc(patient.policy_number)}</td></tr>` : ''}
  </table>

  <div class="sh">Documents Enclosed</div>
  <table class="it">
    <tr><td class="lbl">Discharge Summaries</td><td>${discharges.length ? `${discharges.length} document(s)` : '<em style="color:#9ca3af">None on record</em>'}</td></tr>
    <tr><td class="lbl">Prescriptions</td><td>${prescriptions.length ? `${prescriptions.length} prescription(s)` : '<em style="color:#9ca3af">None on record</em>'}</td></tr>
    <tr><td class="lbl">Payment Receipts</td><td>${paidBills.length ? `${paidBills.length} receipt(s) — Total ${inr(totalPaid)}` : '<em style="color:#9ca3af">None on record</em>'}</td></tr>
    <tr><td class="lbl">Consultation Notes</td><td>${encounters.length ? `${encounters.length} visit(s)` : '<em style="color:#9ca3af">None on record</em>'}</td></tr>
    <tr><td class="lbl">Uploaded Files</td><td>${attachments.length ? `${attachments.length} file(s) listed` : '<em style="color:#9ca3af">None uploaded</em>'}</td></tr>
  </table>

  <div class="decl">
    <div class="decl-title">Doctor&apos;s Declaration</div>
    <p>
      I, <strong>${esc(hs.doctor || 'Doctor')}</strong>${hs.qual ? ` (${esc(hs.qual)})` : ''},
      hereby certify that the clinical documents compiled in this bundle are true and accurate
      records from the medical files of <strong>${esc(patient.full_name)}</strong>
      (MRN: <span class="mono">${esc(patient.mrn)}</span>).
      These documents are issued for the purpose of medical insurance claim processing and
      are attested to the best of my knowledge and belief.
    </p>
  </div>

  <div class="sig">
    <div class="sig-line"></div>
    <div class="sig-name">${esc(hs.doctor || 'Doctor')}</div>
    ${hs.qual ? `<div class="sig-sub">${esc(hs.qual)}</div>` : ''}
    ${hs.reg  ? `<div class="sig-sub">Reg. No: ${esc(hs.reg)}</div>` : ''}
    <div class="sig-sub">${esc(hs.name)}</div>
    <div class="sig-sub">Date: ${now}</div>
  </div>
</div>`

  // ── Discharge summaries ───────────────────────────────────────
  const dischargPages = discharges.map((ds: any, i: number) => `
<div class="page">
  <div class="ph"><span>${esc(hs.name)}</span><span>Discharge Summary${discharges.length > 1 ? ` (${i + 1}/${discharges.length})` : ''}</span></div>
  <div class="doc-title">Discharge Summary</div>

  <table class="it">
    <tr><td class="lbl">Patient</td><td>${esc(patient.full_name)} — <span class="mono">${esc(patient.mrn)}</span></td></tr>
    ${ds.admission_date  ? `<tr><td class="lbl">Admission</td><td>${fmtDate(ds.admission_date)}</td></tr>` : ''}
    ${ds.discharge_date  ? `<tr><td class="lbl">Discharge</td><td>${fmtDate(ds.discharge_date)}</td></tr>` : ''}
    ${ds.final_diagnosis ? `<tr><td class="lbl">Final Diagnosis</td><td><strong>${esc(ds.final_diagnosis)}</strong></td></tr>` : ''}
    ${ds.secondary_diagnosis ? `<tr><td class="lbl">Secondary Dx</td><td>${esc(ds.secondary_diagnosis)}</td></tr>` : ''}
    ${ds.condition_at_discharge ? `<tr><td class="lbl">Condition at Discharge</td><td>${esc(ds.condition_at_discharge)}</td></tr>` : ''}
    ${ds.signed_by ? `<tr><td class="lbl">Signed By</td><td>${esc(ds.signed_by)}</td></tr>` : ''}
    <tr><td class="lbl">Status</td><td>${ds.is_final ? '<span class="by">Finalised</span>' : 'Draft'}</td></tr>
  </table>

  ${ds.clinical_summary    ? `<div class="sh">Clinical Summary</div><div class="tb">${esc(ds.clinical_summary)}</div>` : ''}
  ${ds.investigations      ? `<div class="sh">Investigations</div><div class="tb">${esc(ds.investigations)}</div>` : ''}
  ${ds.treatment_given     ? `<div class="sh">Treatment Given</div><div class="tb">${esc(ds.treatment_given)}</div>` : ''}
  ${ds.discharge_advice    ? `<div class="sh">Discharge Advice</div><div class="tb">${esc(ds.discharge_advice)}</div>` : ''}
  ${ds.medications_at_discharge ? `<div class="sh">Medications at Discharge</div><div class="tb">${esc(ds.medications_at_discharge)}</div>` : ''}
  ${ds.follow_up_date      ? `<div class="sh">Follow-up</div><div class="tb">${fmtDate(ds.follow_up_date)}${ds.follow_up_note ? ' — ' + esc(ds.follow_up_note) : ''}</div>` : ''}
  ${ds.complications       ? `<div class="sh">Complications</div><div class="tb">${esc(ds.complications)}</div>` : ''}

  ${(ds.delivery_type || ds.baby_weight) ? `
  <div class="sh">Delivery Details</div>
  <table class="it">
    ${ds.delivery_type ? `<tr><td class="lbl">Delivery Type</td><td>${esc(ds.delivery_type)}</td></tr>` : ''}
    ${ds.delivery_date ? `<tr><td class="lbl">Delivery Date</td><td>${fmtDate(ds.delivery_date)}</td></tr>` : ''}
    ${ds.baby_sex      ? `<tr><td class="lbl">Baby Gender</td><td>${esc(ds.baby_sex)}</td></tr>` : ''}
    ${ds.baby_weight   ? `<tr><td class="lbl">Birth Weight</td><td>${esc(ds.baby_weight)} kg</td></tr>` : ''}
    ${ds.apgar_score   ? `<tr><td class="lbl">APGAR Score</td><td>${esc(ds.apgar_score)}</td></tr>` : ''}
  </table>` : ''}
</div>`).join('')

  // ── Prescriptions ─────────────────────────────────────────────
  const rxPages = prescriptions.map((rx: any, i: number) => {
    const meds = Array.isArray(rx.medications) ? rx.medications : []
    const rows = meds.map((m: any, j: number) => `
<tr>
  <td>${j + 1}</td>
  <td><strong>${esc(m.drug)}</strong></td>
  <td>${esc(m.dose)}</td>
  <td>${esc(m.route)}</td>
  <td>${esc(m.frequency)}</td>
  <td>${esc(m.duration)}</td>
</tr>`).join('')

    return `
<div class="page">
  <div class="ph"><span>${esc(hs.name)}</span><span>Prescription${prescriptions.length > 1 ? ` (${i + 1}/${prescriptions.length})` : ''}</span></div>
  <div class="doc-title">Prescription</div>

  <table class="it">
    <tr><td class="lbl">Patient</td><td>${esc(patient.full_name)} — <span class="mono">${esc(patient.mrn)}</span></td></tr>
    <tr><td class="lbl">Date</td><td>${fmtDate(rx.created_at)}</td></tr>
    ${rx.follow_up_date ? `<tr><td class="lbl">Follow-up</td><td>${fmtDate(rx.follow_up_date)}</td></tr>` : ''}
  </table>

  ${meds.length ? `
  <div class="sh">Medications</div>
  <table class="dt">
    <thead><tr><th>#</th><th>Drug</th><th>Dose</th><th>Route</th><th>Frequency</th><th>Duration</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>` : ''}

  ${rx.reports_needed ? `<div class="sh">Investigations Required</div><div class="tb">${esc(rx.reports_needed)}</div>` : ''}
  ${rx.advice         ? `<div class="sh">Advice</div><div class="tb">${esc(rx.advice)}</div>` : ''}
  ${rx.dietary_advice ? `<div class="sh">Dietary Advice</div><div class="tb">${esc(rx.dietary_advice)}</div>` : ''}

  <div class="sig2">
    <div class="sig2-line"></div>
    <div>${esc(hs.doctor)}${hs.qual ? ` (${esc(hs.qual)})` : ''}</div>
  </div>
</div>`
  }).join('')

  // ── Bills / receipts ──────────────────────────────────────────
  const billsPage = paidBills.length ? `
<div class="page">
  <div class="ph"><span>${esc(hs.name)}</span><span>Payment Receipts</span></div>
  <div class="doc-title">Payment Receipts</div>

  <table class="it">
    <tr><td class="lbl">Patient</td><td>${esc(patient.full_name)} — <span class="mono">${esc(patient.mrn)}</span></td></tr>
    <tr><td class="lbl">Total Paid</td><td><strong>${inr(totalPaid)}</strong></td></tr>
    <tr><td class="lbl">Number of Receipts</td><td>${paidBills.length}</td></tr>
  </table>

  ${paidBills.map((bill: any, i: number) => {
    const items = Array.isArray(bill.items) ? bill.items : []
    return `
  <div class="rb">
    <div class="rb-head">
      <span>Receipt ${i + 1} — ${fmtDate(bill.created_at)}</span>
      <span class="rb-ref"># ${(bill.id || '').slice(-8).toUpperCase()}</span>
    </div>
    <table class="dt">
      <thead><tr><th>#</th><th>Description</th><th style="text-align:right">Amount</th></tr></thead>
      <tbody>
        ${items.map((item: any, j: number) => `<tr><td>${j + 1}</td><td>${esc(item.label)}</td><td style="text-align:right;font-family:monospace">${inr(item.amount)}</td></tr>`).join('')}
        ${Number(bill.discount) > 0 ? `<tr><td colspan="2" style="text-align:right;color:#6b7280">Discount</td><td style="text-align:right;color:#6b7280;font-family:monospace">− ${inr(bill.discount)}</td></tr>` : ''}
        <tr class="tr"><td colspan="2"><strong>Net Amount Paid</strong></td><td style="text-align:right;font-family:monospace"><strong>${inr(bill.net_amount)}</strong></td></tr>
      </tbody>
    </table>
    <div class="rb-foot">Mode: <strong style="text-transform:capitalize">${esc(bill.payment_mode) || '—'}</strong>${bill.razorpay_payment_id ? ` &nbsp;·&nbsp; Ref: <span class="mono">${esc(bill.razorpay_payment_id)}</span>` : ''}</div>
  </div>`
  }).join('')}
</div>` : ''

  // ── Consultation history ──────────────────────────────────────
  const consultPage = encounters.length ? `
<div class="page">
  <div class="ph"><span>${esc(hs.name)}</span><span>Consultation History</span></div>
  <div class="doc-title">Consultation History</div>

  <table class="it">
    <tr><td class="lbl">Patient</td><td>${esc(patient.full_name)} — <span class="mono">${esc(patient.mrn)}</span></td></tr>
    <tr><td class="lbl">Total Visits</td><td>${encounters.length}</td></tr>
  </table>

  <table class="dt" style="margin-top:14px">
    <thead>
      <tr><th>Date</th><th>Type</th><th>Chief Complaint</th><th>Diagnosis</th><th>BP</th><th>Wt</th></tr>
    </thead>
    <tbody>
      ${encounters.map((enc: any) => `
      <tr>
        <td style="white-space:nowrap">${fmtDate(enc.encounter_date)}</td>
        <td>${esc(enc.encounter_type)}</td>
        <td>${esc(enc.chief_complaint) || '—'}</td>
        <td><strong>${esc(enc.diagnosis) || '—'}</strong></td>
        <td>${enc.bp_systolic ? `${enc.bp_systolic}/${enc.bp_diastolic}` : '—'}</td>
        <td>${enc.weight ? enc.weight + ' kg' : '—'}</td>
      </tr>`).join('')}
    </tbody>
  </table>
</div>` : ''

  // ── Uploaded files list ───────────────────────────────────────
  const filesPage = attachments.length ? `
<div class="page">
  <div class="ph"><span>${esc(hs.name)}</span><span>Uploaded Medical Files</span></div>
  <div class="doc-title">Uploaded Medical Files</div>
  <p style="color:#6b7280;font-size:12px;margin-bottom:12px">
    The files below are stored in the hospital system. Request physical copies from the hospital for submission to the insurer.
  </p>
  <table class="dt">
    <thead><tr><th>#</th><th>File Name</th><th>Type</th><th>Date</th><th>Notes</th></tr></thead>
    <tbody>
      ${attachments.map((a: any, i: number) => `
      <tr>
        <td>${i + 1}</td>
        <td>${esc(a.file_name)}</td>
        <td>${esc(a.file_type || '').replace('image/', '').replace('application/', '').toUpperCase()}</td>
        <td style="white-space:nowrap">${fmtDate(a.created_at)}</td>
        <td>${esc(a.notes) || '—'}</td>
      </tr>`).join('')}
    </tbody>
  </table>
</div>` : ''

  // ── Print bar summary text ────────────────────────────────────
  const summaryParts = [
    discharges.length    ? `${discharges.length} discharge` : '',
    prescriptions.length ? `${prescriptions.length} Rx` : '',
    paidBills.length     ? `${paidBills.length} receipts (${inr(totalPaid)})` : '',
    encounters.length    ? `${encounters.length} visits` : '',
    attachments.length   ? `${attachments.length} files` : '',
  ].filter(Boolean).join(' · ')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Insurance Bundle — ${esc(patient.full_name)} (${esc(patient.mrn)})</title>
<style>${css}</style>
</head>
<body>

<div class="pbar no-print">
  <div>
    <strong>🛡️ Insurance Bundle</strong> — ${esc(patient.full_name)} (${esc(patient.mrn)})
    <div class="pbar-sub">${summaryParts}</div>
  </div>
  <button class="pbtn" onclick="window.print()">🖨️ Print / Save as PDF</button>
</div>

<div style="margin-top:62px">
  ${cover}
  ${dischargPages}
  ${rxPages}
  ${billsPage}
  ${consultPage}
  ${filesPage}
</div>

</body>
</html>`
}

// ── Route handler ─────────────────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: { patientId: string } },
) {
  const { patientId } = params
  if (!patientId) {
    return NextResponse.json({ error: 'patientId required' }, { status: 400 })
  }

  const [
    { data: patient },
    { data: encounters },
    { data: prescriptions },
    { data: discharges },
    { data: bills },
    { data: att1 },
    { data: att2 },
  ] = await Promise.all([
    supabase.from('patients').select('*').eq('id', patientId).single(),
    supabase.from('encounters').select('*').eq('patient_id', patientId).order('encounter_date', { ascending: false }),
    supabase.from('prescriptions').select('*').eq('patient_id', patientId).order('created_at', { ascending: false }),
    supabase.from('discharge_summaries').select('*').eq('patient_id', patientId).order('created_at', { ascending: false }),
    supabase.from('bills').select('*').eq('patient_id', patientId).order('created_at', { ascending: false }),
    supabase.from('consultation_attachments').select('id,file_name,file_type,notes,created_at').eq('patient_id', patientId).order('created_at', { ascending: false }),
    supabase.from('consultation_files_db').select('id,file_name,file_type,notes,created_at').eq('patient_id', patientId).order('created_at', { ascending: false }),
  ])

  if (!patient) {
    return NextResponse.json({ error: 'Patient not found' }, { status: 404 })
  }

  const attachments = [
    ...(att1 || []),
    ...(att2 || []),
  ].sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  const html = buildHTML(
    patient,
    encounters    || [],
    prescriptions || [],
    bills         || [],
    discharges    || [],
    attachments,
  )

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}