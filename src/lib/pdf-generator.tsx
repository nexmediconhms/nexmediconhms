/**
 * src/lib/pdf-generator.tsx
 *
 * PDF Generation using @react-pdf/renderer (Requirement #8)
 *
 * Replaces the HTML-to-print (@media print) approach which:
 *  - Breaks on mobile browsers
 *  - Cannot be emailed as an attachment
 *  - Varies by browser print engine
 *
 * This module provides server-side PDF generation that:
 *  - Produces real, consistent PDF files
 *  - Stores them in Supabase Storage
 *  - Can be emailed as attachments
 *  - Works on mobile
 *
 * Usage from a Next.js API route:
 *   const pdfBuffer = await generatePrescriptionPDF(rx, patient, encounter, hs)
 *   const url = await uploadPDFToStorage(pdfBuffer, `rx_${rx.id}.pdf`, 'prescriptions')
 *
 * IMPORTANT: @react-pdf/renderer must run server-side only (Node.js).
 * Do NOT import this file in 'use client' components.
 * Call /api/pdf/prescription?encounterId=... from the client.
 */

import React from 'react'

// Type-only imports for JSX shapes (actual rendering via dynamic import)
export interface PDFPrescriptionData {
  patient: {
    full_name:   string
    mrn:         string
    age?:        number
    gender?:     string
    mobile?:     string
    blood_group?: string
    address?:    string
  }
  encounter: {
    encounter_date: string
    diagnosis?:     string
    chief_complaint?: string
    bp_systolic?:   number
    bp_diastolic?:  number
    pulse?:         number
    temperature?:   number
    spo2?:          number
    weight?:        number
  }
  prescription: {
    medications:    Array<{
      drug:         string
      dose?:        string
      route?:       string
      frequency?:   string
      duration?:    string
      instructions?: string
    }>
    advice?:          string
    dietary_advice?:  string
    reports_needed?:  string
    follow_up_date?:  string
  }
  hospital: {
    hospitalName:  string
    address?:      string
    phone?:        string
    regNo?:        string
    gstin?:        string
    doctorName:    string
    doctorQual?:   string
    doctorReg?:    string
    footerNote?:   string
    upiId?:        string
  }
}

/**
 * Generate a prescription PDF.
 * Returns a Buffer containing the PDF bytes.
 *
 * Must be called server-side only.
 */
