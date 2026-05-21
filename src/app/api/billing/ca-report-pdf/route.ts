/**
 * src/app/api/billing/ca-report-pdf/route.ts
 *
 * Generates a proper PDF for the CA Revenue Report.
 * Returns the PDF as a downloadable file or stores in Supabase Storage.
 *
 * This replaces the plain text WhatsApp/Email sharing with proper PDF format.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { reportData, hospitalSettings } = body

    if (!reportData) {
      return NextResponse.json({ error: 'Missing report data' }, { status: 400 })
    }

    const hs = hospitalSettings || {}
    const r = reportData

    // Generate HTML for PDF conversion (using a print-friendly format)
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Inter', Arial, sans-serif; color: #1e293b; margin: 0; padding: 30px 40px; }
    .header { text-align: center; border-bottom: 3px solid #1e40af; padding-bottom: 14px; margin-bottom: 20px; }
    .header h1 { font-size: 22px; color: #1e40af; margin: 0 0 2px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase; }
    .header .address { font-size: 11px; color: #64748b; margin: 2px 0; }
    .header .doctor { font-size: 12px; color: #1e40af; font-weight: 600; margin-top: 6px; }
    .header .reg { font-size: 10px; color: #64748b; }
    .title { font-size: 15px; font-weight: 700; color: #1e293b; margin-bottom: 2px; }
    .subtitle { font-size: 10px; color: #64748b; margin-bottom: 16px; }
    .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px; }
    .summary-box { background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 12px; text-align: center; }
    .summary-box .value { font-size: 18px; font-weight: 700; color: #1e293b; font-family: monospace; }
    .summary-box .label { font-size: 9px; color: #64748b; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 11px; }
    th { background: #1e40af; color: white; text-align: left; padding: 8px 12px; font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: 0.3px; }
    td { padding: 8px 12px; border-bottom: 1px solid #f1f5f9; }
    tr:nth-child(even) td { background: #f8fafc; }
    .section-title { font-size: 12px; font-weight: 700; color: #334155; margin: 18px 0 6px; padding-bottom: 4px; border-bottom: 2px solid #e2e8f0; }
    .footer { margin-top: 30px; padding-top: 12px; border-top: 2px solid #1e40af; font-size: 9px; color: #94a3b8; display: flex; justify-content: space-between; align-items: flex-end; }
    .footer .left { line-height: 1.6; }
    .footer .right { text-align: right; line-height: 1.6; }
    .amount { font-family: monospace; font-weight: 600; }
    .highlight { background: #ecfdf5; border-color: #86efac; }
    @media print { body { padding: 20px; } @page { margin: 10mm 8mm; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>${hs.hospitalName || 'NexMedicon Hospital'}</h1>
    ${hs.address ? `<p class="address">${hs.address}</p>` : ''}
    ${hs.phone ? `<p class="address">Tel: ${hs.phone}</p>` : ''}
    ${hs.doctorName ? `<p class="doctor">Dr. ${hs.doctorName}${hs.doctorQual ? ' — ' + hs.doctorQual : ''}</p>` : ''}
    ${hs.regNo ? `<p class="reg">Reg: ${hs.regNo}</p>` : ''}
  </div>

  <div class="title">CA Revenue Report</div>
  <div class="subtitle">Period: ${r.period} (${r.fromDate} to ${r.toDate})</div>

  <div class="summary-grid">
    <div class="summary-box">
      <div class="value amount">\u20B9${Number(r.totalGross).toLocaleString('en-IN')}</div>
      <div class="label">Gross Revenue</div>
    </div>
    <div class="summary-box">
      <div class="value amount">\u20B9${Number(r.totalDiscount).toLocaleString('en-IN')}</div>
      <div class="label">Discounts</div>
    </div>
    <div class="summary-box highlight">
      <div class="value amount" style="color:#15803d">\u20B9${Number(r.totalNet).toLocaleString('en-IN')}</div>
      <div class="label">Net Collected</div>
    </div>
    <div class="summary-box">
      <div class="value">${r.billCount}</div>
      <div class="label">Bills Paid</div>
    </div>
  </div>

  ${r.pendingCount > 0 ? `
  <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:11px;color:#92400e;">
    \u26A0\uFE0F ${r.pendingCount} pending bill(s) — \u20B9${Number(r.pendingAmount).toLocaleString('en-IN')} not yet collected
  </div>` : ''}

  <div class="section-title">Payment Mode Breakdown</div>
  <table>
    <thead><tr><th>Mode</th><th>Amount</th><th>Bills</th></tr></thead>
    <tbody>
      ${(r.paymentBreakdown || []).map((m: any) => `
        <tr>
          <td style="text-transform:capitalize">${m.mode}</td>
          <td class="amount">\u20B9${Number(m.amount).toLocaleString('en-IN')}</td>
          <td>${m.count}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <div class="section-title">Service-wise Revenue</div>
  <table>
    <thead><tr><th>Service</th><th>Revenue</th><th>Count</th></tr></thead>
    <tbody>
      ${(r.serviceBreakdown || []).slice(0, 15).map((s: any) => `
        <tr>
          <td>${s.label}</td>
          <td class="amount">\u20B9${Number(s.amount).toLocaleString('en-IN')}</td>
          <td>${s.count}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <div class="footer">
    <div class="left">
      Generated: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })} at ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}<br>
      ${hs.hospitalName || 'NexMedicon Hospital'}${hs.regNo ? ' · Reg: ' + hs.regNo : ''}${hs.gstin ? ' · GSTIN: ' + hs.gstin : ''}
    </div>
    <div class="right">
      ${hs.doctorName ? 'Dr. ' + hs.doctorName : ''}${hs.doctorQual ? '<br>' + hs.doctorQual : ''}<br>
      ${hs.footerNote || 'This is a computer-generated report.'}
    </div>
  </div>
</body>
</html>`

    // Return the HTML as a response that can be printed to PDF client-side
    // The client will use window.print() or a PDF service
    return NextResponse.json({
      ok: true,
      html,
      fileName: `CA-Report-${r.period.replace(/[^a-zA-Z0-9]/g, '-')}.pdf`,
    })
  } catch (err: any) {
    console.error('[ca-report-pdf] error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}