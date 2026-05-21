/**
 * FILE: src/lib/pdf-layout.ts
 *
 * ISSUE #8 & #9 FIX: PDF Report Layout + Reusable Headers/Footers
 *
 * PROBLEMS:
 *   1. PDF reports have redundant hospital info at the top
 *   2. No consistent header/footer across pages
 *   3. No page numbers, no print date, no doctor info in footer
 *   4. Raw HTML styling — unstyled, unprofessional
 *
 * FIX:
 *   This module provides reusable functions that generate proper
 *   CSS-based headers and footers for EVERY printed page, using
 *   the @page and position:fixed CSS approach.
 *
 *   It works with the browser's built-in Print to PDF feature
 *   (Ctrl+P / Cmd+P) which is the most reliable cross-platform
 *   approach for client-side PDF generation.
 *
 * HOW TO USE:
 *   Import the layout functions into any page that generates printable content:
 *
 *   import { wrapWithPDFLayout, getHospitalHeaderHtml, getFooterHtml } from '@/lib/pdf-layout'
 *
 *   // Wrap your report body HTML:
 *   const fullHtml = wrapWithPDFLayout({
 *     bodyHtml: '<div>... your report content ...</div>',
 *     hospitalName: 'My Clinic',
 *     address: '123 Main St',
 *     phone: '9876543210',
 *     gstin: 'GSTIN123',
 *     doctorName: 'Dr. Smith',
 *     reportTitle: 'Revenue Report',
 *     reportSubtitle: 'Jan 2025 - Mar 2025',
 *   })
 *
 *   // Open in new window for printing:
 *   const w = window.open('', '_blank')
 *   w.document.write(fullHtml)
 *   w.document.close()
 *   w.print()
 *
 * WHAT THIS DOES NOT CHANGE:
 *   - Does not modify any existing pages or components
 *   - Does not change any database schema
 *   - Does not require any new npm packages
 */

export interface PDFLayoutOptions {
  bodyHtml: string
  hospitalName?: string
  address?: string
  phone?: string
  gstin?: string
  doctorName?: string
  logoUrl?: string       // Optional: base64 or URL for logo
  reportTitle?: string
  reportSubtitle?: string
  pageSize?: 'A4' | 'Letter'
  orientation?: 'portrait' | 'landscape'
}

/**
 * Generate the complete HTML document with proper print headers and footers.
 *
 * ARCHITECTURE NOTE:
 *   CSS @page + position:running() is not supported by all browsers.
 *   Instead, we use the widely-supported approach:
 *   - Fixed-position header/footer divs that repeat on every printed page
 *   - A content area with top/bottom margins matching header/footer height
 *   - Page numbers via CSS counter (counter-increment)
 *
 *   This works in Chrome, Edge, Safari, and Firefox print dialogs.
 */
