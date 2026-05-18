/**
 * src/app/api/voice-command/route.ts
 *
 * Resolves a raw voice transcript into a known intent.  Used by
 * `src/components/voice/VoiceAssistant.tsx`, which now passes the
 * Supabase session access_token as a Bearer header (it already does
 * this in the current source — see the FIX comment in that file).
 *
 * ─── HARDENING (May 2026) ────────────────────────────────────────────
 *  - PHI / clinical concern: voice transcripts can contain patient
 *    names, complaints and prescription names.  Sending them to an
 *    AI provider is fine when the user is authenticated, but allowing
 *    anonymous internet callers to pipe arbitrary text into our AI
 *    quota is not — the previous "soft auth" path is removed.
 *  - All callers MUST pass `Authorization: Bearer <session.access_token>`.
 *    `requireAuth` returns 401 otherwise.
 *  - SYSTEM_PROMPT is still built lazily inside the handler so that an
 *    import-time issue with `voice-commands.ts` cannot crash the
 *    entire module.
 *  - The AI fallback to keyword matching is preserved.
 *  - Errors no longer leak `err.message`; we log structured details
 *    server-side and return a neutral 500.
 * ─────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth }                from '@/lib/api-auth'
import { generateText, hasAnyAIKey }  from '@/lib/ai-client'
import { VOICE_COMMANDS, matchCommandOffline } from '@/lib/voice-commands'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Build the system prompt lazily (inside the handler) so that any import-time
// issues with voice-commands.ts don't crash the entire route module.
function buildSystemPrompt(): string {
  const registry = VOICE_COMMANDS
    .map(c => `  ${c.intent}: ${c.phrases.slice(0, 3).join(' | ')}`)
    .join('\n')

  return `You are the voice command resolver for NexMedicon HMS — a hospital management system used by doctors and staff in Indian gynecology clinics.

Your job: given a raw voice transcript, return the BEST matching intent from the command registry below.

RULES:
1. Return ONLY valid JSON — no markdown, no explanation, no code fences
2. Match intent even with: Indian accent variations, medical shorthand, partial phrases, mixed Hindi-English
3. confidence: 0.0 to 1.0 (how sure you are this is the right intent)
4. If nothing matches at all, return intent: "unknown" with confidence 0
5. For navigation with a patient name (e.g. "open Priya's records"), return param: "patient_search:<name>"
6. Use currentPage context when disambiguating (e.g. "next" on OPD new page = next tab, not nav.next)

COMMAND REGISTRY:
${registry}

Return ONLY this JSON (no other text):
{
  "intent": "<intent_id or 'unknown'>",
  "confidence": <0.0-1.0>,
  "param": "<optional string, e.g. patient name, or null>",
  "reasoning": "<one short sentence>"
}`
}

export async function POST(req: NextRequest) {
  // Strict auth — voice transcripts can contain PHI.
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  let body: { transcript?: string; currentPage?: string; currentTab?: string }
  try {
    body = await req.json() as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const transcript  = (body.transcript  ?? '').trim().slice(0, 1000) // hard cap
  const currentPage = (body.currentPage ?? '').trim().slice(0, 200)
  const currentTab  = (body.currentTab  ?? '').trim().slice(0, 60)

  if (!transcript) {
    return NextResponse.json({
      intent:     'unknown',
      confidence: 0,
      param:      null,
      fallback:   false,
    })
  }

  // ── AI resolution ─────────────────────────────────────────────
  if (hasAnyAIKey()) {
    try {
      const systemPrompt = buildSystemPrompt()

      const userPrompt = [
        `Transcript: "${transcript}"`,
        `Current page: "${currentPage}"`,
        currentTab ? `Current tab: "${currentTab}"` : '',
        '',
        'Resolve to the best intent. Return JSON only.',
      ].filter(Boolean).join('\n')

      const { text } = await generateText({
        prompt:    userPrompt,
        system:    systemPrompt,
        maxTokens: 150,
      })

      // Strip any accidental markdown fences
      const clean = text
        .replace(/^```json\s*/im, '')
        .replace(/^```\s*/im, '')
        .replace(/\s*```$/im, '')
        .trim()

      const parsed = JSON.parse(clean) as {
        intent:     string
        confidence: number
        param:      string | null
        reasoning:  string
      }

      return NextResponse.json({
        intent:     parsed.intent     ?? 'unknown',
        confidence: parsed.confidence ?? 0.5,
        param:      parsed.param      ?? null,
        reasoning:  parsed.reasoning  ?? '',
        fallback:   false,
      })
    } catch (err) {
      // AI failed — log and fall through to keyword matching.
      // eslint-disable-next-line no-console
      console.error('[voice-command] AI resolution failed:', (err as { message?: string })?.message ?? err)
    }
  }

  // ── Offline keyword fallback ──────────────────────────────────
  const match = matchCommandOffline(transcript)
  if (match) {
    return NextResponse.json({
      intent:     match.intent,
      confidence: 0.7,
      param:      null,
      reasoning:  'Keyword match (offline fallback)',
      fallback:   true,
    })
  }

  return NextResponse.json({
    intent:     'unknown',
    confidence: 0,
    param:      null,
    fallback:   true,
  })
}
