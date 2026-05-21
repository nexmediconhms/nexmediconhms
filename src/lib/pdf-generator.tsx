/**
 * src/lib/pdf-generator.tsx
 *
 * PDF Generation using @react-pdf/renderer
 *
 * ENHANCED: All PDFs now use attractive, professional design with:
 *  - Proper header with clinic branding
 *  - Clear section hierarchy
 *  - Color-coded elements
 *  - Minimal clutter — only required information
 *  - Consistent typography
 *
 * IMPORTANT: @react-pdf/renderer must run server-side only (Node.js).
 * Do NOT import this file in 'use client' components.
 */

import React from 'react'

// ─── Types ────────────────────────────────────────────────────

export interface PDFPrescriptionData {
  patient: {
    full_name:    string
    mrn:          string
    age?:         number
    gender?:      string
    mobile?:      string
    blood_group?: string
    address?:     string
  }
  encounter: {
    encounter_date:   string
    diagnosis?:       string
    chief_complaint?: string
    bp_systolic?:     number
    bp_diastolic?:    number
    pulse?:           number
    temperature?:     number
    spo2?:            number
    weight?:          number
  }
  prescription: {
    medications: Array<{
      drug:           string
      dose?:          string
      route?:         string
      frequency?:     string
      duration?:      string
      instructions?:  string
    }>
    advice?:          string
    dietary_advice?:  string
    reports_needed?:  string
    follow_up_date?:  string
  }
  hospital: {
    hospitalName: string
    address?:     string
    phone?:       string
    email?:       string
    regNo?:       string
    gstin?:       string
    doctorName:   string
    doctorQual?:  string
    doctorReg?:   string
    footerNote?:  string
    logoUrl?:     string
    doctorSignatureUrl?: string
  }
}

export interface PDFBillData {
  bill: {
    id:           string
    bill_no?:     string
    net_amount:   number
    subtotal:     number
    discount:     number
    gst_percent?: number
    gst_amount?:  number
    payment_mode?: string
    status:       string
    created_at:   string
    items:        Array<{ label: string; amount: number; quantity?: number }>
    notes?:       string
  }
  patient: {
    full_name: string
    mrn:       string
    mobile?:   string
    address?:  string
    age?:      number
  }
  hospital: {
    hospitalName: string
    address?:     string
    phone?:       string
    gstin?:       string
    regNo?:       string
  }
}

export interface PDFLabReportData {
  report: {
    report_name:   string
    report_date:   string
    status:        string
    notes?:        string
    lab_name?:     string
    attachment_url?: string
    values?:       Array<{ parameter: string; value: string; unit?: string; ref_range?: string; flag?: string }>
  }
  patient: {
    full_name: string
    mrn:       string
    age?:      number
    gender?:   string
  }
  hospital: {
    hospitalName: string
    address?:     string
    phone?:       string
  }
}

// ─── Color palette ────────────────────────────────────────────
const C = {
  primary:    '#1d4ed8',   // Blue
  primaryLt:  '#dbeafe',   // Light blue
  accent:     '#0f766e',   // Teal
  danger:     '#dc2626',   // Red
  success:    '#16a34a',   // Green
  text:       '#111827',   // Near-black
  muted:      '#6b7280',   // Gray
  subtle:     '#9ca3af',   // Light gray
  border:     '#e5e7eb',   // Border gray
  bg:         '#f9fafb',   // Background gray
  white:      '#ffffff',
}

// ─── Prescription PDF ─────────────────────────────────────────

