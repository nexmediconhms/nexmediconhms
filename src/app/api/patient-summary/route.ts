import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

// Model fallback chain — tries in order until one works
const MODELS = [
  'claude-haiku-4-5-20251001',
  'claude-3-5-haiku-20241022',
  'claude-3-haiku-20240307',
]

export async function POST(req: NextRequest) {
  const apiKey = (process.env.ANTHROPIC_API_KEY ?? '').trim()

  if (!apiKey || apiKey.length < 20 || apiKey.includes('YOUR')) {
    return NextResponse.json(
      { error: 'Anthropic API key not configured. Open .env.local and set ANTHROPIC_API_KEY to your real key from console.anthropic.com, then restart the server.' }
    )
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' })
  }

  const { patient, encounters, prescriptions, discharges } = body
  if (!patient) {
    return NextResponse.json({ error: 'Patient data required' })
  }

  const encLines = (encounters ?? []).slice(0, 10).map((e: any, i: number) => {
    const ob = e.ob_data ?? {}
    const obStr = ob.lmp
      ? ` | LMP ${ob.lmp}, FHS ${ob.fhs ?? '-'} bpm, ${ob.presentation ?? ''}`
      : ''
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

Write a 3-5 sentence clinical summary for the treating doctor: profile, diagnosis trend, management, concerns, next steps. Flowing prose only.`

  const client = new Anthropic({ apiKey })
  let lastError: any

  for (const model of MODELS) {
    try {
      const message = await client.messages.create({
        model,
        max_tokens: 400,
        system: 'You are a clinical assistant. Write concise, accurate summaries. Never invent data.',
        messages: [{ role: 'user', content: prompt }],
      })
      const summary = message.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('').trim()
      return NextResponse.json({ summary, model_used: model })
    } catch (err: any) {
      console.error(`[patient-summary] model ${model} failed:`, err?.status, err?.message)
      lastError = err
      // 401 = bad key, no point trying other models
      if (err?.status === 401) break
    }
  }

  // All models failed
  const status = lastError?.status
  if (status === 401) {
    return NextResponse.json(
      { error: 'Invalid Anthropic API key (401). Regenerate your key at console.anthropic.com and update ANTHROPIC_API_KEY in .env.local.' }
    )
  }
  if (status === 429) {
    return NextResponse.json(
      { error: 'Rate limit reached (429). Wait a moment and try again.' }
    )
  }
  return NextResponse.json(
    { error: `AI call failed (${status ?? 'network error'}): ${lastError?.message ?? 'Check server logs.'}` }
  )
}
