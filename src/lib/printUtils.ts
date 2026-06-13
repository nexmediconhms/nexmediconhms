/**
 * src/lib/printUtils.ts
 * Professional print utility for generating clean print documents.
 * Opens a new browser window with only relevant content formatted for printing.
 */

function INR(n: number): string {
  return '\u20b9' + n.toLocaleString('en-IN')
}

export function printDocument(bodyHtml: string, options?: {
  title?: string
  hospitalName?: string
  address?: string
  phone?: string
  gstin?: string
  doctorName?: string
  regNo?: string
  pageSize?: 'A4' | 'Letter'
  orientation?: 'portrait' | 'landscape'
}): void {
  const {
    title = 'Document',
    hospitalName = 'NexMedicon Hospital',
    address = '',
    phone = '',
    gstin = '',
    doctorName = '',
    regNo = '',
    pageSize = 'A4',
    orientation = 'portrait',
  } = options || {}

  const generatedAt = new Date().toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric'
  })
  const generatedTime = new Date().toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit'
  })

  const headerSubtitles: string[] = []
  if (address) headerSubtitles.push(address)
  const contactLine: string[] = []
  if (phone) contactLine.push('Tel: ' + phone)
  if (regNo) contactLine.push('Reg: ' + regNo)
  if (contactLine.length) headerSubtitles.push(contactLine.join(' | '))
  if (gstin) headerSubtitles.push('GSTIN: ' + gstin)

  const subtitleHtml = headerSubtitles.map(s => `<div class="subtitle">${s}</div>`).join('')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${title} - ${hospitalName}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    @page { size: ${pageSize} ${orientation}; margin: 15mm; }
    body {
      font-family: 'Inter', 'Segoe UI', Arial, sans-serif;
      font-size: 11px;
      color: #1e293b;
      line-height: 1.5;
      background: white;
      padding: 0;
    }
    .print-header {
      text-align: center;
      border-bottom: 2px solid #1d4ed8;
      padding-bottom: 12px;
      margin-bottom: 16px;
    }
    .print-header h1 {
      font-size: 18px;
      font-weight: 700;
      color: #1e293b;
      margin: 0;
    }
    .print-header .subtitle {
      font-size: 9px;
      color: #64748b;
      margin-top: 3px;
    }
    .print-header .doc-title {
      font-size: 12px;
      font-weight: 600;
      color: #1d4ed8;
      margin-top: 8px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .print-body { min-height: calc(100vh - 140px); }
    .print-footer {
      margin-top: 32px;
      padding-top: 12px;
      border-top: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      font-size: 8px;
      color: #94a3b8;
    }
    .print-footer .signature-block { text-align: right; }
    .print-footer .signature-line {
      border-top: 1px solid #334155;
      width: 140px;
      margin-left: auto;
      margin-bottom: 4px;
    }
    .print-footer .signature-name {
      font-size: 9px;
      color: #334155;
      font-weight: 600;
    }
    table { width: 100%; border-collapse: collapse; }
    th { background: #f8fafc; text-align: left; padding: 8px 10px; font-weight: 600; color: #475569; border-bottom: 2px solid #e2e8f0; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
    td { padding: 6px 10px; border-bottom: 1px solid #f1f5f9; font-size: 11px; }
    .text-right { text-align: right; }
    .font-mono { font-family: monospace; }
    .font-bold { font-weight: bold; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 16px; padding: 10px; background: #f8fafc; border-radius: 6px; border: 1px solid #e2e8f0; }
    .info-grid .info-item { font-size: 11px; }
    .info-grid .info-label { font-weight: 600; color: #475569; }
    .info-grid .info-value { color: #1e293b; }
    .totals-section { border-top: 2px solid #1e293b; margin-top: 12px; padding-top: 8px; }
    .total-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 11px; }
    .total-row.grand { font-size: 14px; font-weight: 700; border-top: 1px solid #e2e8f0; padding-top: 8px; margin-top: 4px; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="print-header">
    <h1>${hospitalName}</h1>
    ${subtitleHtml}
    <div class="doc-title">${title}</div>
  </div>
  <div class="print-body">
    ${bodyHtml}
  </div>
  <div class="print-footer">
    <div>
      <div>Generated: ${generatedAt} at ${generatedTime}</div>
      <div>${hospitalName} &mdash; Powered by NexMedicon HMS</div>
    </div>
    ${doctorName ? `<div class="signature-block"><div class="signature-line"></div><div class="signature-name">${doctorName}</div><div>Authorized Signatory</div></div>` : ''}
  </div>
</body>
</html>`

  const w = window.open('', '_blank')
  if (w) {
    w.document.write(html)
    w.document.close()
    setTimeout(() => w.print(), 400)
  }
}

export function buildReceiptHtml(bill: {
  id: string
  patient_name: string
  mrn?: string
  invoice_number?: string
  items: any[]
  subtotal: number
  discount?: number
  gst_percent?: number
  gst_amount?: number
  net_amount: number
  payment_mode?: string
  status?: string
  created_at: string
  notes?: string
  encounter_type?: string
}): string {
  const items = Array.isArray(bill.items) ? bill.items : []
  const receiptNo = bill.invoice_number || bill.id.slice(-10).toUpperCase()
  const billDate = new Date(bill.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  const billTime = new Date(bill.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  const discount = Number(bill.discount || 0)
  const gstPct = Number(bill.gst_percent || 0)
  const gstAmt = Number(bill.gst_amount || 0)
  const showGst = gstPct > 0 && gstAmt > 0

  let html = `<div class="info-grid">
    <div class="info-item"><span class="info-label">Patient: </span><span class="info-value">${bill.patient_name || ''}</span></div>
    <div class="info-item"><span class="info-label">Bill No: </span><span class="info-value font-mono">${receiptNo}</span></div>
    ${bill.mrn ? `<div class="info-item"><span class="info-label">MRN: </span><span class="info-value font-mono">${bill.mrn}</span></div>` : ''}
    <div class="info-item"><span class="info-label">Date: </span><span class="info-value">${billDate} ${billTime}</span></div>
    ${bill.encounter_type ? `<div class="info-item"><span class="info-label">Type: </span><span class="info-value">${bill.encounter_type}</span></div>` : ''}
    ${bill.payment_mode ? `<div class="info-item"><span class="info-label">Payment: </span><span class="info-value" style="text-transform:capitalize">${bill.payment_mode}</span></div>` : ''}
  </div>`

  html += `<table><thead><tr><th>#</th><th>Description</th><th class="text-right">Amount</th></tr></thead><tbody>`
  items.forEach((item: any, i: number) => {
    html += `<tr><td>${i + 1}</td><td>${item.label || item.description || ''}</td><td class="text-right font-mono">${INR(Number(item.amount || 0))}</td></tr>`
  })
  html += `</tbody></table>`

  html += `<div class="totals-section">`
  html += `<div class="total-row"><span>Subtotal</span><span class="font-mono">${INR(Number(bill.subtotal))}</span></div>`
  if (discount > 0) {
    html += `<div class="total-row" style="color:#16a34a"><span>Discount</span><span class="font-mono">- ${INR(discount)}</span></div>`
  }
  if (showGst) {
    html += `<div class="total-row" style="color:#d97706"><span>GST @ ${gstPct}%</span><span class="font-mono">+ ${INR(gstAmt)}</span></div>`
  }
  html += `<div class="total-row grand"><span>Net Amount</span><span class="font-mono">${INR(Number(bill.net_amount))}</span></div>`
  html += `</div>`

  if (bill.status === 'paid') {
    html += `<div style="margin-top:16px;padding:8px 12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;text-align:center;font-size:11px;color:#166534;font-weight:600">PAID</div>`
  }
  if (bill.notes && !bill.notes.includes('[ADMIN')) {
    html += `<div style="margin-top:12px;font-size:10px;color:#64748b;padding:6px 10px;background:#f8fafc;border-radius:4px"><strong>Notes:</strong> ${bill.notes}</div>`
  }
  return html
}

export function buildIPDBillHtml(options: {
  patientName: string
  mrn: string
  bedNumber: string
  admissionDate: string
  daysAdmitted: number
  billNumber?: string
  charges: { charge_date: string; category: string; description: string; quantity: number; rate: number; amount: number }[]
  subtotal: number
  discount: number
  netBill: number
}): string {
  const { patientName, mrn, bedNumber, admissionDate, daysAdmitted, charges, subtotal, discount, netBill, billNumber } = options
  const fmtDate = new Date(admissionDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

  let html = `<div class="info-grid">
    <div class="info-item"><span class="info-label">Patient: </span><span class="info-value">${patientName}</span></div>
    <div class="info-item"><span class="info-label">MRN: </span><span class="info-value font-mono">${mrn}</span></div>
    <div class="info-item"><span class="info-label">Bed: </span><span class="info-value">${bedNumber}</span></div>
    <div class="info-item"><span class="info-label">Admitted: </span><span class="info-value">${fmtDate}</span></div>
    <div class="info-item"><span class="info-label">Days: </span><span class="info-value">${daysAdmitted}</span></div>
    ${billNumber ? `<div class="info-item"><span class="info-label">Bill No: </span><span class="info-value font-mono">${billNumber}</span></div>` : ''}
  </div>`

  html += `<table><thead><tr><th>Date</th><th>Category</th><th>Description</th><th class="text-right">Qty</th><th class="text-right">Rate</th><th class="text-right">Amount</th></tr></thead><tbody>`
  charges.forEach(c => {
    html += `<tr><td>${c.charge_date}</td><td style="text-transform:capitalize">${c.category}</td><td>${c.description}</td><td class="text-right">${c.quantity}</td><td class="text-right font-mono">${INR(c.rate)}</td><td class="text-right font-mono">${INR(c.amount)}</td></tr>`
  })
  html += `</tbody></table>`

  html += `<div class="totals-section">`
  html += `<div class="total-row"><span>Subtotal</span><span class="font-mono">${INR(subtotal)}</span></div>`
  if (discount > 0) {
    html += `<div class="total-row" style="color:#16a34a"><span>Discount</span><span class="font-mono">- ${INR(discount)}</span></div>`
  }
  html += `<div class="total-row grand"><span>Net Bill</span><span class="font-mono">${INR(netBill)}</span></div>`
  html += `</div>`

  return html
}

export function buildPrescriptionHtml(options: {
  patientName: string
  mrn?: string
  age?: string
  date: string
  diagnosis?: string
  medications: { drug: string; dose?: string; route?: string; frequency?: string; duration?: string; instructions?: string }[]
  labTests?: string
  followUpDate?: string
  advice?: string
}): string {
  const { patientName, mrn, age, date, diagnosis, medications, labTests, followUpDate, advice } = options
  const fmtDate = new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

  let html = `<div class="info-grid">
    <div class="info-item"><span class="info-label">Patient: </span><span class="info-value">${patientName}</span></div>
    <div class="info-item"><span class="info-label">Date: </span><span class="info-value">${fmtDate}</span></div>
    ${mrn ? `<div class="info-item"><span class="info-label">MRN: </span><span class="info-value font-mono">${mrn}</span></div>` : ''}
    ${age ? `<div class="info-item"><span class="info-label">Age: </span><span class="info-value">${age}</span></div>` : ''}
  </div>`

  if (diagnosis) {
    html += `<div style="margin-bottom:12px;font-size:11px"><strong>Diagnosis:</strong> ${diagnosis}</div>`
  }

  if (medications.length > 0) {
    html += `<div style="margin-bottom:4px;font-size:12px;font-weight:700">Rx</div>`
    html += `<table><thead><tr><th>#</th><th>Medicine</th><th>Dose</th><th>Route</th><th>Frequency</th><th>Duration</th></tr></thead><tbody>`
    medications.forEach((med, i) => {
      html += `<tr><td>${i + 1}</td><td>${med.drug || ''}</td><td>${med.dose || ''}</td><td>${med.route || ''}</td><td>${med.frequency || ''}</td><td>${med.duration || ''}</td></tr>`
    })
    html += `</tbody></table>`
    const withInstructions = medications.filter(m => m.instructions)
    if (withInstructions.length > 0) {
      html += `<div style="margin-top:8px;font-size:9px;color:#64748b">`
      withInstructions.forEach((med, i) => {
        html += `<div>${i + 1}. ${med.instructions}</div>`
      })
      html += `</div>`
    }
  }

  if (labTests) {
    html += `<div style="margin-top:16px;font-size:11px"><strong>Investigations Advised:</strong> ${labTests}</div>`
  }

  if (advice) {
    html += `<div style="margin-top:12px;font-size:11px"><strong>Advice:</strong> ${advice}</div>`
  }

  if (followUpDate) {
    const fuDate = new Date(followUpDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    html += `<div style="margin-top:12px;padding:8px 12px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;font-size:11px;color:#1e40af"><strong>Follow-up:</strong> ${fuDate}</div>`
  }

  return html
}
