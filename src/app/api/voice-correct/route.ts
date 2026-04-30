/**
 * src/app/api/voice-correct/route.ts  — UPDATED
 *
 * CHANGE: Added requireAuth() guard. The original prompt, AI call,
 * and trimmed response are preserved exactly.
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
    return NextResponse.json({ corrected: null, error: 'No AI key configured.' }, { status: 503 })
  }

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ corrected: null, error: 'Invalid body' }, { status: 400 })
  }

  const { text, context } = body
  if (!text?.trim()) return NextResponse.json({ corrected: text })

  try {
    const { text: corrected } = await generateText({
      prompt: `Correct this medical speech-to-text transcription. Fix spelling, add punctuation, format properly.
Context: ${context || 'clinical notes'}
Raw transcription: "${text}"
Return ONLY the corrected text. No explanations.`,
      maxTokens: 200,
    })
    return NextResponse.json({ corrected: corrected.trim().replace(/^["']|["']$/g, '') })
  } catch {
    return NextResponse.json({ corrected: text, error: 'AI correction unavailable.' })
  }
}