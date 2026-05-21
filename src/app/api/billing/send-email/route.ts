/**
 * FILE: src/app/api/billing/send-email/route.ts
 *
 * ISSUE #7 FIX: Email Subsystem Overhaul
 *
 * PROBLEMS IN ORIGINAL:
 *   1. Attachment is .html not .pdf — CAs expect actual PDF files
 *   2. Fallback returns mailto: URL — broken on mobile (no attachment support)
 *   3. From address uses unverified domain — emails go to spam
 *   4. No user notification when Resend fails
 *   5. No server-side PDF generation at all
 *
 * FIX:
 *   1. Uses jsPDF (pure JS, no system dependencies) for server-side PDF creation
 *   2. Attaches real .pdf file via Resend API
 *   3. Uses verified Resend domain (onboarding@resend.dev) as fallback
 *   4. If Resend is not configured, returns base64 PDF for client-side download
 *   5. Proper error messages returned to client
 *
 * SETUP:
 *   1. Install jsPDF:  npm install jspdf
 *   2. Set environment variables:
 *      RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxx
 *      RESEND_FROM_EMAIL=reports@yourdomain.com  (must be verified in Resend)
 *   3. Replace the existing route.ts with this file.
 *
 * WHAT THIS DOES NOT CHANGE:
 *   - Does not modify any client-side components
 *   - Does not change the API endpoint URL (/api/billing/send-email)
 *   - Does not modify the request body format
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/api-auth'

// ── PDF Generation using pure HTML-to-string approach ──
// We generate a properly formatted PDF using jsPDF
// If jsPDF is not available, we fall back to HTML

async function generatePDFBase64(r: any, hs: any): Promise<string | null> {
  try {
    // Dynamic import — works in Next.js server context
    const { jsPDF } = await import('jspdf')

    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    const pageWidth = doc.internal.pageSize.getWidth()
    const margin = 15
    const usable = pageWidth - margin * 2
    let y = margin

    // ── Header ──
    doc.setFontSize(18)
    doc.setFont('helvetica', 'bold')
    doc.text(hs.hospitalName || 'NexMedicon Hospital', pageWidth / 2, y, { align: 'center' })
    y += 7

    if (hs.address) {
      doc.setFontSize(9)
      doc.setFont('helvetica', 'normal')
      doc.text(hs.address, pageWidth / 2, y, { align: 'center' })
      y += 5
    }

    if (hs.phone || hs.gstin) {
      doc.setFontSize(8)
      const info = [hs.phone, hs.gstin ? `GSTIN: ${hs.gstin}` : ''].filter(Boolean).join(' | ')
      doc.text(info, pageWidth / 2, y, { align: 'center' })
      y += 5
    }

    // Separator line
    doc.setDrawColor(37, 99, 235) // blue-600
    doc.setLineWidth(0.5)
    doc.line(margin, y, pageWidth - margin, y)
    y += 8

    // ── Title ──
    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    doc.text('Revenue Report for Chartered Accountant', margin, y)
    y += 6

    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(100, 116, 139) // slate-500
    doc.text(`Period: ${r.period} (${r.fromDate} to ${r.toDate})`, margin, y)
    y += 10

    doc.setTextColor(0, 0, 0)

    // ── Summary Box ──
    const summaryItems = [
      { label: 'Gross Revenue', value: `Rs.${Number(r.totalGross).toLocaleString('en-IN')}` },
      { label: 'Discounts Given', value: `Rs.${Number(r.totalDiscount).toLocaleString('en-IN')}` },
      { label: 'Net Collected', value: `Rs.${Number(r.totalNet).toLocaleString('en-IN')}` },
      { label: 'Bills Paid', value: String(r.billCount) },
    ]

    const boxW = usable / 4 - 2
    summaryItems.forEach((item, i) => {
      const x = margin + i * (boxW + 2.5)
      // Box background
      doc.setFillColor(248, 250, 252) // slate-50
      if (i === 2) doc.setFillColor(236, 253, 245) // green-50 for net
      doc.roundedRect(x, y, boxW, 20, 2, 2, 'F')

      // Value
      doc.setFontSize(12)
      doc.setFont('helvetica', 'bold')
      if (i === 2) doc.setTextColor(21, 128, 61) // green-700
      else doc.setTextColor(30, 41, 59) // slate-800
      doc.text(item.value, x + boxW / 2, y + 10, { align: 'center' })

      // Label
      doc.setFontSize(7)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(100, 116, 139)
      doc.text(item.label.toUpperCase(), x + boxW / 2, y + 16, { align: 'center' })
    })
    doc.setTextColor(0, 0, 0)
    y += 28

    // ── Pending Alert ──
    if (r.pendingCount > 0) {
      doc.setFillColor(254, 243, 199) // amber-100
      doc.roundedRect(margin, y, usable, 10, 2, 2, 'F')
      doc.setFontSize(9)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(146, 64, 14) // amber-800
      doc.text(
        `⚠ ${r.pendingCount} pending bill(s) — Rs.${Number(r.pendingAmount).toLocaleString('en-IN')} not yet collected`,
        margin + 4, y + 6
      )
      doc.setTextColor(0, 0, 0)
      y += 14
    }

    // ── Payment Mode Breakdown Table ──
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.text('Payment Mode Breakdown', margin, y)
    y += 6

    // Table header
    doc.setFillColor(241, 245, 249) // slate-100
    doc.rect(margin, y, usable, 7, 'F')
    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(71, 85, 105)
    doc.text('MODE', margin + 3, y + 5)
    doc.text('AMOUNT', margin + usable * 0.4, y + 5)
    doc.text('COUNT', margin + usable * 0.65, y + 5)
    doc.text('%', margin + usable * 0.85, y + 5)
    y += 9

    doc.setFont('helvetica', 'normal')
    doc.setTextColor(30, 41, 59)
    const modes = r.paymentBreakdown || []
    modes.forEach((m: any) => {
      const pct = r.totalNet > 0 ? Math.round((m.amount / r.totalNet) * 100) : 0
      const modeLabel = m.mode === 'cash' ? 'Cash' : m.mode === 'upi' ? 'UPI' : m.mode === 'card' ? 'Card' : m.mode
      doc.setFontSize(9)
      doc.text(modeLabel, margin + 3, y + 4)
      doc.text(`Rs.${Number(m.amount).toLocaleString('en-IN')}`, margin + usable * 0.4, y + 4)
      doc.text(String(m.count), margin + usable * 0.65, y + 4)
      doc.text(`${pct}%`, margin + usable * 0.85, y + 4)
      y += 7
    })

    // Total row
    doc.setDrawColor(226, 232, 240)
    doc.setLineWidth(0.3)
    doc.line(margin, y, pageWidth - margin, y)
    y += 2
    doc.setFont('helvetica', 'bold')
    doc.text('Total', margin + 3, y + 4)
    doc.text(`Rs.${Number(r.totalNet).toLocaleString('en-IN')}`, margin + usable * 0.4, y + 4)
    doc.text(String(r.billCount), margin + usable * 0.65, y + 4)
    doc.text('100%', margin + usable * 0.85, y + 4)
    y += 10

    // ── Service Breakdown Table ──
    if (y > 240) { doc.addPage(); y = margin }

    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(0, 0, 0)
    doc.text('Service-wise Revenue', margin, y)
    y += 6

    doc.setFillColor(241, 245, 249)
    doc.rect(margin, y, usable, 7, 'F')
    doc.setFontSize(8)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(71, 85, 105)
    doc.text('SERVICE', margin + 3, y + 5)
    doc.text('REVENUE', margin + usable * 0.6, y + 5)
    doc.text('COUNT', margin + usable * 0.85, y + 5)
    y += 9

    doc.setFont('helvetica', 'normal')
    doc.setTextColor(30, 41, 59)
    const services = (r.serviceBreakdown || []).slice(0, 20)
    services.forEach((s: any) => {
      if (y > 275) { doc.addPage(); y = margin }
      doc.setFontSize(9)
      doc.text(String(s.label).substring(0, 40), margin + 3, y + 4)
      doc.text(`Rs.${Number(s.amount).toLocaleString('en-IN')}`, margin + usable * 0.6, y + 4)
      doc.text(String(s.count), margin + usable * 0.85, y + 4)
      y += 7
    })
    y += 5

    // ── GST Note ──
    doc.setFillColor(239, 246, 255) // blue-50
    doc.roundedRect(margin, y, usable, 12, 2, 2, 'F')
    doc.setFontSize(8)
    doc.setTextColor(30, 64, 175)
    doc.text(
      'Note: Most medical consultation services are GST-exempt under SAC 9993.',
      margin + 4, y + 5
    )
    doc.text(
      'Services attracting GST (if any) are tagged at bill level. Cross-reference with actual GST returns.',
      margin + 4, y + 10
    )
    y += 16

    // ── Footer ──
    doc.setTextColor(148, 163, 184) // slate-400
    doc.setFontSize(8)
    const genDate = new Date().toLocaleDateString('en-IN', {
      day: '2-digit', month: 'long', year: 'numeric'
    })
    const genTime = new Date().toLocaleTimeString('en-IN', {
      hour: '2-digit', minute: '2-digit'
    })
    doc.text(`Generated: ${genDate} at ${genTime}`, margin, 285)
    doc.text(
      `${hs.hospitalName || 'NexMedicon HMS'}${hs.doctorName ? ' | ' + hs.doctorName : ''}`,
      pageWidth - margin, 285,
      { align: 'right' }
    )

    // Page number
    const pageCount = doc.getNumberOfPages()
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i)
      doc.setFontSize(7)
      doc.setTextColor(180, 180, 180)
      doc.text(`Page ${i} of ${pageCount}`, pageWidth / 2, 292, { align: 'center' })
    }

    // Return as base64
    return doc.output('datauristring').split(',')[1]
  } catch (err) {
    console.error('[send-email] jsPDF generation failed:', err)
    return null
  }
}

// ── Fallback: Generate HTML that prints well ──
function generatePDFHtml(r: any, hs: any): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Inter', Arial, sans-serif; color: #1e293b; margin: 0; padding: 40px; font-size: 12px; }
    .header { text-align: center; border-bottom: 2px solid #2563eb; padding-bottom: 16px; margin-bottom: 24px; }
    .header h1 { font-size: 22px; color: #1e293b; margin: 0 0 4px; }
    .header p { font-size: 11px; color: #64748b; margin: 2px 0; }
    .title { font-size: 16px; font-weight: bold; }
    .subtitle { font-size: 11px; color: #64748b; margin-bottom: 20px; }
    .summary-grid { display: flex; gap: 12px; margin-bottom: 24px; }
    .summary-box { flex: 1; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; text-align: center; }
    .summary-box .value { font-size: 18px; font-weight: 700; font-family: monospace; }
    .summary-box .label { font-size: 9px; color: #64748b; margin-top: 4px; text-transform: uppercase; }
    .net-box { background: #ecfdf5 !important; border-color: #86efac !important; }
    .net-box .value { color: #15803d !important; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; }
    th { background: #f1f5f9; text-align: left; padding: 8px 12px; font-weight: 600; font-size: 10px; text-transform: uppercase; border-bottom: 2px solid #e2e8f0; }
    td { padding: 8px 12px; border-bottom: 1px solid #f1f5f9; }
    .section-title { font-size: 13px; font-weight: 700; margin: 20px 0 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
    .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 9px; color: #94a3b8; display: flex; justify-content: space-between; }
    .amount { font-family: monospace; font-weight: 600; }
    @media print { body { padding: 20px; } .no-print { display: none; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>${hs.hospitalName || 'NexMedicon Hospital'}</h1>
    ${hs.address ? `<p>${hs.address}</p>` : ''}
    ${hs.phone ? `<p>Tel: ${hs.phone}${hs.gstin ? ' | GSTIN: ' + hs.gstin : ''}</p>` : ''}
  </div>

  <div class="title">Revenue Report for Chartered Accountant</div>
  <div class="subtitle">Period: ${r.period} (${r.fromDate} to ${r.toDate})</div>

  <div class="summary-grid">
    <div class="summary-box">
      <div class="value">&#8377;${Number(r.totalGross).toLocaleString('en-IN')}</div>
      <div class="label">Gross Revenue</div>
    </div>
    <div class="summary-box">
      <div class="value">&#8377;${Number(r.totalDiscount).toLocaleString('en-IN')}</div>
      <div class="label">Discounts</div>
    </div>
    <div class="summary-box net-box">
      <div class="value">&#8377;${Number(r.totalNet).toLocaleString('en-IN')}</div>
      <div class="label">Net Collected</div>
    </div>
    <div class="summary-box">
      <div class="value">${r.billCount}</div>
      <div class="label">Bills Paid</div>
    </div>
  </div>

  <div class="section-title">Payment Mode Breakdown</div>
  <table>
    <thead><tr><th>Mode</th><th style="text-align:right">Amount</th><th style="text-align:right">Count</th><th style="text-align:right">%</th></tr></thead>
    <tbody>
      ${(r.paymentBreakdown || []).map((m: any) => `
        <tr>
          <td style="text-transform:capitalize">${m.mode}</td>
          <td class="amount" style="text-align:right">&#8377;${Number(m.amount).toLocaleString('en-IN')}</td>
          <td style="text-align:right">${m.count}</td>
          <td style="text-align:right">${r.totalNet > 0 ? Math.round((m.amount / r.totalNet) * 100) : 0}%</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <div class="section-title">Service-wise Revenue</div>
  <table>
    <thead><tr><th>Service</th><th style="text-align:right">Revenue</th><th style="text-align:right">Count</th></tr></thead>
    <tbody>
      ${(r.serviceBreakdown || []).slice(0, 20).map((s: any) => `
        <tr>
          <td>${s.label}</td>
          <td class="amount" style="text-align:right">&#8377;${Number(s.amount).toLocaleString('en-IN')}</td>
          <td style="text-align:right">${s.count}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <div class="footer">
    <span>Generated: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })} at ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
    <span>${hs.hospitalName || 'NexMedicon HMS'}${hs.doctorName ? ' | ' + hs.doctorName : ''}</span>
  </div>
</body>
</html>`
}

function generateEmailHtml(r: any, hs: any, recipientName: string): string {
  return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b;">
  <p>Dear ${recipientName || 'CA'},</p>
  <p>Please find attached the <strong>Revenue Report (PDF)</strong> for <strong>${r.period}</strong> from ${hs.hospitalName || 'our clinic'}.</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px;">
    <tr style="background:#f8fafc;">
      <td style="padding:10px 14px;border:1px solid #e2e8f0;"><strong>Gross Revenue</strong></td>
      <td style="padding:10px 14px;border:1px solid #e2e8f0;text-align:right;font-family:monospace;">&#8377;${Number(r.totalGross).toLocaleString('en-IN')}</td>
    </tr>
    <tr>
      <td style="padding:10px 14px;border:1px solid #e2e8f0;">Total Discounts</td>
      <td style="padding:10px 14px;border:1px solid #e2e8f0;text-align:right;font-family:monospace;">&#8377;${Number(r.totalDiscount).toLocaleString('en-IN')}</td>
    </tr>
    <tr style="background:#ecfdf5;">
      <td style="padding:10px 14px;border:1px solid #e2e8f0;"><strong>Net Collected</strong></td>
      <td style="padding:10px 14px;border:1px solid #e2e8f0;text-align:right;font-family:monospace;font-weight:bold;color:#15803d;">&#8377;${Number(r.totalNet).toLocaleString('en-IN')}</td>
    </tr>
    <tr>
      <td style="padding:10px 14px;border:1px solid #e2e8f0;">Bills Paid</td>
      <td style="padding:10px 14px;border:1px solid #e2e8f0;text-align:right;">${r.billCount}</td>
    </tr>
  </table>
  <p style="font-size:12px;color:#64748b;">The detailed PDF report is attached with service-wise and payment mode breakdowns.</p>
  <p style="margin-top:24px;">Regards,<br/>${hs.doctorName || 'Doctor'}<br/>${hs.hospitalName || ''}<br/>${hs.phone || ''}</p>
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;" />
  <p style="font-size:10px;color:#94a3b8;">This is an automated report from NexMedicon HMS.</p>
</div>`
}

export async function POST(req: NextRequest) {
  // Require admin or doctor role to send financial reports
  const auth = await requireRole(req, ['admin', 'doctor'])
  if (auth instanceof Response) return auth

  try {
    const body = await req.json()
    const { recipientEmail, recipientName, reportData, hospitalSettings } = body

    if (!reportData) {
      return NextResponse.json({ error: 'Report data is required' }, { status: 400 })
    }

    const hs = hospitalSettings || {}
    const r = reportData

    // ── Step 1: Generate PDF ──
    const pdfBase64 = await generatePDFBase64(r, hs)
    const fileName = `Revenue-Report-${r.period.replace(/[^a-zA-Z0-9]/g, '-')}.pdf`

    // ── Step 2: Try sending via Resend ──
    const resendApiKey = process.env.RESEND_API_KEY
    // IMPORTANT: Use a verified domain, or use Resend's default for testing
    const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'

    if (resendApiKey && recipientEmail) {
      try {
        const emailBodyHtml = generateEmailHtml(r, hs, recipientName || 'CA')

        // Build attachments — prefer PDF, fall back to HTML
        const attachments = pdfBase64
          ? [{
              filename: fileName,
              content: pdfBase64,
              type: 'application/pdf',
            }]
          : [{
              filename: fileName.replace('.pdf', '.html'),
              content: Buffer.from(generatePDFHtml(r, hs)).toString('base64'),
              type: 'text/html',
            }]

        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: fromEmail,
            to: recipientEmail,
            subject: `Revenue Report - ${r.period} | ${hs.hospitalName || 'Clinic'}`,
            html: emailBodyHtml,
            attachments,
          }),
        })

        if (res.ok) {
          const data = await res.json()
          return NextResponse.json({
            success: true,
            method: 'email',
            message: `Report sent to ${recipientEmail} successfully with PDF attachment.`,
            emailId: data.id,
          })
        }

        // Resend failed — get error details
        const errData = await res.json().catch(() => ({}))
        console.error('[send-email] Resend API error:', res.status, errData)

        // Return error WITH the PDF so user can still download
        return NextResponse.json({
          success: false,
          method: 'email_failed',
          message: `Email delivery failed: ${errData.message || `HTTP ${res.status}`}. You can download the PDF below.`,
          pdfBase64: pdfBase64 || null,
          pdfHtml: pdfBase64 ? null : generatePDFHtml(r, hs),
          fileName,
        }, { status: 200 }) // 200 so the client can still show the download option

      } catch (e: any) {
        console.error('[send-email] Resend fetch error:', e)
        // Fall through to download-only mode
      }
    }

    // ── Step 3: Fallback — Return PDF for client-side download ──
    // No mailto: link — it doesn't work on mobile and can't attach files.
    // Instead, return the PDF data so the client can trigger a download.
    return NextResponse.json({
      success: true,
      method: 'download',
      message: recipientEmail
        ? 'Email service not configured. PDF generated — download and attach to your email manually.'
        : 'PDF report generated. Click download to save.',
      pdfBase64: pdfBase64 || null,
      pdfHtml: pdfBase64 ? null : generatePDFHtml(r, hs),
      fileName,
    })

  } catch (err: any) {
    console.error('[send-email] error:', err)
    return NextResponse.json(
      { error: err.message || 'Failed to generate report' },
      { status: 500 }
    )
  }
}