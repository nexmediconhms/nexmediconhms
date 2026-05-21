/**
 * src/lib/pdf-layout.ts
 *
 * Reusable PDF header/footer layout for ALL printed reports.
 *
 * USAGE:
 *   Import getPDFHeaderHTML() and getPDFFooterHTML() in any report that
 *   generates printable content via window.open() + window.print().
 *
 * This ensures EVERY printed page includes:
 *   - Hospital name, address, phone in header
 *   - Doctor name and qualification
 *   - Page numbering in footer
 *   - Generation timestamp
 *   - Consistent branding colors
 *
 * For @react-pdf/renderer PDFs (prescriptions, bills), the header/footer
 * is already embedded in pdf-generator.tsx. This file is for HTML-based
 * reports (CA report, fund report, lab revenue report).
 */

export interface PDFLayoutSettings {
  hospitalName: string
  address?: string
  phone?: string
  gstin?: string
  regNo?: string
  doctorName?: string
  doctorQual?: string
  logoUrl?: string
}

/**
 * Returns the full HTML document wrapper with print-optimized CSS,
 * header, and footer for any report content.
 */
export function wrapReportHTML(params: {
  settings: PDFLayoutSettings
  title: string
  subtitle?: string
  content: string
}): string {
  const { settings: hs, title, subtitle, content } = params

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title} — ${hs.hospitalName}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      color: #1e293b;
      margin: 0;
      padding: 0;
      font-size: 11px;
      line-height: 1.5;
    }

    /* ═══ PAGE LAYOUT ═══ */
    @page {
      size: A4;
      margin: 12mm 10mm 20mm 10mm;
    }

    .page-content {
      padding: 24px 32px;
      min-height: calc(100vh - 140px);
    }

    /* ═══ HEADER ═══ */
    .report-header {
      text-align: center;
      border-bottom: 3px solid #1e40af;
      padding: 16px 32px 12px;
      margin-bottom: 0;
      background: linear-gradient(180deg, #f8fafc 0%, #ffffff 100%);
    }
    .report-header h1 {
      font-size: 20px;
      color: #1e40af;
      margin: 0 0 2px;
      font-weight: 800;
      letter-spacing: 0.3px;
    }
    .report-header .address {
      font-size: 10px;
      color: #64748b;
      margin: 1px 0;
    }
    .report-header .contact {
      font-size: 10px;
      color: #64748b;
      margin: 1px 0;
    }
    .report-header .doctor {
      font-size: 11px;
      color: #1e40af;
      font-weight: 600;
      margin-top: 4px;
    }

    /* ═══ REPORT TITLE ═══ */
    .report-title-section {
      padding: 12px 32px 8px;
      border-bottom: 1px solid #e2e8f0;
      margin-bottom: 16px;
    }
    .report-title-section h2 {
      font-size: 14px;
      font-weight: 700;
      color: #1e293b;
      margin: 0 0 2px;
    }
    .report-title-section .subtitle {
      font-size: 10px;
      color: #64748b;
    }

    /* ═══ FOOTER ═══ */
    .report-footer {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      padding: 8px 32px;
      border-top: 2px solid #1e40af;
      background: white;
      font-size: 8px;
      color: #94a3b8;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .report-footer .left { line-height: 1.4; }
    .report-footer .right { text-align: right; line-height: 1.4; }

    /* ═══ CONTENT STYLES ═══ */
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin-bottom: 20px;
    }
    .summary-box {
      background: #f8fafc;
      border: 1.5px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px;
      text-align: center;
    }
    .summary-box .value {
      font-size: 16px;
      font-weight: 700;
      color: #1e293b;
      font-family: 'SF Mono', 'Fira Code', monospace;
    }
    .summary-box .label {
      font-size: 8px;
      color: #64748b;
      margin-top: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .highlight-box { background: #ecfdf5 !important; border-color: #86efac !important; }
    .highlight-box .value { color: #15803d !important; }

    table {
      width: 100%;
      border-collapse: collapse;
      margin: 10px 0;
      font-size: 10px;
    }
    th {
      background: #1e40af;
      color: white;
      text-align: left;
      padding: 7px 10px;
      font-weight: 600;
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    td {
      padding: 7px 10px;
      border-bottom: 1px solid #f1f5f9;
    }
    tr:nth-child(even) td { background: #f8fafc; }
    .amount { font-family: 'SF Mono', monospace; font-weight: 600; }
    .section-title {
      font-size: 11px;
      font-weight: 700;
      color: #334155;
      margin: 16px 0 6px;
      padding-bottom: 3px;
      border-bottom: 1.5px solid #e2e8f0;
    }

    /* Print-specific */
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .no-print { display: none !important; }
      .report-footer { position: fixed; bottom: 0; }
    }

    /* Screen preview */
    @media screen {
      body { background: #f1f5f9; }
      .page-wrapper {
        max-width: 210mm;
        margin: 20px auto;
        background: white;
        box-shadow: 0 4px 24px rgba(0,0,0,0.1);
        border-radius: 4px;
        overflow: hidden;
      }
    }
  </style>
</head>
<body>
  <div class="page-wrapper">
    <!-- HEADER -->
    <div class="report-header">
      <h1>${hs.hospitalName}</h1>
      ${hs.address && hs.address !== 'Your Hospital Address, City, PIN' ? `<p class="address">${hs.address}</p>` : ''}
      ${hs.phone ? `<p class="contact">Tel: ${hs.phone}${hs.gstin ? ' | GSTIN: ' + hs.gstin : ''}</p>` : ''}
      ${hs.doctorName ? `<p class="doctor">Dr. ${hs.doctorName}${hs.doctorQual ? ' — ' + hs.doctorQual : ''}${hs.regNo ? ' | Reg: ' + hs.regNo : ''}</p>` : ''}
    </div>

    <!-- REPORT TITLE -->
    <div class="report-title-section">
      <h2>${title}</h2>
      ${subtitle ? `<p class="subtitle">${subtitle}</p>` : ''}
    </div>

    <!-- CONTENT -->
    <div class="page-content">
      ${content}
    </div>

    <!-- FOOTER -->
    <div class="report-footer">
      <div class="left">
        Generated: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })} at ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}<br>
        ${hs.hospitalName}${hs.regNo ? ' · Reg: ' + hs.regNo : ''}
      </div>
      <div class="right">
        ${hs.doctorName ? 'Dr. ' + hs.doctorName : ''}<br>
        This is a computer-generated report.
      </div>
    </div>
  </div>

  <script>
    // Auto-print when opened in new window
    if (window.opener) {
      window.onload = function() { setTimeout(function() { window.print(); }, 500); }
    }
  </script>
</body>
</html>`
}

/**
 * Open a report in a new printable window with proper headers/footers.
 * Call this from client components instead of raw window.open().
 */
export function openPrintableReport(params: {
  settings: PDFLayoutSettings
  title: string
  subtitle?: string
  content: string
}) {
  const html = wrapReportHTML(params)
  const w = window.open('', '_blank')
  if (w) {
    w.document.write(html)
    w.document.close()
  }
}
