/**
 * src/app/api/export/route.ts  — UPDATED v2
 *
 * Data Export API with AES-256-GCM Encryption option
 *
 * Formats:
 *   - json:          Plain JSON bundle (original)
 *   - csv:           Plain CSV multi-table format (original)
 *   - json-encrypted: AES-256-GCM encrypted JSON (PHI-safe)
 *   - fhir:          FHIR R4 Bundle format (unencrypted)
 *
 * Encryption:
 *   Uses HOSPITAL_ENCRYPTION_KEY env var (64 hex chars = 256-bit key)
 *   Output: { iv, ciphertext, tag, algorithm, exportedAt } — all base64
 *   Decrypt with the same key using AES-256-GCM
 *
 * Query params:
 *   format = 'json' | 'csv' | 'json-encrypted' | 'fhir'
 *   table  = table name or 'all'
 *   from   = ISO date string (created_at >= from)
 *   to     = ISO date string (created_at <= to)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createCipheriv, randomBytes } from 'crypto'
import { getAdminClient } from '@/lib/supabase'
import { requireRole } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// ── AES-256-GCM Encryption ───────────────────────────────────

function encryptData(plaintext: string): {
  iv: string
  ciphertext: string
  tag: string
  algorithm: string
} {
  const keyHex = process.env.HOSPITAL_ENCRYPTION_KEY
  if (!keyHex || keyHex.length !== 64) {
    throw new Error(
      'HOSPITAL_ENCRYPTION_KEY not configured (must be 64 hex characters). ' +
      'Set this in Vercel Environment Variables before using encrypted export.'
    )
  }

  const key = Buffer.from(keyHex, 'hex')  // 32 bytes = 256 bits
  const iv = randomBytes(12)               // 96-bit IV for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv)

  let encrypted = cipher.update(plaintext, 'utf8', 'base64')
  encrypted += cipher.final('base64')

  const tag = cipher.getAuthTag()

  return {
    iv: iv.toString('base64'),
    ciphertext: encrypted,
    tag: tag.toString('base64'),
    algorithm: 'aes-256-gcm',
  }
}

// ── Export tables ─────────────────────────────────────────────

const ALL_TABLES = [
  'patients', 'encounters', 'prescriptions', 'lab_reports',
  'bills', 'patient_allergies', 'appointments',
]

export async function GET(req: NextRequest) {
  // ── Auth gate: admin only ────────────────────────────────────
  const auth = await requireRole(req, 'admin')
  if (auth instanceof Response) return auth
  // ────────────────────────────────────────────────────────────

  try {
    const admin = getAdminClient()

    // Parse query params
    const { searchParams } = new URL(req.url)
    const format = searchParams.get('format') || 'json'
    const table  = searchParams.get('table')  || 'all'
    const from   = searchParams.get('from')
    const to     = searchParams.get('to')

    const tables = table === 'all' ? ALL_TABLES : [table]

    const exportData: Record<string, any[]> = {}

    for (const t of tables) {
      try {
        let query = admin.from(t).select('*')

        if (from) query = query.gte('created_at', from)
        if (to)   query = query.lte('created_at', to)

        query = query.order('created_at', { ascending: false })

        const { data, error } = await query
        if (!error && data) exportData[t] = data
      } catch {
        exportData[t] = []
      }
    }

    // Audit the export
    const totalRecords = Object.values(exportData).reduce((s, r) => s + r.length, 0)
    const isEncrypted = format === 'json-encrypted'
    await audit('export', 'patient', undefined, `${table} (${totalRecords} records, ${isEncrypted ? 'encrypted' : format})`)

    // ── CSV format ────────────────────────────────────────────
    if (format === 'csv') {
      const csvParts: string[] = []
      for (const [tableName, rows] of Object.entries(exportData)) {
        if (rows.length === 0) continue
        const headers = Object.keys(rows[0])
        csvParts.push(`\n--- ${tableName.toUpperCase()} ---`)
        csvParts.push(headers.join(','))
        for (const row of rows) {
          csvParts.push(headers.map(h => {
            const val = row[h]
            if (val === null || val === undefined) return ''
            const str = typeof val === 'object' ? JSON.stringify(val) : String(val)
            return str.includes(',') || str.includes('"') || str.includes('\n')
              ? `"${str.replace(/"/g, '""')}"`
              : str
          }).join(','))
        }
      }

      return new NextResponse(csvParts.join('\n'), {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="nexmedicon-export-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      })
    }

    // ── FHIR R4 Bundle format ─────────────────────────────────
    if (format === 'fhir') {
      const fhirBundle = {
        resourceType: 'Bundle',
        type: 'collection',
        timestamp: new Date().toISOString(),
        meta: {
          lastUpdated: new Date().toISOString(),
          source: 'NexMedicon HMS',
          profile: ['http://hl7.org/fhir/R4/StructureDefinition/Bundle'],
        },
        total: totalRecords,
        entry: [] as any[],
      }

      // Convert patients to FHIR Patient resources
      if (exportData.patients) {
        for (const p of exportData.patients) {
          fhirBundle.entry.push({
            fullUrl: `urn:uuid:${p.id}`,
            resource: {
              resourceType: 'Patient',
              id: p.id,
              identifier: [
                { system: 'urn:nexmedicon:mrn', value: p.mrn },
                ...(p.abha_id ? [{ system: 'urn:india:abha', value: p.abha_id }] : []),
              ],
              name: [{ use: 'official', text: p.full_name }],
              gender: p.gender?.toLowerCase() === 'male' ? 'male' : p.gender?.toLowerCase() === 'female' ? 'female' : 'unknown',
              birthDate: p.dob || undefined,
              telecom: [
                ...(p.mobile ? [{ system: 'phone', value: p.mobile }] : []),
                ...(p.email ? [{ system: 'email', value: p.email }] : []),
              ],
              address: p.address ? [{ text: p.address }] : undefined,
            },
          })
        }
      }

      // Convert encounters to FHIR Encounter resources
      if (exportData.encounters) {
        for (const enc of exportData.encounters) {
          fhirBundle.entry.push({
            fullUrl: `urn:uuid:${enc.id}`,
            resource: {
              resourceType: 'Encounter',
              id: enc.id,
              status: 'finished',
              class: { code: enc.encounter_type === 'IPD' ? 'IMP' : 'AMB' },
              subject: { reference: `urn:uuid:${enc.patient_id}` },
              period: {
                start: enc.encounter_date,
                end: enc.encounter_date,
              },
              reasonCode: enc.chief_complaint
                ? [{ text: enc.chief_complaint }]
                : undefined,
              diagnosis: enc.diagnosis
                ? [{ condition: { display: enc.diagnosis } }]
                : undefined,
            },
          })
        }
      }

      return new NextResponse(JSON.stringify(fhirBundle, null, 2), {
        headers: {
          'Content-Type': 'application/fhir+json',
          'Content-Disposition': `attachment; filename="nexmedicon-fhir-bundle-${new Date().toISOString().slice(0, 10)}.json"`,
        },
      })
    }

    // ── Encrypted JSON format ─────────────────────────────────
    if (format === 'json-encrypted') {
      const exportBundle = {
        exportedAt: new Date().toISOString(),
        exportedBy: auth.email,
        system: 'NexMedicon HMS',
        version: '2.0',
        tables: Object.keys(exportData),
        recordCounts: Object.fromEntries(
          Object.entries(exportData).map(([k, v]) => [k, v.length])
        ),
        data: exportData,
      }

      const plaintext = JSON.stringify(exportBundle)
      const encrypted = encryptData(plaintext)

      const encryptedEnvelope = {
        format: 'nexmedicon-encrypted-export',
        version: '1.0',
        algorithm: encrypted.algorithm,
        iv: encrypted.iv,
        tag: encrypted.tag,
        ciphertext: encrypted.ciphertext,
        exportedAt: new Date().toISOString(),
        exportedBy: auth.email,
        totalRecords,
        tables: Object.keys(exportData),
        instructions: 'Decrypt using AES-256-GCM with the HOSPITAL_ENCRYPTION_KEY. IV and tag are base64-encoded. Ciphertext is base64-encoded UTF-8 JSON.',
      }

      return new NextResponse(JSON.stringify(encryptedEnvelope, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="nexmedicon-export-encrypted-${new Date().toISOString().slice(0, 10)}.json"`,
        },
      })
    }

    // ── Plain JSON format (default) ───────────────────────────
    const exportBundle = {
      exportedAt: new Date().toISOString(),
      exportedBy: auth.email,
      system: 'NexMedicon HMS',
      version: '2.0',
      tables: Object.keys(exportData),
      recordCounts: Object.fromEntries(
        Object.entries(exportData).map(([k, v]) => [k, v.length])
      ),
      data: exportData,
    }

    return new NextResponse(JSON.stringify(exportBundle, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="nexmedicon-export-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Export failed' }, { status: 500 })
  }
}
