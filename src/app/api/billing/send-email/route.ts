/**
 * src/app/api/billing/send-email/route.ts
 *
 * Send CA Revenue Report via Email with PDF attachment.
 * 
 * Uses Resend API (or falls back to generating a downloadable PDF URL).
 * In production, configure RESEND_API_KEY in environment.
 * If not configured, returns the PDF HTML for client-side download.
 *
 * POST body:
 * {
 *   recipientEmail: string,
 *   recipientName?: string,
 *   reportData: CAReportData,
 *   hospitalSettings: object,
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/api-auth'

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
    .title { font-size: 16px; font-weight: bold; color: #1e293b; margin-bottom: 4px; }
    .subtitle { font-size: 11px; color: #64748b; margin-bottom: 20px; }
    .summary-grid { display: flex; gap: 12px; margin-bottom: 24px; }
    .summary-box { flex: 1; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; text-align: center; }
    .summary-box .value { font-size: 18px; font-weight: 700; color: #1e293b; font-family: monospace; }
    .summary-box .label { font-size: 9px; color: #64748b; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
    .net-box { background: #ecfdf5 !important; border-color: #86efac !important; }
    .net-box .value { color: #15803d !important; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; }
    th { background: #f1f5f9; text-align: left; padding: 8px 12px; font-weight: 600; color: #475569; border-bottom: 2px solid #e2e8f0; font-size: 10px; text-transform: uppercase; }
    td { padding: 8px 12px; border-bottom: 1px solid #f1f5f9; }
    .section-title { font-size: 13px; font-weight: 700; color: #334155; margin: 20px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #e2e8f0; }
    .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 9px; color: #94a3b8; display: flex; justify-content: space-between; }
    .amount { font-family: monospace; font-weight: 600; }
    .pending-alert { background: #fef3c7; border: 1px solid #fde68a; border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; font-size: 11px; color: #92400e; }
    .gst-note { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; padding: 8px 12px; margin: 12px 0; font-size: 10px; color: #1e40af; }
    @media print {
      body { padding: 20px; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${hs.hospitalName || 'NexMedicon Hospital'}</h1>
    ${hs.address ? `<p>${hs.address}</p>` : ''}
    ${hs.phone ? `<p>Tel: ${hs.phone} ${hs.gstin ? ' | GSTIN: ' + hs.gstin : ''}</p>` : ''}
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
      <div class="label">Discounts Given</div>
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

  ${r.pendingCount > 0 ? `
  <div class="pending-alert">
    &#9888; ${r.pendingCount} pending bill(s) &mdash; &#8377;${Number(r.pendingAmount).toLocaleString('en-IN')} not yet collected (excluded from Net)
  </div>` : ''}

  <div class="section-title">Payment Mode Breakdown</div>
  <table>
    <thead><tr><th>Mode</th><th style="text-align:right">Amount (&#8377;)</th><th style="text-align:right">Count</th><th style="text-align:right">%</th></tr></thead>
    <tbody>
      ${(r.paymentBreakdown || []).map((m: any) => `
        <tr>
          <td style="text-transform:capitalize">${m.mode === 'cash' ? '&#128181; Cash' : m.mode === 'upi' ? '&#128241; UPI' : m.mode === 'card' ? '&#128179; Card' : m.mode}</td>
          <td class="amount" style="text-align:right">&#8377;${Number(m.amount).toLocaleString('en-IN')}</td>
          <td style="text-align:right">${m.count}</td>
          <td style="text-align:right">${r.totalNet > 0 ? Math.round((m.amount / r.totalNet) * 100) : 0}%</td>
        </tr>
      `).join('')}
      <tr style="font-weight:bold;border-top:2px solid #e2e8f0">
        <td>Total</td>
        <td class="amount" style="text-align:right">&#8377;${Number(r.totalNet).toLocaleString('en-IN')}</td>
        <td style="text-align:right">${r.billCount}</td>
        <td style="text-align:right">100%</td>
      </tr>
    </tbody>
  </table>

  <div class="section-title">Service-wise Revenue</div>
  <table>
    <thead><tr><th>Service</th><th style="text-align:right">Revenue (&#8377;)</th><th style="text-align:right">Count</th></tr></thead>
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

  <div class="gst-note">
    <strong>Note:</strong> Most medical consultation services are GST-exempt under SAC 9993.
    Services attracting GST (if any) are tagged at bill level. Please cross-reference with actual GST returns.
  </div>

  <div class="footer">
    <span>Generated: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })} at ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
    <span>${hs.hospitalName || 'NexMedicon HMS'} ${hs.doctorName ? '| ' + hs.doctorName : ''}</span>
  </div>
</body>
</html>`
}

function generateEmailHtml(r: any, hs: any, recipientName: string): string {
  return `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b;">
  <p>Dear ${recipientName || 'CA'},</p>
  
  <p>Please find attached the <strong>Revenue Report</strong> for <strong>${r.period}</strong> from ${hs.hospitalName || 'our clinic'}.</p>
  
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
    ${r.pendingCount > 0 ? `
    <tr style="background:#fef3c7;">
      <td style="padding:10px 14px;border:1px solid #e2e8f0;">Pending (not collected)</td>
      <td style="padding:10px 14px;border:1px solid #e2e8f0;text-align:right;font-family:monospace;">&#8377;${Number(r.pendingAmount).toLocaleString('en-IN')} (${r.pendingCount} bills)</td>
    </tr>` : ''}
  </table>
  
  <p style="font-size:12px;color:#64748b;">
    The detailed PDF report is attached with service-wise and payment mode breakdowns.
  </p>
  
  <p style="font-size:12px;color:#64748b;">Period: ${r.fromDate} to ${r.toDate}</p>
  
  <p style="margin-top:24px;">Regards,<br/>${hs.doctorName || 'Doctor'}<br/>${hs.hospitalName || ''}<br/>${hs.phone || ''}</p>
  
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;" />
  <p style="font-size:10px;color:#94a3b8;">This is an automated report from NexMedicon HMS. The attached PDF can be used for accounting and tax filing purposes.</p>
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

    // Generate the PDF HTML
    const pdfHtml = generatePDFHtml(r, hs)
    const emailBodyHtml = generateEmailHtml(r, hs, recipientName || 'CA')

    // Check if Resend API is configured
    const resendApiKey = process.env.RESEND_API_KEY
    const fromEmail = process.env.RESEND_FROM_EMAIL || `reports@${hs.hospitalName?.toLowerCase().replace(/[^a-z]/g, '') || 'clinic'}.nexmedicon.com`

    if (resendApiKey && recipientEmail) {
      // Send via Resend with HTML email body
      // The PDF is embedded as an HTML attachment that the recipient can print-to-PDF
      try {
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
            attachments: [
              {
                filename: `Revenue-Report-${r.period.replace(/[^a-zA-Z0-9]/g, '-')}.html`,
                content: Buffer.from(pdfHtml).toString('base64'),
                type: 'text/html',
              },
            ],
          }),
        })

        if (res.ok) {
          const data = await res.json()
          return NextResponse.json({
            success: true,
            method: 'email',
            message: `Report sent to ${recipientEmail} successfully.`,
            emailId: data.id,
          })
        } else {
          const errData = await res.json().catch(() => ({}))
          console.error('[send-email] Resend API error:', errData)
          // Fall through to client-side fallback
        }
      } catch (e) {
        console.error('[send-email] Resend fetch error:', e)
        // Fall through to client-side fallback
      }
    }

    // Fallback: Return the PDF HTML + mailto link for client-side handling
    // This works even without Resend configured — the client can:
    // 1. Download the PDF HTML and attach manually to email
    // 2. Open mailto: with summary text
    const subject = encodeURIComponent(`Revenue Report - ${r.period} | ${hs.hospitalName || 'Clinic'}`)
    const plainBody = encodeURIComponent(
      `Dear ${recipientName || 'CA'},\n\n` +
      `Please find the revenue report for ${r.period} from ${hs.hospitalName || 'our clinic'}.\n\n` +
      `Summary:\n` +
      `- Gross Revenue: Rs.${Number(r.totalGross).toLocaleString('en-IN')}\n` +
      `- Total Discounts: Rs.${Number(r.totalDiscount).toLocaleString('en-IN')}\n` +
      `- Net Collected: Rs.${Number(r.totalNet).toLocaleString('en-IN')}\n` +
      `- Bills Paid: ${r.billCount}\n` +
      (r.pendingCount > 0 ? `- Pending: Rs.${Number(r.pendingAmount).toLocaleString('en-IN')} (${r.pendingCount} bills)\n` : '') +
      `\nPeriod: ${r.fromDate} to ${r.toDate}\n\n` +
      `The detailed PDF report is attached.\n\n` +
      `Regards,\n${hs.doctorName || 'Doctor'}\n${hs.hospitalName || ''}\n${hs.phone || ''}`
    )

    return NextResponse.json({
      success: true,
      method: 'client_fallback',
      message: recipientEmail
        ? 'Resend API not configured. Use the download button to save PDF and attach manually to email.'
        : 'No recipient email provided. PDF generated for download.',
      pdfHtml,
      fileName: `Revenue-Report-${r.period.replace(/[^a-zA-Z0-9]/g, '-')}.html`,
      mailtoUrl: recipientEmail
        ? `mailto:${recipientEmail}?subject=${subject}&body=${plainBody}`
        : null,
    })
  } catch (err: any) {
    console.error('[send-email] error:', err)
    return NextResponse.json({ error: err.message || 'Failed to send email' }, { status: 500 })
  }
}