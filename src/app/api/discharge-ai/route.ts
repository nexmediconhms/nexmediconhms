/**
 * src/app/api/discharge-ai/route.ts  — UPDATED
 *
 * CHANGE 1 (existing): Added requireAuth() guard at the top.
 *
 * CHANGE 2 (compat fix, Jun 2026): The route previously required a
 *   structured `patient` object in the body and returned the AI result
 *   ONLY under `data.discharge`. But the Discharge Summary page sends a
 *   client-built `{ prompt }` and reads fields at the TOP LEVEL, so it
 *   was getting "Patient data required" (400) and, even past that, would
 *   read nothing back. This revision:
 *     - Accepts EITHER a client-supplied `prompt` (used as-is) OR the
 *       structured `{ patient, encounter, existingDraft }` payload (prompt
 *       built server-side, exactly as before).
 *     - Only returns "Patient data required" when NEITHER is provided.
 *     - Returns the parsed AI fields at the TOP LEVEL *and* under
 *       `discharge`, so callers that read `data.final_diagnosis` and
 *       callers that read `data.discharge` both work.
 *   Backward compatible — existing structured callers are unaffected.
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
    return NextResponse.json({ error: 'No AI key configured.' }, { status: 503 })
  }

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { patient, encounter, existingDraft, prompt: clientPrompt } = body

  // Build the prompt. Prefer a client-supplied prompt (the Discharge Summary
  // page builds a rich multi-encounter prompt); otherwise build one from the
  // structured patient/encounter payload (original behaviour). Only error
  // when we have neither a prompt nor patient data to work from.
  let prompt: string
  if (typeof clientPrompt === 'string' && clientPrompt.trim()) {
    prompt = clientPrompt.trim()
  } else if (patient) {
    const ob = encounter?.ob_data ?? {}
    prompt = `Generate a complete clinical discharge summary for an Indian gynecology hospital.

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
  } else {
    return NextResponse.json({ error: 'Patient data required' }, { status: 400 })
  }

  try {
    const { text, provider } = await generateText({
      prompt,
      maxTokens: 1500,
      system: 'You are a clinical documentation assistant. Return only valid JSON as specified.',
    })
    const clean = text
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()
    try {
      const parsed = JSON.parse(clean)
      // Return the AI fields BOTH at the top level (what the Discharge Summary
      // page reads) and under `discharge` (what structured callers read).
      return NextResponse.json({ ...parsed, discharge: parsed, provider })
    } catch {
      return NextResponse.json({ discharge: null, raw_text: clean, provider })
    }
  } catch (err: any) {
    return NextResponse.json({ error: `AI failed: ${err?.message}` }, { status: 500 })
  }
}