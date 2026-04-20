import { NextRequest, NextResponse } from 'next/server'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const hospitalName = searchParams.get('h') || 'NexMedicon Hospital'
  const hospitalAddr = searchParams.get('a') || ''

  const pdfDoc = await PDFDocument.create()
  const page   = pdfDoc.addPage([595, 842])
  const form   = pdfDoc.getForm()
  const fontB  = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const fontR  = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const { width, height } = page.getSize()
  const blue = rgb(0.12, 0.31, 0.85)
  const gray = rgb(0.4, 0.4, 0.4)
  const dark = rgb(0.1, 0.1, 0.1)
  const inputBg = rgb(1, 1, 0.96)
  const inputBorder = rgb(0.7, 0.7, 0.7)

  // ── Header ─────────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: height - 70, width, height: 70, color: blue })
  page.drawText(hospitalName, { x: 30, y: height - 32, size: 16, font: fontB, color: rgb(1,1,1) })
  if (hospitalAddr) {
    page.drawText(hospitalAddr, { x: 30, y: height - 50, size: 9, font: fontR, color: rgb(0.85,0.92,1) })
  }
  page.drawText('PATIENT REGISTRATION FORM — FILL ALL FIELDS DIGITALLY', {
    x: 30, y: height - 65, size: 7.5, font: fontB, color: rgb(0.85,0.92,1),
  })

  let y = height - 95

  // ── Section title helper ─────────────────────────────────
  function sectionTitle(title: string) {
    page.drawRectangle({ x: 20, y: y - 2, width: width - 40, height: 16, color: rgb(0.93,0.96,1) })
    page.drawText(title, { x: 25, y, size: 9, font: fontB, color: blue })
    y -= 28
  }

  // ── Text field helper ────────────────────────────────────
  function addTextField(name: string, label: string, x: number, fieldY: number, w: number, h: number) {
    page.drawText(label, { x, y: fieldY + h + 3, size: 8, font: fontB, color: gray })
    const field = form.createTextField(name)
    field.setText('')
    field.addToPage(page, { x, y: fieldY, width: w, height: h, borderColor: inputBorder, backgroundColor: inputBg, borderWidth: 1 })
  }

  // ── Radio group helper ────────────────────────────────────
  function addRadioGroup(name: string, label: string, options: string[], x: number, radioY: number) {
    if (label) page.drawText(label, { x, y: radioY + 12, size: 8, font: fontB, color: gray })
    const group = form.createRadioGroup(name)
    let cx = x
    options.forEach(opt => {
      group.addOptionToPage(opt, page, { x: cx, y: radioY, width: 11, height: 11, borderColor: rgb(0.5,0.5,0.5), borderWidth: 1 })
      page.drawText(opt, { x: cx + 14, y: radioY + 2, size: 9, font: fontR, color: dark })
      cx += opt.length * 6.5 + 22
    })
  }

  // ── PERSONAL DETAILS ─────────────────────────────────────
  sectionTitle('PERSONAL DETAILS')
  addTextField('full_name', 'Full Name (as on ID) *', 20, y - 20, width - 40, 20)
  y -= 42

  addTextField('date_of_birth', 'Date of Birth (DD/MM/YYYY)', 20, y - 20, 160, 20)
  addTextField('age', 'Age (years)', 192, y - 20, 60, 20)
  y -= 42

  addRadioGroup('gender', 'Gender *', ['Female', 'Male', 'Other'], 20, y)
  y -= 35

  page.drawText('Blood Group:', { x: 20, y: y + 12, size: 8, font: fontB, color: gray })
  addRadioGroup('blood_group', '', ['A+','A-','B+','B-','O+','O-','AB+','AB-'], 95, y)
  y -= 38

  // ── CONTACT DETAILS ──────────────────────────────────────
  sectionTitle('CONTACT DETAILS')
  addTextField('mobile', 'Mobile Number (10 digits) *', 20, y - 20, 200, 20)
  addTextField('whatsapp', 'WhatsApp (if different)', 232, y - 20, 180, 20)
  y -= 42
  addTextField('address', 'Full Address (House No, Street, Area, City, PIN)', 20, y - 20, width - 40, 20)
  y -= 42

  // ── IDENTITY ────────────────────────────────────────────
  sectionTitle('IDENTITY DOCUMENTS')
  addTextField('aadhaar', 'Aadhaar Number', 20, y - 20, 200, 20)
  addTextField('abha_id', 'ABHA Health ID', 232, y - 20, 180, 20)
  y -= 42

  // ── EMERGENCY CONTACT ────────────────────────────────────
  sectionTitle('EMERGENCY CONTACT')
  addTextField('emergency_contact_name', 'Contact Name', 20, y - 20, 230, 20)
  addTextField('emergency_contact_phone', 'Contact Mobile', 262, y - 20, 160, 20)
  y -= 42

  // ── INSURANCE ────────────────────────────────────────────
  sectionTitle('HEALTH INSURANCE')
  addRadioGroup('mediclaim', 'Mediclaim / Health Insurance:', ['Yes', 'No'], 185, y)
  y -= 28
  addRadioGroup('cashless', 'Cashless Facility:', ['Yes', 'No'], 120, y)
  y -= 28
  addTextField('insurance_company', 'Insurance Company / Policy Name', 20, y - 20, width - 40, 20)
  y -= 42

  // ── REFERRAL ────────────────────────────────────────────
  page.drawText('How did you find us:', { x: 20, y: y + 12, size: 8, font: fontB, color: gray })
  addRadioGroup('reference_source', '', ['Doctor Ref','Patient Ref','Advertisement','Google','Walk-in','Other'], 130, y)
  y -= 35

  // ── COMPLAINT ────────────────────────────────────────────
  if (y > 110) {
    sectionTitle("TODAY'S COMPLAINT / REASON FOR VISIT")
    addTextField('chief_complaint', 'Describe your main complaint', 20, y - 36, width - 40, 34)
    y -= 58
  }

  // ── CONSENT ─────────────────────────────────────────────
  if (y > 60) {
    page.drawText(
      `I consent to ${hospitalName} recording my personal/medical information for healthcare purposes.`,
      { x: 32, y, size: 8, font: fontR, color: gray }
    )
    const cb = form.createCheckBox('consent')
    cb.addToPage(page, { x: 18, y: y - 2, width: 11, height: 11, borderColor: rgb(0.5,0.5,0.5), borderWidth: 1 })
    y -= 28
    if (y > 50) {
      addTextField('patient_signature', 'Signature / Name', 20, y - 20, 200, 20)
      addTextField('signature_date', 'Date', 232, y - 20, 100, 20)
    }
  }

  // ── Footer ──────────────────────────────────────────────
  page.drawText(
    'NexMedicon HMS · FORM-REG · Fill digitally, save, and upload at reception or send via WhatsApp',
    { x: 20, y: 18, size: 7, font: fontR, color: rgb(0.6,0.6,0.6) }
  )

  const pdfBytes  = await pdfDoc.save()
  const pdfBuffer = Buffer.from(pdfBytes)

  return new NextResponse(pdfBuffer, {
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': 'attachment; filename="NexMedicon_Registration.pdf"',
      'Cache-Control':       'no-store',
    },
  })
}
