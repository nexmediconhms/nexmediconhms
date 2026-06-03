/**
 * src/app/api/ipd/files/route.ts
 *
 * IPD File Management API — Upload photos/documents for IPD patients
 * 
 * Features:
 *  - Upload photos (wound photos, consent forms, etc.)
 *  - Upload documents (reports, prescriptions, etc.)
 *  - AI extraction of data from uploaded images/PDFs
 *  - List all files for an IPD admission
 *  - Delete files (admin/doctor only)
 *
 * POST /api/ipd/files — Upload a file
 *   Body (multipart/form-data):
 *     file: File
 *     ipd_admission_id: string (UUID)
 *     patient_id: string (UUID)
 *     category: string ('wound'|'report'|'xray'|'consent'|'prescription'|'nursing'|'general')
 *     description: string (optional)
 *     uploaded_by: string
 *     uploaded_by_role: string ('doctor'|'nurse'|'staff')
 *     extract_ai: string ('true'|'false') — whether to run AI extraction
 *
 * GET /api/ipd/files?admission_id=XXX — Get all files for an admission
 * DELETE /api/ipd/files?file_id=XXX — Delete a file
 *
 * SECURITY FIX: Added authentication to all endpoints
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, requireRole } from '@/lib/api-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
)

// MIME type detection by extension
const MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
  pdf: 'application/pdf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  return MIME_MAP[ext] || 'application/octet-stream'
}

// ── AI Extraction Helper ──────────────────────────────────────
// Uses OpenAI Vision API to extract structured data from medical images/docs
async function extractDataFromImage(
  base64Data: string,
  mimeType: string,
  category: string
): Promise<Record<string, any>> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return { _note: 'AI extraction skipped — OPENAI_API_KEY not configured' }
  }

  try {
    const systemPrompt = `You are a medical data extraction AI for an Indian hospital.
Extract structured data from this medical image/document.
Category: ${category}

Based on the category, extract relevant fields:
- wound: wound_size, wound_location, wound_type, healing_status, dressing_notes
- report: test_name, test_values (array of {name, value, unit, reference_range}), conclusion, date
- xray: findings, impression, area_examined
- consent: procedure_name, patient_consent_given, witness_name, date
- prescription: medications (array of {drug, dose, frequency, duration}), doctor_name
- nursing: observation, vitals_noted, action_taken
- general: description, key_findings

Return a JSON object with the extracted fields. If a field cannot be determined, omit it.
Be accurate and concise. Use Indian medical terminology where appropriate.`

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: `Extract medical data from this ${category} image/document.` },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${base64Data}`,
                  detail: 'high',
                },
              },
            ],
          },
        ],
        max_tokens: 1000,
        temperature: 0.1,
      }),
    })

    if (!response.ok) {
      console.error('[AI Extract] OpenAI error:', response.status)
      return { _error: 'AI extraction failed', _status: response.status }
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || ''

    // Try to parse JSON from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0])
      } catch {
        return { raw_extraction: content }
      }
    }

    return { raw_extraction: content }
  } catch (err: any) {
    console.error('[AI Extract] Error:', err.message)
    return { _error: err.message }
  }
}

// ── GET — List files for an admission ─────────────────────────
export async function GET(req: NextRequest) {
  // SECURITY FIX: Require authentication
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth
  
  const admissionId = req.nextUrl.searchParams.get('admission_id')
  const patientId = req.nextUrl.searchParams.get('patient_id')

  if (!admissionId && !patientId) {
    return NextResponse.json({ error: 'admission_id or patient_id required' }, { status: 400 })
  }

  let query = supabase.from('ipd_files').select('*').order('created_at', { ascending: false })

  if (admissionId) {
    query = query.eq('ipd_admission_id', admissionId)
  } else if (patientId) {
    query = query.eq('patient_id', patientId)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ files: data || [], total: (data || []).length })
}

// ── POST — Upload a file ──────────────────────────────────────
export async function POST(req: NextRequest) {
  // SECURITY FIX: Require authentication
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth
  
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const ipdAdmissionId = formData.get('ipd_admission_id') as string
    const patientId = formData.get('patient_id') as string
    const category = (formData.get('category') as string) || 'general'
    const description = (formData.get('description') as string) || ''
    const uploadedBy = (formData.get('uploaded_by') as string) || 'Staff'
    const uploadedByRole = (formData.get('uploaded_by_role') as string) || 'nurse'
    const extractAI = formData.get('extract_ai') === 'true'

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }
    if (!ipdAdmissionId || !patientId) {
      return NextResponse.json({ error: 'ipd_admission_id and patient_id required' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const base64 = buffer.toString('base64')
    const mimeType = getMimeType(file.name) || file.type || 'application/octet-stream'
    const fileSize = buffer.length

    // Try to upload to Supabase Storage first
    let storageKey: string | null = null
    let fileUrl: string | null = null
    let fileData: string | null = null

    const storagePath = `ipd/${patientId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`

    const { error: uploadError } = await supabase.storage
      .from('ipd-files')
      .upload(storagePath, buffer, {
        contentType: mimeType,
        upsert: false,
      })

    if (!uploadError) {
      storageKey = storagePath
      const { data: urlData } = supabase.storage.from('ipd-files').getPublicUrl(storagePath)
      fileUrl = urlData?.publicUrl || null
    } else {
      // Fallback: store as base64 in DB (for files < 5MB)
      if (fileSize <= 5 * 1024 * 1024) {
        fileData = `data:${mimeType};base64,${base64}`
      } else {
        return NextResponse.json(
          { error: 'File too large for DB storage and Supabase Storage unavailable' },
          { status: 413 }
        )
      }
    }

    // AI extraction (if requested and file is an image or PDF)
    let aiExtractedData: Record<string, any> = {}
    if (extractAI && (mimeType.startsWith('image/') || mimeType === 'application/pdf')) {
      aiExtractedData = await extractDataFromImage(base64, mimeType, category)
    }

    // Save record to database
    const { data: record, error: insertError } = await supabase
      .from('ipd_files')
      .insert({
        ipd_admission_id: ipdAdmissionId,
        patient_id: patientId,
        file_name: file.name,
        file_type: mimeType,
        file_size: fileSize,
        storage_key: storageKey,
        file_url: fileUrl,
        file_data: fileData,
        category,
        description,
        ai_extracted_data: aiExtractedData,
        uploaded_by: uploadedBy,
        uploaded_by_role: uploadedByRole,
      })
      .select()
      .single()

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      file: record,
      ai_data: aiExtractedData,
      message: 'File uploaded successfully',
    })
  } catch (err: any) {
    console.error('[IPD Files POST] Error:', err)
    return NextResponse.json({ error: err.message || 'Upload failed' }, { status: 500 })
  }
}

// ── DELETE — Remove a file ────────────────────────────────────
export async function DELETE(req: NextRequest) {
  // SECURITY FIX: Admin/Doctor only
  const auth = await requireRole(req, ['admin', 'doctor'])
  if (auth instanceof Response) return auth
  
  const fileId = req.nextUrl.searchParams.get('file_id')
  if (!fileId) {
    return NextResponse.json({ error: 'file_id required' }, { status: 400 })
  }

  // Get the file record first
  const { data: file } = await supabase
    .from('ipd_files')
    .select('storage_key')
    .eq('id', fileId)
    .single()

  // Delete from storage if key exists
  if (file?.storage_key) {
    await supabase.storage.from('ipd-files').remove([file.storage_key])
  }

  // Delete DB record
  const { error } = await supabase.from('ipd_files').delete().eq('id', fileId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, message: 'File deleted' })
}