export async function generatePrescriptionPDF(data: PDFPrescriptionData): Promise<Buffer> {
  const { renderToBuffer, Document, Page, Text, View, StyleSheet, Image } = await import('@react-pdf/renderer')

  const s = StyleSheet.create({
    page:         { fontFamily: 'Helvetica', fontSize: 9, paddingHorizontal: 36, paddingVertical: 28, backgroundColor: C.white },

    // Header
    headerWrap:   { borderBottomWidth: 3, borderBottomColor: C.primary, paddingBottom: 10, marginBottom: 14 },
    hospitalName: { fontSize: 18, fontFamily: 'Helvetica-Bold', color: C.primary, textAlign: 'center', marginBottom: 2 },
    subtext:      { fontSize: 8, color: C.muted, textAlign: 'center', marginBottom: 1 },
    doctorLine:   { fontSize: 9, color: C.primary, fontFamily: 'Helvetica-Bold', textAlign: 'center', marginTop: 3 },
    badge:        { alignSelf: 'center', backgroundColor: C.primaryLt, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, marginTop: 3 },
    badgeText:    { fontSize: 7, color: C.primary, fontFamily: 'Helvetica-Bold' },

    // Patient row
    patientBox:   { backgroundColor: C.bg, borderRadius: 6, padding: 8, marginBottom: 10, flexDirection: 'row', flexWrap: 'wrap' },
    patCell:      { width: '33%', marginBottom: 3 },
    patLabel:     { fontSize: 7, color: C.muted, marginBottom: 1 },
    patValue:     { fontSize: 8.5, color: C.text, fontFamily: 'Helvetica-Bold' },

    // Diagnosis
    dxBox:        { backgroundColor: C.primaryLt, borderLeftWidth: 3, borderLeftColor: C.primary, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 4, marginBottom: 10 },
    dxLabel:      { fontSize: 7, color: C.primary, marginBottom: 1 },
    dxValue:      { fontSize: 10, color: C.primary, fontFamily: 'Helvetica-Bold' },

    // Vitals
    vitalsRow:    { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: C.bg, padding: 6, borderRadius: 4, marginBottom: 10 },
    vitalItem:    { marginRight: 16, marginBottom: 2 },
    vitalVal:     { fontSize: 8.5, color: C.text, fontFamily: 'Helvetica-Bold' },
    vitalLabel:   { fontSize: 7, color: C.muted },

    // Sections
    sectionTitle: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 5, marginTop: 8 },

    // Medications
    medRow:       { flexDirection: 'row', marginBottom: 6, paddingBottom: 5, borderBottomWidth: 1, borderBottomColor: C.border },
    medNum:       { width: 16, fontSize: 8, color: C.subtle, paddingTop: 1 },
    medDrug:      { fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: C.text, marginBottom: 2 },
    medDetail:    { fontSize: 8, color: C.muted },
    medInstr:     { fontSize: 7.5, color: C.accent, fontFamily: 'Helvetica-Bold', marginTop: 1 },

    // Advice / reports
    adviceBox:    { backgroundColor: C.bg, borderRadius: 4, padding: 7, marginBottom: 8 },
    adviceText:   { fontSize: 8, color: C.text, lineHeight: 1.6 },

    // Follow-up
    followBox:    { backgroundColor: '#ecfdf5', borderRadius: 4, padding: 7, marginBottom: 10, flexDirection: 'row', alignItems: 'center' },
    followText:   { fontSize: 9, color: C.success, fontFamily: 'Helvetica-Bold' },

    // Footer
    footer:       { marginTop: 16, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
    footNote:     { fontSize: 7, color: C.subtle, flex: 1, lineHeight: 1.5 },
    sigArea:      { alignItems: 'flex-end' },
    sigLine:      { fontSize: 7, color: C.muted, marginBottom: 2 },
    sigName:      { fontSize: 8, color: C.text, fontFamily: 'Helvetica-Bold' },
    sigQual:      { fontSize: 7, color: C.muted },
  })

  const { patient: pat, encounter: enc, prescription: rx, hospital: hs } = data

  const doc = (
    <Document title={`Prescription — ${pat.full_name} — ${enc.encounter_date}`} author={hs.doctorName}>
      <Page size="A4" style={s.page}>

        {/* ── Header ────────────────────────────────────────── */}
        <View style={s.headerWrap}>
          <Text style={s.hospitalName}>{hs.hospitalName}</Text>
          {hs.address && <Text style={s.subtext}>{hs.address}</Text>}
          {hs.phone   && <Text style={s.subtext}>☎ {hs.phone}{hs.email ? `  |  ✉ ${hs.email}` : ''}</Text>}
          <Text style={s.doctorLine}>
            Dr. {hs.doctorName}{hs.doctorQual ? ` — ${hs.doctorQual}` : ''}{hs.doctorReg ? ` | Reg: ${hs.doctorReg}` : ''}
          </Text>
          <View style={s.badge}><Text style={s.badgeText}>PRESCRIPTION</Text></View>
        </View>

        {/* ── Patient Info ───────────────────────────────────── */}
        <View style={s.patientBox}>
          <View style={s.patCell}><Text style={s.patLabel}>Patient Name</Text><Text style={s.patValue}>{pat.full_name}</Text></View>
          <View style={s.patCell}><Text style={s.patLabel}>MRN</Text><Text style={s.patValue}>{pat.mrn}</Text></View>
          <View style={s.patCell}><Text style={s.patLabel}>Date</Text><Text style={s.patValue}>{enc.encounter_date}</Text></View>
          {pat.age != null && <View style={s.patCell}><Text style={s.patLabel}>Age / Gender</Text><Text style={s.patValue}>{pat.age}y {pat.gender || ''}</Text></View>}
          {pat.mobile && <View style={s.patCell}><Text style={s.patLabel}>Mobile</Text><Text style={s.patValue}>{pat.mobile}</Text></View>}
          {pat.blood_group && <View style={s.patCell}><Text style={s.patLabel}>Blood Group</Text><Text style={s.patValue}>{pat.blood_group}</Text></View>}
        </View>

        {/* ── Diagnosis ─────────────────────────────────────── */}
        {enc.diagnosis && (
          <View style={s.dxBox}>
            <Text style={s.dxLabel}>DIAGNOSIS</Text>
            <Text style={s.dxValue}>{enc.diagnosis}</Text>
            {enc.chief_complaint && <Text style={{ fontSize: 7.5, color: C.primary, marginTop: 2 }}>Complaint: {enc.chief_complaint}</Text>}
          </View>
        )}

        {/* ── Vitals ────────────────────────────────────────── */}
        {(enc.bp_systolic || enc.pulse || enc.temperature || enc.spo2 || enc.weight) && (
          <View style={s.vitalsRow}>
            {enc.bp_systolic  && <View style={s.vitalItem}><Text style={s.vitalVal}>{enc.bp_systolic}/{enc.bp_diastolic}</Text><Text style={s.vitalLabel}>BP (mmHg)</Text></View>}
            {enc.pulse        && <View style={s.vitalItem}><Text style={s.vitalVal}>{enc.pulse}</Text><Text style={s.vitalLabel}>Pulse (bpm)</Text></View>}
            {enc.temperature  && <View style={s.vitalItem}><Text style={s.vitalVal}>{enc.temperature}°F</Text><Text style={s.vitalLabel}>Temp</Text></View>}
            {enc.spo2         && <View style={s.vitalItem}><Text style={s.vitalVal}>{enc.spo2}%</Text><Text style={s.vitalLabel}>SpO₂</Text></View>}
            {enc.weight       && <View style={s.vitalItem}><Text style={s.vitalVal}>{enc.weight} kg</Text><Text style={s.vitalLabel}>Weight</Text></View>}
          </View>
        )}

        {/* ── Medications ───────────────────────────────────── */}
        {rx.medications?.length > 0 && (
          <>
            <Text style={s.sectionTitle}>℞  Medications</Text>
            {rx.medications.map((med, i) => (
              <View key={i} style={s.medRow}>
                <Text style={s.medNum}>{i + 1}.</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.medDrug}>{med.drug}{med.dose ? `   ${med.dose}` : ''}</Text>
                  {(med.route || med.frequency || med.duration) && (
                    <Text style={s.medDetail}>
                      {[med.route, med.frequency, med.duration].filter(Boolean).join('  ·  ')}
                    </Text>
                  )}
                  {med.instructions && <Text style={s.medInstr}>↳ {med.instructions}</Text>}
                </View>
              </View>
            ))}
          </>
        )}

        {/* ── Investigations ────────────────────────────────── */}
        {rx.reports_needed && (
          <>
            <Text style={s.sectionTitle}>Investigations</Text>
            <View style={s.adviceBox}><Text style={s.adviceText}>{rx.reports_needed}</Text></View>
          </>
        )}

        {/* ── Advice ────────────────────────────────────────── */}
        {(rx.advice || rx.dietary_advice) && (
          <>
            <Text style={s.sectionTitle}>Advice</Text>
            <View style={s.adviceBox}>
              {rx.advice         && <Text style={s.adviceText}>{rx.advice}</Text>}
              {rx.dietary_advice && <Text style={{ ...s.adviceText, color: C.accent, marginTop: 3 }}>🥗 Diet: {rx.dietary_advice}</Text>}
            </View>
          </>
        )}

        {/* ── Follow-up ─────────────────────────────────────── */}
        {rx.follow_up_date && (
          <View style={s.followBox}>
            <Text style={s.followText}>✓  Follow-up scheduled: {rx.follow_up_date}</Text>
          </View>
        )}

        {/* ── Footer ────────────────────────────────────────── */}
        <View style={s.footer}>
          <Text style={s.footNote}>
            {hs.footerNote || 'This is a computer-generated prescription and is valid without a physical signature.'}
            {hs.regNo  ? `\nReg: ${hs.regNo}` : ''}
            {hs.gstin  ? `   GSTIN: ${hs.gstin}` : ''}
          </Text>
          <View style={s.sigArea}>
            {hs.doctorSignatureUrl ? (
              <Image src={hs.doctorSignatureUrl} style={{ width: 100, height: 40, marginBottom: 4 }} />
            ) : (
              <Text style={{ ...s.sigLine, marginBottom: 18 }}> </Text>
            )}
            <Text style={s.sigLine}>________________________________</Text>
            <Text style={s.sigName}>Dr. {hs.doctorName}</Text>
            {hs.doctorQual && <Text style={s.sigQual}>{hs.doctorQual}</Text>}
          </View>
        </View>

      </Page>
    </Document>
  )

  return renderToBuffer(doc)
}

