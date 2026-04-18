import { NextRequest, NextResponse } from 'next/server'
import { generateText, hasAnyAIKey } from '@/lib/ai-client'

export async function POST(req: NextRequest) {
  if (!hasAnyAIKey()) {
    return NextResponse.json({ error: 'No AI key configured.' }, { status: 503 })
  }

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { patient, encounter, existingDraft } = body
  if (!patient) return NextResponse.json({ error: 'Patient data required' }, { status: 400 })

  const ob = encounter?.ob_data ?? {}
  const prompt = `Generate a complete clinical discharge summary for an Indian gynecology hospital.

PATIENT: ${patient.full_name}, ${patient.age ?? '?'}y ${patient.gender ?? ''}
MRN: ${patient.mrn ?? '-'} | Blood Group: ${patient.blood_group ?? '?'}
Chief Complaint: ${encounter?.chief_complaint ?? '-'}
Diagnosis: ${encounter?.diagnosis ?? '-'}
Vitals: BP ${encounter?.bp_systolic ?? '-'}/${encounter?.bp_diastolic ?? '-'}, Pulse ${encounter?.pulse ?? '-'}, Weight ${encounter?.weight ?? '-'}kg
OB: ${ob.lmp ? `LMP: ${ob.lmp}, G${ob.gravida ?? 0}P${ob.para ?? 0}` : 'Not applicable'}
Notes: ${encounter?.notes ?? '-'}
${existingDraft ? `\nEXISTING DRAFT:\n${existingDraft}` : ''}

Return JSON object with keys: final_diagnosis, secondary_diagnosis, clinical_summary, investigations, treatment_given, condition_at_discharge, discharge_advice, diet_advice, medications_at_discharge, follow_up_note.
Return ONLY valid JSON. No markdown.`

  try {
    const { text, provider } = await generateText({ prompt, maxTokens: 1500,
      system: 'You are a clinical documentation assistant. Return only valid JSON as specified.' })
    const clean = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()
    try {
      return NextResponse.json({ discharge: JSON.parse(clean), provider })
    } catch {
      return NextResponse.json({ discharge: null, raw_text: clean, provider })
    }
  } catch (err: any) {
    return NextResponse.json({ error: `AI failed: ${err?.message}` }, { status: 500 })
  }
}
