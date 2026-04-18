import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const MODELS = [
  'claude-haiku-4-5-20251001',
  'claude-3-5-haiku-20241022',
  'claude-3-haiku-20240307',
]

export async function POST(req: NextRequest) {
  const apiKey = (process.env.ANTHROPIC_API_KEY ?? '').trim()

  if (!apiKey || apiKey.length < 20 || apiKey.includes('YOUR')) {
    return NextResponse.json({ corrected: null, error: 'API key not configured' })
  }

  let body: any
  try { body = await req.json() } catch {
    return NextResponse.json({ corrected: null, error: 'Invalid body' })
  }

  const { text, context } = body
  if (!text?.trim()) {
    return NextResponse.json({ corrected: text }, { status: 200 })
  }

  const prompt = `You are a medical transcription assistant for an Indian gynecology clinic.
Correct the speech-to-text transcription below. Fix medical spelling, add punctuation, format properly.
Context: ${context || 'clinical notes'}
Raw transcription: "${text}"
Return ONLY the corrected text. No explanations.`

  const client = new Anthropic({ apiKey })

  for (const model of MODELS) {
    try {
      const msg = await client.messages.create({
        model,
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      })
      const corrected = msg.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text).join('').trim()
        .replace(/^["']|["']$/g, '')
      return NextResponse.json({ corrected, model_used: model })
    } catch (err: any) {
      console.error(`[voice-correct] model ${model} failed:`, err?.status, err?.message)
      if (err?.status === 401) break
    }
  }

  // On failure, return original text so user is not blocked
  return NextResponse.json({ corrected: text, error: 'AI correction unavailable, returning original.' })
}
