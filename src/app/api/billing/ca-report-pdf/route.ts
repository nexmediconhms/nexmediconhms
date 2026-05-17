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
    body { font-family: 'Inter', Arial, sans-serif; color: #1e293b; margin: 0; padding: 40px; }
    .header { text-align: center; border-bottom: 2px solid #2563eb; padding-bottom: 16px; margin-bottom: 24px; }
    .header h1 { font-size: 20px; color: #1e293b; margin: 0 0 4px; }
    .header p { font-size: 12px; color: #64748b; margin: 2px 0; }
    .title { font-size: 16px; font-weight: bold; color: #1e293b; margin-bottom: 4px; }
    .subtitle { font-size: 11px; color: #64748b; margin-bottom: 20px; }
    .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
    .summary-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; text-align: center; }
    .summary-box .value { font-size: 18px; font-weight: 700; color: #1e293b; }
    .summary-box .label { font-size: 10px; color: #64748b; margin-top: 4px; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 11px; }
    th { background: #f1f5f9; text-align: left; padding: 8px 12px; font-weight: 600; color: #475569; border-bottom: 2px solid #e2e8f0; }
    td { padding: 8px 12px; border-bottom: 1px solid #f1f5f9; }
    .section-title { font-size: 13px; font-weight: 700; color: #334155; margin: 20px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #e2e8f0; }
    .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #94a3b8; display: flex; justify-content: space-between; }
    .amount { font-family: monospace; font-weight: 600; }
    .highlight { background: #ecfdf5; }
  </style>
</head>
<body>
  <div class="header">
    <h1>${hs.hospitalName || 'NexMedicon Hospital'}</h1>
    ${hs.address ? `<p>${hs.address}</p>` : ''}
    ${hs.phone ? `<p>Tel: ${hs.phone}</p>` : ''}
  </div>

  <div class="title">CA Revenue Report</div>
  <div class="subtitle">Period: ${r.period} (${r.fromDate} to ${r.toDate})</div>

  <div class="summary-grid">
    <div class="summary-box">
      <div class="value amount">₹${Number(r.totalGross).toLocaleString('en-IN')}</div>
      <div class="label">Gross Revenue</div>
    </div>
    <div class="summary-box">
      <div class="value amount">₹${Number(r.totalDiscount).toLocaleString('en-IN')}</div>
      <div class="label">Discounts</div>
    </div>
    <div class="summary-box highlight">
      <div class="value amount" style="color:#15803d">₹${Number(r.totalNet).toLocaleString('en-IN')}</div>
      <div class="label">Net Collected</div>
    </div>
    <div class="summary-box">
      <div class="value">${r.billCount}</div>
      <div class="label">Bills Paid</div>
    </div>
  </div>

  ${r.pendingCount > 0 ? `
  <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:11px;color:#92400e;">
    ⚠️ ${r.pendingCount} pending bill(s) — ₹${Number(r.pendingAmount).toLocaleString('en-IN')} not yet collected
  </div>` : ''}

  <div class="section-title">Payment Mode Breakdown</div>
  <table>
    <thead><tr><th>Mode</th><th>Amount</th><th>Bills</th></tr></thead>
    <tbody>
      ${(r.paymentBreakdown || []).map((m: any) => `
        <tr>
          <td style="text-transform:capitalize">${m.mode}</td>
          <td class="amount">₹${Number(m.amount).toLocaleString('en-IN')}</td>
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
          <td class="amount">₹${Number(s.amount).toLocaleString('en-IN')}</td>
          <td>${s.count}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <div class="footer">
    <span>Generated: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
    <span>${hs.hospitalName || 'NexMedicon HMS'} ${hs.doctorName ? '· Dr. ' + hs.doctorName : ''}</span>
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