// ─── Bill / Invoice PDF ───────────────────────────────────────

export async function generateBillPDF(data: PDFBillData): Promise<Buffer> {
  const { renderToBuffer, Document, Page, Text, View, StyleSheet } = await import('@react-pdf/renderer')

  const s = StyleSheet.create({
    page:        { fontFamily: 'Helvetica', fontSize: 9, paddingHorizontal: 36, paddingVertical: 28, backgroundColor: C.white },
    headerWrap:  { borderBottomWidth: 3, borderBottomColor: C.primary, paddingBottom: 8, marginBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
    hospitalName:{ fontSize: 15, fontFamily: 'Helvetica-Bold', color: C.primary },
    subtext:     { fontSize: 7.5, color: C.muted, marginTop: 1 },
    invoiceBlock:{ alignItems: 'flex-end' },
    invoiceTitle:{ fontSize: 14, fontFamily: 'Helvetica-Bold', color: C.muted },
    invoiceNo:   { fontSize: 8, color: C.muted, marginTop: 2 },
    patientBox:  { backgroundColor: C.bg, borderRadius: 6, padding: 8, marginBottom: 10, flexDirection: 'row', justifyContent: 'space-between' },
    patInfo:     { flex: 1 },
    patLabel:    { fontSize: 7, color: C.muted, marginBottom: 1 },
    patValue:    { fontSize: 8.5, color: C.text, fontFamily: 'Helvetica-Bold' },
    billMeta:    { alignItems: 'flex-end' },
    tableHeader: { flexDirection: 'row', backgroundColor: C.primary, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 3, marginBottom: 2 },
    thText:      { fontSize: 7.5, color: C.white, fontFamily: 'Helvetica-Bold' },
    tableRow:    { flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: C.border },
    tdText:      { fontSize: 8.5, color: C.text },
    tdAmount:    { fontSize: 8.5, color: C.text, textAlign: 'right' },
    totalsWrap:  { marginTop: 8, paddingTop: 6, borderTopWidth: 2, borderTopColor: C.border },
    totalRow:    { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2, paddingHorizontal: 8 },
    totalLabel:  { fontSize: 8.5, color: C.muted },
    totalValue:  { fontSize: 8.5, color: C.text },
    netRow:      { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, paddingHorizontal: 8, backgroundColor: C.primaryLt, borderRadius: 4, marginTop: 3 },
    netLabel:    { fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.primary },
    netValue:    { fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.primary },
    statusBadge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, marginTop: 8 },
    footer:      { marginTop: 16, paddingTop: 6, borderTopWidth: 1, borderTopColor: C.border, flexDirection: 'row', justifyContent: 'space-between' },
    footNote:    { fontSize: 7, color: C.subtle },
  })

  const { bill, patient: pat, hospital: hs } = data
  const isPaid    = bill.status === 'paid'
  const statusClr = isPaid ? C.success : C.danger

  const doc = (
    <Document title={`Invoice ${bill.bill_no || bill.id.slice(-8)} — ${pat.full_name}`}>
      <Page size="A4" style={s.page}>

        {/* ── Header ──────────────────────────────────────────── */}
        <View style={s.headerWrap}>
          <View>
            <Text style={s.hospitalName}>{hs.hospitalName}</Text>
            {hs.address && <Text style={s.subtext}>{hs.address}</Text>}
            {hs.phone   && <Text style={s.subtext}>☎ {hs.phone}</Text>}
            {hs.gstin   && <Text style={s.subtext}>GSTIN: {hs.gstin}</Text>}
          </View>
          <View style={s.invoiceBlock}>
            <Text style={s.invoiceTitle}>INVOICE</Text>
            <Text style={s.invoiceNo}>#{bill.bill_no || bill.id.slice(-8).toUpperCase()}</Text>
            <Text style={{ ...s.invoiceNo, marginTop: 2 }}>
              {new Date(bill.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
            </Text>
          </View>
        </View>

        {/* ── Patient Info ─────────────────────────────────────── */}
        <View style={s.patientBox}>
          <View style={s.patInfo}>
            <Text style={s.patLabel}>Bill To</Text>
            <Text style={{ ...s.patValue, fontSize: 11 }}>{pat.full_name}</Text>
            <Text style={{ fontSize: 8, color: C.muted, marginTop: 2 }}>MRN: {pat.mrn}</Text>
            {pat.mobile  && <Text style={{ fontSize: 8, color: C.muted }}>☎ {pat.mobile}</Text>}
            {pat.address && <Text style={{ fontSize: 8, color: C.muted }}>{pat.address}</Text>}
          </View>
          <View style={s.billMeta}>
            <View style={[s.statusBadge, { backgroundColor: isPaid ? '#dcfce7' : '#fee2e2' }]}>
              <Text style={{ fontSize: 9, color: statusClr, fontFamily: 'Helvetica-Bold' }}>
                {isPaid ? '✓ PAID' : '⏳ PENDING'}
              </Text>
            </View>
            {bill.payment_mode && (
              <Text style={{ fontSize: 8, color: C.muted, marginTop: 4, textAlign: 'right' }}>
                Mode: {bill.payment_mode.toUpperCase()}
              </Text>
            )}
          </View>
        </View>

        {/* ── Items Table ──────────────────────────────────────── */}
        <View style={s.tableHeader}>
          <Text style={{ ...s.thText, flex: 1 }}>Description</Text>
          <Text style={{ ...s.thText, width: 40, textAlign: 'right' }}>Qty</Text>
          <Text style={{ ...s.thText, width: 70, textAlign: 'right' }}>Amount (₹)</Text>
        </View>

        {bill.items.map((item, i) => (
          <View key={i} style={[s.tableRow, { backgroundColor: i % 2 === 0 ? C.white : C.bg }]}>
            <Text style={{ ...s.tdText, flex: 1 }}>{item.label}</Text>
            <Text style={{ ...s.tdText, width: 40, textAlign: 'right' }}>{item.quantity || 1}</Text>
            <Text style={{ ...s.tdAmount, width: 70 }}>₹{item.amount.toLocaleString('en-IN')}</Text>
          </View>
        ))}

        {/* ── Totals ───────────────────────────────────────────── */}
        <View style={s.totalsWrap}>
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>Subtotal</Text>
            <Text style={s.totalValue}>₹{bill.subtotal.toLocaleString('en-IN')}</Text>
          </View>
          {(bill.discount > 0) && (
            <View style={s.totalRow}>
              <Text style={{ ...s.totalLabel, color: C.success }}>Discount</Text>
              <Text style={{ ...s.totalValue, color: C.success }}>− ₹{bill.discount.toLocaleString('en-IN')}</Text>
            </View>
          )}
          {(bill.gst_amount && bill.gst_amount > 0) && (
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>GST ({bill.gst_percent || 0}%)</Text>
              <Text style={s.totalValue}>₹{bill.gst_amount.toLocaleString('en-IN')}</Text>
            </View>
          )}
          <View style={s.netRow}>
            <Text style={s.netLabel}>TOTAL DUE</Text>
            <Text style={s.netValue}>₹{bill.net_amount.toLocaleString('en-IN')}</Text>
          </View>
        </View>

        {/* Notes */}
        {bill.notes && !bill.notes.startsWith('[ADMIN MODIFIED]') && (
          <View style={{ marginTop: 10, backgroundColor: '#fffbeb', padding: 6, borderRadius: 4 }}>
            <Text style={{ fontSize: 7.5, color: '#92400e' }}>{bill.notes}</Text>
          </View>
        )}

        {/* ── Footer ───────────────────────────────────────────── */}
        <View style={s.footer}>
          <Text style={s.footNote}>
            Thank you for choosing {hs.hospitalName}.{'\n'}
            {hs.gstin ? `GSTIN: ${hs.gstin}  ` : ''}{hs.regNo ? `Reg: ${hs.regNo}` : ''}
          </Text>
          <Text style={{ ...s.footNote, textAlign: 'right' }}>
            This is a computer-generated document.{'\n'}No signature required.
          </Text>
        </View>

      </Page>
    </Document>
  )

  return renderToBuffer(doc)
}

// ─── Lab Report Summary PDF ───────────────────────────────────

export async function generateLabReportPDF(data: PDFLabReportData): Promise<Buffer> {
  const { renderToBuffer, Document, Page, Text, View, StyleSheet } = await import('@react-pdf/renderer')

  const s = StyleSheet.create({
    page:       { fontFamily: 'Helvetica', fontSize: 9, paddingHorizontal: 36, paddingVertical: 28, backgroundColor: C.white },
    header:     { borderBottomWidth: 3, borderBottomColor: C.accent, paddingBottom: 8, marginBottom: 14 },
    hName:      { fontSize: 15, fontFamily: 'Helvetica-Bold', color: C.accent, textAlign: 'center' },
    hSub:       { fontSize: 7.5, color: C.muted, textAlign: 'center', marginTop: 1 },
    badge:      { alignSelf: 'center', backgroundColor: '#d1fae5', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, marginTop: 3 },
    badgeText:  { fontSize: 7, color: C.accent, fontFamily: 'Helvetica-Bold' },
    patBox:     { backgroundColor: C.bg, borderRadius: 6, padding: 8, marginBottom: 12, flexDirection: 'row', flexWrap: 'wrap' },
    patCell:    { width: '33%', marginBottom: 2 },
    patLabel:   { fontSize: 7, color: C.muted, marginBottom: 1 },
    patValue:   { fontSize: 8.5, color: C.text, fontFamily: 'Helvetica-Bold' },
    reportTitle:{ backgroundColor: C.accent, padding: 8, borderRadius: 4, marginBottom: 10 },
    repTitleTxt:{ fontSize: 12, color: C.white, fontFamily: 'Helvetica-Bold' },
    repMeta:    { fontSize: 8, color: '#d1fae5', marginTop: 2 },
    tableHeader:{ flexDirection: 'row', backgroundColor: '#134e4a', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 3, marginBottom: 2 },
    thText:     { fontSize: 7.5, color: C.white, fontFamily: 'Helvetica-Bold' },
    tableRow:   { flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: C.border },
    tdText:     { fontSize: 8.5, color: C.text },
    flagH:      { color: C.danger,  fontFamily: 'Helvetica-Bold' },
    flagL:      { color: '#0ea5e9', fontFamily: 'Helvetica-Bold' },
    notesBox:   { marginTop: 10, backgroundColor: '#fffbeb', padding: 7, borderRadius: 4 },
    notesText:  { fontSize: 8, color: '#92400e', lineHeight: 1.5 },
    footer:     { marginTop: 16, paddingTop: 6, borderTopWidth: 1, borderTopColor: C.border },
    footText:   { fontSize: 7, color: C.subtle, textAlign: 'center' },
  })

  const { report: rep, patient: pat, hospital: hs } = data

  const doc = (
    <Document title={`Lab Report — ${rep.report_name} — ${pat.full_name}`}>
      <Page size="A4" style={s.page}>

        {/* Header */}
        <View style={s.header}>
          <Text style={s.hName}>{hs.hospitalName}</Text>
          {hs.address && <Text style={s.hSub}>{hs.address}</Text>}
          {hs.phone   && <Text style={s.hSub}>☎ {hs.phone}</Text>}
          <View style={s.badge}><Text style={s.badgeText}>LABORATORY REPORT</Text></View>
        </View>

        {/* Patient */}
        <View style={s.patBox}>
          <View style={s.patCell}><Text style={s.patLabel}>Patient Name</Text><Text style={s.patValue}>{pat.full_name}</Text></View>
          <View style={s.patCell}><Text style={s.patLabel}>MRN</Text><Text style={s.patValue}>{pat.mrn}</Text></View>
          {pat.age != null && <View style={s.patCell}><Text style={s.patLabel}>Age / Gender</Text><Text style={s.patValue}>{pat.age}y {pat.gender || ''}</Text></View>}
        </View>

        {/* Report Title */}
        <View style={s.reportTitle}>
          <Text style={s.repTitleTxt}>{rep.report_name}</Text>
          <Text style={s.repMeta}>
            Date: {rep.report_date}   |   Lab: {rep.lab_name || 'In-house'}   |   Status: {rep.status?.toUpperCase()}
          </Text>
        </View>

        {/* Results Table */}
        {rep.values && rep.values.length > 0 && (
          <>
            <View style={s.tableHeader}>
              <Text style={{ ...s.thText, flex: 1.5 }}>Parameter</Text>
              <Text style={{ ...s.thText, width: 60, textAlign: 'right' }}>Value</Text>
              <Text style={{ ...s.thText, width: 50, textAlign: 'right' }}>Unit</Text>
              <Text style={{ ...s.thText, width: 70, textAlign: 'right' }}>Ref Range</Text>
              <Text style={{ ...s.thText, width: 25, textAlign: 'center' }}>Flag</Text>
            </View>
            {rep.values.map((v, i) => {
              const flagStyle = v.flag === 'H' ? s.flagH : v.flag === 'L' ? s.flagL : {}
              return (
                <View key={i} style={[s.tableRow, { backgroundColor: i % 2 === 0 ? C.white : C.bg }]}>
                  <Text style={{ ...s.tdText, flex: 1.5 }}>{v.parameter}</Text>
                  <Text style={{ ...s.tdText, width: 60, textAlign: 'right', ...flagStyle }}>{v.value}</Text>
                  <Text style={{ ...s.tdText, width: 50, textAlign: 'right', color: C.muted }}>{v.unit || '—'}</Text>
                  <Text style={{ ...s.tdText, width: 70, textAlign: 'right', color: C.muted }}>{v.ref_range || '—'}</Text>
                  <Text style={{ ...s.tdText, width: 25, textAlign: 'center', ...flagStyle }}>{v.flag || ''}</Text>
                </View>
              )
            })}
          </>
        )}

        {/* Notes */}
        {rep.notes && (
          <View style={s.notesBox}>
            <Text style={{ ...s.notesText, fontFamily: 'Helvetica-Bold', marginBottom: 2 }}>Notes:</Text>
            <Text style={s.notesText}>{rep.notes}</Text>
          </View>
        )}

        {/* Footer */}
        <View style={s.footer}>
          <Text style={s.footText}>
            This report is computer-generated. Please consult your physician to interpret the results.
          </Text>
        </View>

      </Page>
    </Document>
  )

  return renderToBuffer(doc)
}

// ─── Storage Upload ───────────────────────────────────────────

export async function uploadPDFToStorage(
  pdfBuffer: Buffer,
  filename:  string,
  folder:    string = 'pdfs',
): Promise<string | null> {
  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  const path = `${folder}/${filename}`
  const { error } = await sb.storage.from('documents').upload(path, pdfBuffer, {
    contentType: 'application/pdf',
    upsert:      true,
  })

  if (error) {
    console.error('[pdf-generator] Upload error:', error.message)
    return null
  }

  const { data } = sb.storage.from('documents').getPublicUrl(path)
  return data?.publicUrl || null
}