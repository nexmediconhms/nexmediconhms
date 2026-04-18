import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const MODELS = [
  'claude-sonnet-4-6',
  'claude-3-5-sonnet-20241022',
  'claude-3-5-sonnet-20240620',
]

export async function POST(req: NextRequest) {
  const apiKey = (process.env.ANTHROPIC_API_KEY ?? '').trim()

  if (!apiKey || apiKey.length < 20 || apiKey.includes('YOUR')) {
    return NextResponse.json(
      { error: 'Anthropic API key not configured. Set ANTHROPIC_API_KEY in .env.local.' }
    )
  }

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' })
  }

  const { patient, encounter, existingDraft } = body
  if (!patient) return NextResponse.json({ error: 'Patient data required' })

  const ob = encounter?.ob_data ?? {}
  const prompt = `Generate a complete clinical discharge summary for an Indian gynecology hospital.

PATIENT: ${patient.full_name}, ${patient.age ?? '?'}y ${patient.gender ?? ''}
MRN: ${patient.mrn ?? '-'}
Blood Group: ${patient.blood_group ?? '?'}

ADMISSION DATA:
Chief Complaint: ${encounter?.chief_complaint ?? '-'}
Diagnosis: ${encounter?.diagnosis ?? '-'}
Vitals: BP ${encounter?.bp_systolic ?? '-'}/${encounter?.bp_diastolic ?? '-'}, Pulse ${encounter?.pulse ?? '-'}, Weight ${encounter?.weight ?? '-'}kg
OB Data: ${ob.lmp ? `LMP: ${ob.lmp}, GA: ${ob.gestational_age ?? '-'}, G${ob.gravida ?? 0}P${ob.para ?? 0}` : 'Not applicable'}
Clinical Notes: ${encounter?.notes ?? '-'}

${existingDraft ? `EXISTING DRAFT TO IMPROVE:\n${existingDraft}` : ''}

Return a JSON object with these exact keys:
{
  "final_diagnosis": "...",
  "secondary_diagnosis": "...",
  "clinical_summary": "...",
  "investigations": "...",
  "treatment_given": "...",
  "condition_at_discharge": "Stable, afebrile, ambulant",
  "discharge_advice": "...",
  "diet_advice": "...",
  "medications_at_discharge": "...",
  "follow_up_note": "Review after 1 week with reports"
}
Return ONLY valid JSON. No markdown fences.`

  const client = new Anthropic({ apiKey })
  let lastError: any

  for (const model of MODELS) {
    try {
      const msg = await client.messages.create({
        model,
        max_tokens: 1500,
        system: 'You are a clinical documentation assistant. Return only valid JSON as specified.',
        messages: [{ role: 'user', content: prompt }],
      })
      const raw = msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
      const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()
      try {
        const parsed = JSON.parse(clean)
        return NextResponse.json({ discharge: parsed, model_used: model })
      } catch {
        return NextResponse.json({ discharge: null, raw_text: clean, model_used: model })
      }
    } catch (err: any) {
      console.error(`[discharge-ai] model ${model} failed:`, err?.status, err?.message)
      lastError = err
      if (err?.status === 401) break
    }
  }

  const s = lastError?.status
  if (s === 401) return NextResponse.json({ error: 'Invalid API key (401).' })
  if (s === 429) return NextResponse.json({ error: 'Rate limited (429). Try again shortly.' })
  return NextResponse.json({ error: `AI call failed: ${lastError?.message}` })
}
