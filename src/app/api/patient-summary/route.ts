/**
 * src/app/api/patient-summary/route.ts  — UPDATED
 *
 * CHANGE: Added requireAuth() guard. The full original AI prompt — encounter
 * lines, prescription lines, discharge line, OB data, 3-5 sentence prose — is
 * preserved exactly.
 */

import { NextRequest, NextResponse } from 'next/server'
import { generateText, hasAnyAIKey } from '@/lib/ai-client'
import { requireAuth } from '@/lib/api-auth'

export async function POST(req: NextRequest) {
  // ── Auth gate ────────────────────────────────────────────────
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth
  // ────────────────────────────────────────────────────────────

  if (!hasAnyAIKey()) {
    return NextResponse.json({
      error: 'No AI key configured. Add ANTHROPIC_API_KEY or OPENAI_API_KEY to .env.local.',
    }, { status: 503 })
  }

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { patient, encounters, prescriptions, discharges } = body
  if (!patient) return NextResponse.json({ error: 'Patient data required' }, { status: 400 })

  const encLines = (encounters ?? []).slice(0, 10).map((e: any, i: number) => {
    const ob    = e.ob_data ?? {}
    const obStr = ob.lmp ? ` | LMP ${ob.lmp}, FHS ${ob.fhs ?? '-'} bpm` : ''
    return `${i + 1}. ${e.encounter_date}: ${e.chief_complaint ?? '-'} | Dx: ${e.diagnosis ?? '-'} | BP ${e.bp_systolic ?? '-'}/${e.bp_diastolic ?? '-'}${obStr}`
  }).join('\n')

  const rxLines = (prescriptions ?? []).slice(0, 3).map((rx: any) => {
    const meds = Array.isArray(rx.medications)
      ? rx.medications.slice(0, 4).map((m: any) => `${m.drug} ${m.dose}`).join(', ')
      : '-'
    return `${rx.created_at?.split('T')[0] ?? '-'}: ${meds}`
  }).join('\n')

  const dsLine = discharges?.[0]
    ? `Discharge: ${discharges[0].discharge_date ?? '-'} | Dx: ${discharges[0].final_diagnosis ?? '-'}`
    : 'No prior admissions'

  const prompt = `Patient: ${patient.full_name}, ${patient.age ?? '?'}y, ${patient.gender ?? '?'}, Blood group: ${patient.blood_group ?? '?'}

Visits (${(encounters ?? []).length}):
${encLines || 'None'}

Prescriptions (${(prescriptions ?? []).length}):
${rxLines || 'None'}

${dsLine}

Write a 3-5 sentence clinical summary for the treating doctor: patient profile, diagnosis trend, management, concerns, next steps. Flowing prose only.`

  try {
    const { text, provider } = await generateText({
      prompt,
      system:    'You are a clinical assistant. Write concise, accurate summaries. Never invent data.',
      maxTokens: 400,
    })
    return NextResponse.json({ summary: text.trim(), provider })
  } catch (err: any) {
    if (err?.message?.includes('NO_AI_KEY')) {
      return NextResponse.json({ error: 'No AI key configured. Add ANTHROPIC_API_KEY or OPENAI_API_KEY to .env.local.' }, { status: 503 })
    }
    return NextResponse.json({ error: `Summary failed: ${err?.message}` }, { status: 500 })
  }
}