/**
 * src/lib/medicine-importer.ts
 *
 * Client-side helper for the Medicine Database Bulk Import API.
 *
 * Supports uploading CSV or Excel (.xlsx/.xls) files with automatic
 * upsert logic — matching by SKU/Code/Name to update existing records
 * or insert new ones.
 *
 * USAGE:
 *   import { importMedicines, downloadTemplate } from '@/lib/medicine-importer'
 *
 *   // Upload a file
 *   const result = await importMedicines(file, 'upsert')
 *   if (result.success) {
 *     console.log(`Imported: ${result.result.inserted} new, ${result.result.updated} updated`)
 *   }
 *
 *   // Download CSV template
 *   downloadTemplate()
 */

import { supabase } from '@/lib/supabase'

export type ImportMode = 'upsert' | 'insert_only' | 'update_only'

export interface ImportResult {
  success: boolean
  result?: {
    total_rows: number
    inserted: number
    updated: number
    skipped: number
    errors: number
    error_details: { row: number; message: string }[]
  }
  parse_errors?: string[]
  message?: string
  error?: string
}

/**
 * Upload a medicine file (CSV/Excel) to the bulk import API.
 */
export async function importMedicines(
  file: File,
  mode: ImportMode = 'upsert'
): Promise<ImportResult> {
  // Validate file type
  const validTypes = ['.csv', '.tsv', '.xlsx', '.xls']
  const ext = '.' + file.name.split('.').pop()?.toLowerCase()
  if (!validTypes.includes(ext)) {
    return {
      success: false,
      error: `Unsupported file type "${ext}". Please use CSV (.csv) or Excel (.xlsx, .xls).`,
    }
  }

  // Validate file size (10MB max)
  if (file.size > 10 * 1024 * 1024) {
    return {
      success: false,
      error: `File too large (${Math.round(file.size / 1024 / 1024)}MB). Maximum is 10MB.`,
    }
  }

  try {
    // Get auth token
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) {
      return { success: false, error: 'Not authenticated. Please log in as admin.' }
    }

    // Build FormData
    const formData = new FormData()
    formData.append('file', file)
    formData.append('mode', mode)

    const res = await fetch('/api/medicines/bulk-import', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      body: formData,
    })

    const data = await res.json()

    if (!res.ok) {
      return {
        success: false,
        error: data.error || `HTTP ${res.status}`,
        parse_errors: data.parse_errors,
      }
    }

    return {
      success: true,
      result: data.result,
      parse_errors: data.parse_errors,
      message: data.message,
    }
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error during upload' }
  }
}

/**
 * Download a CSV template for medicine import.
 * Creates a CSV file with correct headers and 2 example rows.
 */
export function downloadTemplate() {
  const headers = [
    'name', 'generic_name', 'brand_name', 'sku_code', 'form', 'strength',
    'category', 'manufacturer', 'mrp', 'selling_price', 'current_stock',
    'min_stock', 'unit', 'batch_number', 'expiry_date',
  ]

  const exampleRows = [
    [
      'Paracetamol 500mg', 'Paracetamol', 'Dolo', 'MED-001', 'tablet', '500mg',
      'Analgesics', 'Micro Labs', '25.50', '22.00', '500',
      '50', 'strip', 'B2024-001', '2027-12-31',
    ],
    [
      'Amoxicillin 250mg', 'Amoxicillin', 'Mox', 'MED-002', 'capsule', '250mg',
      'Antibiotics', 'Cipla', '85.00', '75.00', '200',
      '30', 'strip', 'B2024-002', '2026-06-30',
    ],
  ]

  const csv = [
    headers.join(','),
    ...exampleRows.map(row => row.map(cell => `"${cell}"`).join(',')),
  ].join('\n')

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'medicine_import_template.csv'
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Validate a file before upload (quick client-side checks).
 */
export function validateImportFile(file: File): { valid: boolean; error?: string } {
  if (!file) return { valid: false, error: 'No file selected' }

  const ext = '.' + (file.name.split('.').pop()?.toLowerCase() || '')
  const validExts = ['.csv', '.tsv', '.xlsx', '.xls']

  if (!validExts.includes(ext)) {
    return {
      valid: false,
      error: `Unsupported format "${ext}". Use CSV (.csv) or Excel (.xlsx, .xls).`,
    }
  }

  if (file.size === 0) {
    return { valid: false, error: 'File is empty' }
  }

  if (file.size > 10 * 1024 * 1024) {
    return {
      valid: false,
      error: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max 10MB.`,
    }
  }

  return { valid: true }
}