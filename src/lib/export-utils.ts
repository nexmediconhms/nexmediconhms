/**
 * export-utils.ts — Client-side data export utilities
 *
 * Provides:
 *   - CSV export with proper quoting (handles commas, newlines in data)
 *   - Indian date/currency formatting in exports
 *   - PDF-ready table data transformation
 *   - Clipboard copy for quick sharing
 *
 * USAGE:
 *   import { exportToCSV, copyTableToClipboard } from '@/lib/export-utils'
 *   exportToCSV(data, columns, 'patients-export')
 */

// ── Types ─────────────────────────────────────────────────────
interface ColumnDef<T> {
  key: keyof T | ((row: T) => string | number | boolean | null | undefined)
  header: string
  format?: (value: any, row: T) => string
}

// ── CSV Export ────────────────────────────────────────────────
/**
 * Export an array of objects as a downloadable CSV file.
 * Handles proper escaping, Indian date formats, and currency.
 */
export function exportToCSV<T extends Record<string, any>>(
  data: T[],
  columns: ColumnDef<T>[],
  filename: string
): void {
  if (data.length === 0) return

  const rows: string[] = []

  // Header row
  rows.push(columns.map(col => escapeCSV(col.header)).join(','))

  // Data rows
  for (const row of data) {
    const cells = columns.map(col => {
      let value: any
      if (typeof col.key === 'function') {
        value = col.key(row)
      } else {
        value = row[col.key]
      }

      if (col.format) {
        value = col.format(value, row)
      }

      return escapeCSV(String(value ?? ''))
    })
    rows.push(cells.join(','))
  }

  const csv = rows.join('\n')
  downloadBlob(csv, `${filename}.csv`, 'text/csv;charset=utf-8')
}

// ── JSON Export ───────────────────────────────────────────────
export function exportToJSON<T>(data: T[], filename: string): void {
  const json = JSON.stringify(data, null, 2)
  downloadBlob(json, `${filename}.json`, 'application/json')
}

// ── Copy to Clipboard (tab-separated for Excel paste) ─────────
export async function copyTableToClipboard<T extends Record<string, any>>(
  data: T[],
  columns: ColumnDef<T>[]
): Promise<boolean> {
  if (data.length === 0) return false

  const rows: string[] = []
  rows.push(columns.map(col => col.header).join('\t'))

  for (const row of data) {
    const cells = columns.map(col => {
      let value: any
      if (typeof col.key === 'function') {
        value = col.key(row)
      } else {
        value = row[col.key]
      }
      if (col.format) value = col.format(value, row)
      return String(value ?? '').replace(/\t/g, ' ').replace(/\n/g, ' ')
    })
    rows.push(cells.join('\t'))
  }

  try {
    await navigator.clipboard.writeText(rows.join('\n'))
    return true
  } catch {
    return false
  }
}

// ── Indian formatting helpers ─────────────────────────────────

/** Format number as Indian currency (₹1,23,456.00) */
export function formatINR(amount: number | string | null | undefined): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : (amount ?? 0)
  if (isNaN(num)) return '₹0'
  return '₹' + num.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

/** Format date as DD/MM/YYYY (Indian standard) */
export function formatDateIN(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return ''
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })
  } catch {
    return ''
  }
}

/** Format date as DD-Mon-YYYY (e.g., 15-Jan-2024) */
export function formatDateShort(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return ''
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return ''
  }
}

// ── Internal helpers ──────────────────────────────────────────

function escapeCSV(value: string): string {
  // If value contains comma, quote, or newline, wrap in quotes
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return '"' + value.replace(/"/g, '""') + '"'
  }
  return value
}

function downloadBlob(content: string, filename: string, mimeType: string): void {
  // Add BOM for UTF-8 CSV (helps Excel on Windows recognize Indian characters)
  const bom = mimeType.includes('csv') ? '\uFEFF' : ''
  const blob = new Blob([bom + content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
