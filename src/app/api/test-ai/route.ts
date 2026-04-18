import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export async function GET() {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? ''

  // Step 1: Key present?
  if (!apiKey) {
    return NextResponse.json({ ok: false, step: 'key_missing', error: 'ANTHROPIC_API_KEY not set in .env.local' })
  }
  if (apiKey.includes('YOUR')) {
    return NextResponse.json({ ok: false, step: 'key_placeholder', error: 'Still using placeholder key. Replace with real key from console.anthropic.com', key_preview: apiKey.slice(0, 15) + '...' })
  }

  // Step 2: Try actual API call with a safe minimal prompt
  try {
    const client = new Anthropic({ apiKey })
    const msg = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 10,
      messages:   [{ role: 'user', content: 'Say: OK' }],
    })
    const text = msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
    return NextResponse.json({
      ok:             true,
      step:           'success',
      model:          'claude-haiku-4-5-20251001',
      response:       text,
      key_preview:    apiKey.slice(0, 10) + '...' + apiKey.slice(-4),
    })
  } catch (err: any) {
    // Try fallback model
    try {
      const client = new Anthropic({ apiKey })
      const msg = await client.messages.create({
        model:      'claude-3-5-haiku-20241022',
        max_tokens: 10,
        messages:   [{ role: 'user', content: 'Say: OK' }],
      })
      const text = msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
      return NextResponse.json({
        ok:            true,
        step:          'success_fallback_model',
        model:         'claude-3-5-haiku-20241022',
        response:      text,
        first_error:   err?.message,
        key_preview:   apiKey.slice(0, 10) + '...' + apiKey.slice(-4),
      })
    } catch (err2: any) {
      return NextResponse.json({
        ok:          false,
        step:        'api_call_failed',
        error:       err?.message,
        error2:      err2?.message,
        status:      err?.status,
        type:        err?.error?.type,
        key_preview: apiKey.slice(0, 10) + '...' + apiKey.slice(-4),
        key_length:  apiKey.length,
      })
    }
  }
}