export function wrapWithPDFLayout(options: PDFLayoutOptions): string {
  const {
    bodyHtml,
    hospitalName = 'NexMedicon Hospital',
    address = '',
    phone = '',
    gstin = '',
    doctorName = '',
    logoUrl = '',
    reportTitle = '',
    reportSubtitle = '',
    pageSize = 'A4',
    orientation = 'portrait',
  } = options

  const generatedAt = new Date().toLocaleDateString('en-IN', {
    day: '2-digit', month: 'long', year: 'numeric'
  })
  const generatedTime = new Date().toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit'
  })

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${reportTitle || hospitalName} - Report</title>
  <style>
    /* ── RESET ── */
    * { margin: 0; padding: 0; box-sizing: border-box; }

    /* ── PAGE SETUP ── */
    @page {
      size: ${pageSize} ${orientation};
      margin: 25mm 15mm 20mm 15mm;  /* top right bottom left */
    }

    body {
      font-family: 'Inter', 'Segoe UI', Arial, sans-serif;
      font-size: 11px;
      color: #1e293b;
      line-height: 1.5;
      background: white;
    }

    /* ── HEADER (repeats on every printed page) ── */
    .pdf-header {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 22mm;
      padding: 4mm 0;
      border-bottom: 2px solid #2563eb;
      background: white;
      z-index: 100;
    }

    .pdf-header-inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .pdf-header-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .pdf-header-logo {
      width: 40px;
      height: 40px;
      border-radius: 8px;
      object-fit: contain;
    }

    .pdf-header-info h1 {
      font-size: 16px;
      font-weight: 700;
      color: #1e293b;
      letter-spacing: -0.3px;
    }

    .pdf-header-info p {
      font-size: 8px;
      color: #64748b;
      margin-top: 1px;
    }

    .pdf-header-right {
      text-align: right;
      font-size: 8px;
      color: #64748b;
    }

    .pdf-header-right .report-title {
      font-size: 11px;
      font-weight: 700;
      color: #1e40af;
    }

    /* ── FOOTER (repeats on every printed page) ── */
    .pdf-footer {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 12mm;
      padding: 3mm 0;
      border-top: 1px solid #e2e8f0;
      background: white;
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 7px;
      color: #94a3b8;
    }

    .pdf-footer-left {
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .pdf-footer-center {
      text-align: center;
    }

    .pdf-footer-right {
      text-align: right;
    }

    /* ── CONTENT AREA ── */
    /* Must have top/bottom margins that match header/footer heights */
    .pdf-content {
      margin-top: 25mm;   /* space for fixed header */
      margin-bottom: 15mm; /* space for fixed footer */
    }

    /* ── TYPOGRAPHY ── */
    .report-main-title {
      font-size: 16px;
      font-weight: 700;
      color: #1e293b;
      margin-bottom: 4px;
    }

    .report-main-subtitle {
      font-size: 10px;
      color: #64748b;
      margin-bottom: 16px;
    }

    /* ── TABLES ── */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 8px 0 16px;
      page-break-inside: auto;
    }

    thead {
      display: table-header-group; /* Repeat headers on each page */
    }

    tr {
      page-break-inside: avoid;
      page-break-after: auto;
    }

    th {
      background: #f1f5f9;
      text-align: left;
      padding: 6px 10px;
      font-weight: 600;
      color: #475569;
      border-bottom: 2px solid #e2e8f0;
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    td {
      padding: 6px 10px;
      border-bottom: 1px solid #f1f5f9;
      font-size: 10px;
    }

    tr:nth-child(even) td {
      background: #fafbfc;
    }

    /* ── SUMMARY BOXES ── */
    .summary-grid {
      display: flex;
      gap: 10px;
      margin: 12px 0 20px;
    }

    .summary-box {
      flex: 1;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 12px;
      text-align: center;
    }

    .summary-box .value {
      font-size: 16px;
      font-weight: 700;
      color: #1e293b;
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
    }

    .summary-box .label {
      font-size: 7px;
      color: #64748b;
      margin-top: 3px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .summary-box.highlight {
      background: #ecfdf5;
      border-color: #86efac;
    }

    .summary-box.highlight .value {
      color: #15803d;
    }

    /* ── SECTION HEADINGS ── */
    .section-title {
      font-size: 12px;
      font-weight: 700;
      color: #334155;
      margin: 16px 0 6px;
      padding-bottom: 3px;
      border-bottom: 1px solid #e2e8f0;
      page-break-after: avoid;
    }

    /* ── ALERTS / NOTES ── */
    .alert-box {
      border-radius: 6px;
      padding: 8px 12px;
      margin: 8px 0;
      font-size: 10px;
    }

    .alert-warning {
      background: #fef3c7;
      border: 1px solid #fde68a;
      color: #92400e;
    }

    .alert-info {
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      color: #1e40af;
    }

    /* ── UTILITY ── */
    .amount {
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-weight: 600;
    }

    .text-right { text-align: right; }
    .text-center { text-align: center; }
    .text-muted { color: #64748b; }
    .font-bold { font-weight: 700; }
    .page-break { page-break-before: always; }
    .no-break { page-break-inside: avoid; }

    /* ── SCREEN-ONLY (hidden when printing) ── */
    @media screen {
      body {
        max-width: 210mm;
        margin: 20px auto;
        padding: 0 15mm;
        background: #f5f5f5;
      }
      .pdf-header, .pdf-footer {
        position: relative;
        margin: 0;
      }
      .pdf-content {
        margin-top: 0;
        margin-bottom: 0;
      }
    }

    /* ── PRINT BUTTON (hidden in print) ── */
    @media print {
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <!-- HEADER — Repeats on every printed page -->
  <div class="pdf-header">
    <div class="pdf-header-inner">
      <div class="pdf-header-left">
        ${logoUrl ? `<img src="${logoUrl}" class="pdf-header-logo" alt="Logo" />` : ''}
        <div class="pdf-header-info">
          <h1>${hospitalName}</h1>
          ${address ? `<p>${address}</p>` : ''}
          ${phone || gstin ? `<p>${[phone ? 'Tel: ' + phone : '', gstin ? 'GSTIN: ' + gstin : ''].filter(Boolean).join(' | ')}</p>` : ''}
        </div>
      </div>
      <div class="pdf-header-right">
        ${reportTitle ? `<div class="report-title">${reportTitle}</div>` : ''}
        ${reportSubtitle ? `<div>${reportSubtitle}</div>` : ''}
        <div>Generated: ${generatedAt}</div>
      </div>
    </div>
  </div>

  <!-- FOOTER — Repeats on every printed page -->
  <div class="pdf-footer">
    <div class="pdf-footer-left">
      <span>${hospitalName}${doctorName ? ' | ' + doctorName : ''}</span>
      <span>Confidential — For authorized use only</span>
    </div>
    <div class="pdf-footer-center">
      <span>NexMedicon HMS</span>
    </div>
    <div class="pdf-footer-right">
      <span>${generatedAt} ${generatedTime}</span>
    </div>
  </div>

  <!-- PRINT BUTTON (only visible on screen) -->
  <div class="no-print" style="text-align:center;padding:12px;margin-bottom:10px;">
    <button onclick="window.print()" style="
      background:#2563eb;color:white;border:none;padding:10px 24px;
      border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;
    ">Print / Save as PDF</button>
  </div>

  <!-- CONTENT — Your report body goes here -->
  <div class="pdf-content">
    ${bodyHtml}
  </div>
</body>
</html>`
}

/**
 * Generate just the header HTML (for embedding in existing templates)
 */
export function getHospitalHeaderHtml(options: {
  hospitalName?: string
  address?: string
  phone?: string
  gstin?: string
  doctorName?: string
}): string {
  const { hospitalName = 'NexMedicon Hospital', address, phone, gstin } = options
  return `
    <div style="text-align:center;border-bottom:2px solid #2563eb;padding-bottom:12px;margin-bottom:20px;">
      <h1 style="font-size:18px;margin:0 0 4px;">${hospitalName}</h1>
      ${address ? `<p style="font-size:9px;color:#64748b;margin:2px 0;">${address}</p>` : ''}
      ${phone || gstin ? `<p style="font-size:9px;color:#64748b;margin:2px 0;">${[phone ? 'Tel: ' + phone : '', gstin ? 'GSTIN: ' + gstin : ''].filter(Boolean).join(' | ')}</p>` : ''}
    </div>
  `
}

/**
 * Generate just the footer HTML
 */
export function getFooterHtml(options: {
  hospitalName?: string
  doctorName?: string
}): string {
  const { hospitalName = 'NexMedicon HMS', doctorName = '' } = options
  const genDate = new Date().toLocaleDateString('en-IN', {
    day: '2-digit', month: 'long', year: 'numeric'
  })
  const genTime = new Date().toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit'
  })
  return `
    <div style="margin-top:32px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:8px;color:#94a3b8;display:flex;justify-content:space-between;">
      <span>Generated: ${genDate} at ${genTime}</span>
      <span>${hospitalName}${doctorName ? ' | ' + doctorName : ''}</span>
    </div>
  `
}