export async function generatePrescriptionPDF(data: PDFPrescriptionData): Promise<Buffer> {
  // Dynamic import to avoid bundling React PDF in client bundle
  const { renderToBuffer, Document, Page, Text, View, StyleSheet, Font } = await import('@react-pdf/renderer')

  const styles = StyleSheet.create({
    page:        { fontFamily: 'Helvetica', fontSize: 9, padding: 32, backgroundColor: '#fff' },
    header:      { borderBottom: '2px solid #1d4ed8', paddingBottom: 8, marginBottom: 12 },
    hospitalName:{ fontSize: 16, fontFamily: 'Helvetica-Bold', color: '#1d4ed8', textAlign: 'center' },
    subHeader:   { fontSize: 8,  color: '#555', textAlign: 'center', marginTop: 2 },
    doctorLine:  { fontSize: 8,  color: '#1d4ed8', fontFamily: 'Helvetica-Bold', textAlign: 'center', marginTop: 2 },
    section:     { marginBottom: 10 },
    sectionTitle:{ fontSize: 8,  fontFamily: 'Helvetica-Bold', color: '#374151', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4, borderBottom: '1px solid #e5e7eb', paddingBottom: 2 },
    row:         { flexDirection: 'row', marginBottom: 2 },
    label:       { fontSize: 8,  color: '#6b7280', width: 80 },
    value:       { fontSize: 8,  color: '#111827', flex: 1 },
    medRow:      { flexDirection: 'row', marginBottom: 4, paddingBottom: 4, borderBottom: '1px solid #f3f4f6' },
    medNum:      { fontSize: 8,  color: '#9ca3af', width: 16 },
    medDrug:     { fontSize: 9,  fontFamily: 'Helvetica-Bold', color: '#111827', flex: 1 },
    medDetail:   { fontSize: 8,  color: '#4b5563' },
    medInstr:    { fontSize: 7,  color: '#2563eb', fontStyle: 'italic' },
    footer:      { marginTop: 20, paddingTop: 8, borderTop: '1px solid #e5e7eb', flexDirection: 'row', justifyContent: 'space-between' },
    footerNote:  { fontSize: 7,  color: '#9ca3af', flex: 1 },
    signature:   { fontSize: 7,  color: '#374151', textAlign: 'right' },
  })

  const hs  = data.hospital
  const pat = data.patient
  const enc = data.encounter
  const rx  = data.prescription

  const doc = (
    <Document title={`Prescription — ${pat.full_name}`}>
      <Page size="A4" style={styles.page}>

        {/* Hospital header */}
        <View style={styles.header}>
          <Text style={styles.hospitalName}>{hs.hospitalName}</Text>
          {hs.address  && <Text style={styles.subHeader}>{hs.address}</Text>}
          {hs.phone    && <Text style={styles.subHeader}>Tel: {hs.phone}</Text>}
          <Text style={styles.doctorLine}>
            {hs.doctorName}{hs.doctorQual ? `  |  ${hs.doctorQual}` : ''}{hs.doctorReg ? `  |  Reg: ${hs.doctorReg}` : ''}
          </Text>
        </View>

        {/* Patient info + vitals */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Patient</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Name:</Text>
            <Text style={{ ...styles.value, fontFamily: 'Helvetica-Bold' }}>{pat.full_name}</Text>
            <Text style={styles.label}>Date:</Text>
            <Text style={styles.value}>{enc.encounter_date}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>MRN:</Text>
            <Text style={styles.value}>{pat.mrn}</Text>
            {pat.age    && <><Text style={styles.label}>Age:</Text><Text style={styles.value}>{pat.age}y {pat.gender || ''}</Text></>}
          </View>
          {pat.mobile   && <View style={styles.row}><Text style={styles.label}>Mobile:</Text><Text style={styles.value}>{pat.mobile}</Text></View>}
          {enc.diagnosis && <View style={styles.row}><Text style={styles.label}>Diagnosis:</Text><Text style={{ ...styles.value, fontFamily: 'Helvetica-Bold', color: '#1d4ed8' }}>{enc.diagnosis}</Text></View>}
          {/* Vitals inline */}
          {(enc.bp_systolic || enc.pulse || enc.temperature || enc.spo2 || enc.weight) && (
            <View style={{ ...styles.row, backgroundColor: '#f9fafb', padding: 4, borderRadius: 3, marginTop: 3 }}>
              {enc.bp_systolic  && <Text style={{ ...styles.medDetail, marginRight: 8 }}>BP: {enc.bp_systolic}/{enc.bp_diastolic} mmHg</Text>}
              {enc.pulse        && <Text style={{ ...styles.medDetail, marginRight: 8 }}>P: {enc.pulse} bpm</Text>}
              {enc.temperature  && <Text style={{ ...styles.medDetail, marginRight: 8 }}>T: {enc.temperature}°F</Text>}
              {enc.spo2         && <Text style={{ ...styles.medDetail, marginRight: 8 }}>SpO₂: {enc.spo2}%</Text>}
              {enc.weight       && <Text style={styles.medDetail}>Wt: {enc.weight} kg</Text>}
            </View>
          )}
        </View>

        {/* Rx */}
        {rx.medications?.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>℞ Medications</Text>
            {rx.medications.map((med, i) => (
              <View key={i} style={styles.medRow}>
                <Text style={styles.medNum}>{i + 1}.</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.medDrug}>{med.drug}{med.dose ? `  ${med.dose}` : ''}</Text>
                  <Text style={styles.medDetail}>
                    {[med.route, med.frequency, med.duration].filter(Boolean).join(' · ')}
                  </Text>
                  {med.instructions && <Text style={styles.medInstr}>{med.instructions}</Text>}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Reports */}
        {rx.reports_needed && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Investigations</Text>
            <Text style={{ fontSize: 8, color: '#374151', lineHeight: 1.5 }}>{rx.reports_needed}</Text>
          </View>
        )}

        {/* Advice */}
        {(rx.advice || rx.dietary_advice) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Advice</Text>
            {rx.advice         && <Text style={{ fontSize: 8, color: '#374151', lineHeight: 1.5, marginBottom: 2 }}>{rx.advice}</Text>}
            {rx.dietary_advice && <Text style={{ fontSize: 8, color: '#374151', lineHeight: 1.5 }}>Diet: {rx.dietary_advice}</Text>}
          </View>
        )}

        {/* Follow-up */}
        {rx.follow_up_date && (
          <View style={{ backgroundColor: '#eff6ff', padding: 6, borderRadius: 4, marginBottom: 10 }}>
            <Text style={{ fontSize: 9, color: '#1d4ed8', fontFamily: 'Helvetica-Bold' }}>
              ✓ Follow-up: {rx.follow_up_date}
            </Text>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerNote}>
            {hs.footerNote || 'This prescription is computer-generated and valid without physical signature.'}
            {hs.regNo ? `\nReg: ${hs.regNo}` : ''}{hs.gstin ? `  GSTIN: ${hs.gstin}` : ''}
          </Text>
          <View>
            <Text style={{ ...styles.signature, marginBottom: 20 }}> </Text>
            <Text style={styles.signature}>____________________</Text>
            <Text style={styles.signature}>{hs.doctorName}</Text>
            {hs.doctorQual && <Text style={{ ...styles.signature, fontSize: 7, color: '#6b7280' }}>{hs.doctorQual}</Text>}
          </View>
        </View>

      </Page>
    </Document>
  )

  return renderToBuffer(doc)
}

/**
 * Upload a generated PDF to Supabase Storage.
 * Returns the public URL of the stored PDF.
 */
export async function uploadPDFToStorage(
  pdfBuffer: Buffer,
  filename:  string,
  folder:    string = 'pdfs',
): Promise<string | null> {
  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  const path = `${folder}/${filename}`

  const { error } = await supabase.storage
    .from('documents')
    .upload(path, pdfBuffer, {
      contentType: 'application/pdf',
      upsert:      true,
    })

  if (error) {
    console.error('[pdf-generator] Upload error:', error.message)
    return null
  }

  const { data } = supabase.storage.from('documents').getPublicUrl(path)
  return data?.publicUrl || null
}
