/**
 * src/app/api/medicines/import/route.ts
 *
 * Admin-only API for importing medicines from CSV.
 * Stores custom medicines in clinic_settings under key 'custom_medicines'.
 * Merges with the static drug database at runtime via getAllDrugs().
 *
 * CSV columns (header row required):
 *   generic, brands, category, forms, strengths,
 *   defaultDose, defaultFrequency, defaultDuration, defaultRoute, pregnancyCategory
 *
 * - brands, forms, strengths are pipe-separated (|) within the CSV cell
 *   e.g. "Dolo|Crocin|Calpol" for brands
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/api-auth'
import type { DrugEntry } from '@/lib/drug-database'

const SETTINGS_KEY = 'custom_medicines'

// Parse CSV text into DrugEntry[]
function parseCSV(csvText: string): { entries: DrugEntry[]; errors: string[] } {
  const entries: DrugEntry[] = []
  const errors: string[] = []

  const lines = csvText.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) {
    errors.push('CSV must have a header row and at least one data row.')
    return { entries, errors }
  }

  const headerLine = lines[0].toLowerCase()
  const headers = parseCSVRow(headerLine)

  // Validate required columns
  const requiredCols = ['generic', 'category']
  for (const col of requiredCols) {
    if (!headers.includes(col)) {
      errors.push(`Missing required column: "${col}". Found: ${headers.join(', ')}`)
      return { entries, errors }
    }
  }

  const colIdx = (name: string) => headers.indexOf(name)

  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVRow(lines[i])
    if (row.length === 0 || (row.length === 1 && !row[0].trim())) continue

    const generic = (row[colIdx('generic')] || '').trim()
    if (!generic) {
      errors.push(`Row ${i + 1}: missing generic name, skipped.`)
      continue
    }

    const entry: DrugEntry = {
      generic,
      brands: splitPipe(row[colIdx('brands')] || ''),
      category: (row[colIdx('category')] || 'General').trim(),
      forms: splitPipe(row[colIdx('forms')] || 'tablet'),
      strengths: splitPipe(row[colIdx('strengths')] || ''),
      defaultDose: (row[colIdx('defaultdose')] || row[colIdx('default_dose')] || '').trim(),
      defaultFrequency: (row[colIdx('defaultfrequency')] || row[colIdx('default_frequency')] || 'Once daily').trim(),
      defaultDuration: (row[colIdx('defaultduration')] || row[colIdx('default_duration')] || '5 days').trim(),
      defaultRoute: (row[colIdx('defaultroute')] || row[colIdx('default_route')] || 'Oral').trim(),
      pregnancyCategory: (row[colIdx('pregnancycategory')] || row[colIdx('pregnancy_category')] || 'B').trim().toUpperCase(),
      interactionFlags: splitPipe(row[colIdx('interactionflags')] || row[colIdx('interaction_flags')] || ''),
      notes: (row[colIdx('notes')] || '').trim() || undefined,
    }

    entries.push(entry)
  }

  return { entries, errors }
}

// Parse a single CSV row, handling quoted fields with commas
function parseCSVRow(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++ // skip escaped quote
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result
}

// Split pipe-separated values
function splitPipe(val: string): string[] {
  if (!val.trim()) return []
  return val.split('|').map(s => s.trim()).filter(Boolean)
}

/**
 * POST — Import medicines from CSV upload
 */
export async function POST(req: NextRequest) {
  const auth = await requireRole(req, 'admin')
  if (auth instanceof Response) return auth

  try {
    const contentType = req.headers.get('content-type') || ''
    let csvText = ''

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      const file = formData.get('file') as File | null
      if (!file) {
        return NextResponse.json({ error: 'No file uploaded. Send a CSV file with field name "file".' }, { status: 400 })
      }
      csvText = await file.text()
    } else {
      // Accept raw CSV text in body
      const body = await req.json()
      csvText = body.csv || ''
    }

    if (!csvText.trim()) {
      return NextResponse.json({ error: 'Empty CSV content.' }, { status: 400 })
    }

    const { entries, errors } = parseCSV(csvText)

    if (entries.length === 0) {
      return NextResponse.json({
        error: 'No valid medicines found in CSV.',
        parseErrors: errors,
      }, { status: 400 })
    }

    // Store in clinic_settings
    const admin = getAdminClient()

    // Fetch existing custom medicines to merge (append, deduplicate by generic name)
    const { data: existing } = await admin
      .from('clinic_settings')
      .select('value')
      .eq('key', SETTINGS_KEY)
      .maybeSingle()

    let existingEntries: DrugEntry[] = []
    if (existing?.value) {
      try { existingEntries = JSON.parse(existing.value) } catch { /* ignore corrupt */ }
    }

    // Merge: new entries override existing ones with same generic name (case-insensitive)
    const merged = [...existingEntries]
    for (const entry of entries) {
      const idx = merged.findIndex(e => e.generic.toLowerCase() === entry.generic.toLowerCase())
      if (idx >= 0) {
        merged[idx] = entry // update existing
      } else {
        merged.push(entry) // add new
      }
    }

    const { error: writeErr } = await admin
      .from('clinic_settings')
      .upsert(
        { key: SETTINGS_KEY, value: JSON.stringify(merged), updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      )

    if (writeErr) {
      return NextResponse.json({ error: `Failed to save: ${writeErr.message}` }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      imported: entries.length,
      totalCustomMedicines: merged.length,
      parseErrors: errors.length > 0 ? errors : undefined,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Import failed' }, { status: 500 })
  }
}

/**
 * GET — Download current custom medicines as JSON (for admin review)
 */
export async function GET(req: NextRequest) {
  const auth = await requireRole(req, 'admin')
  if (auth instanceof Response) return auth

  try {
    const admin = getAdminClient()
    const { data } = await admin
      .from('clinic_settings')
      .select('value')
      .eq('key', SETTINGS_KEY)
      .maybeSingle()

    const medicines: DrugEntry[] = data?.value ? JSON.parse(data.value) : []

    return NextResponse.json({
      count: medicines.length,
      medicines,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

/**
 * DELETE — Clear all custom medicines (admin only)
 */
export async function DELETE(req: NextRequest) {
  const auth = await requireRole(req, 'admin')
  if (auth instanceof Response) return auth

  try {
    const admin = getAdminClient()
    await admin.from('clinic_settings').delete().eq('key', SETTINGS_KEY)
    return NextResponse.json({ success: true, message: 'Custom medicines cleared.' })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
