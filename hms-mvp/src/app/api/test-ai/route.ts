import { NextResponse } from 'next/server'
import { getAnthropicKey, getOpenAIKey } from '@/lib/ai-client'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'

export async function GET() {
  const anthropicKey = getAnthropicKey()
  const openaiKey    = getOpenAIKey()

  if (!anthropicKey && !openaiKey) {
    return NextResponse.json({
      ok: false, step: 'no_keys',
      error: 'Neither ANTHROPIC_API_KEY nor OPENAI_API_KEY is configured. Add at least one to .env.local.',
      anthropic: 'not configured',
      openai:    'not configured',
    })
  }

  const results: any = { anthropic: null, openai: null }

  // Test Anthropic
  if (anthropicKey) {
    try {
      const client = new Anthropic({ apiKey: anthropicKey })
      const msg = await client.messages.create({
        model: 'claude-haiku-4-5-20251001', max_tokens: 10,
        messages: [{ role: 'user', content: 'Say: OK' }],
      })
      const text = msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
      results.anthropic = { ok: true, model: 'claude-haiku-4-5-20251001', response: text, key_preview: anthropicKey.slice(0,10) + '…' + anthropicKey.slice(-4) }
    } catch (err: any) {
      results.anthropic = { ok: false, error: err?.message, status: err?.status, key_preview: anthropicKey.slice(0,10) + '…' }
    }
  } else {
    results.anthropic = { ok: false, error: 'Not configured' }
  }

  // Test OpenAI
  if (openaiKey) {
    try {
      const client = new OpenAI({ apiKey: openaiKey })
      const resp = await client.chat.completions.create({
        model: 'gpt-4o-mini', max_tokens: 10,
        messages: [{ role: 'user', content: 'Say: OK' }],
      })
      const text = resp.choices[0]?.message?.content ?? ''
      results.openai = { ok: true, model: 'gpt-4o-mini', response: text, key_preview: openaiKey.slice(0,10) + '…' + openaiKey.slice(-4) }
    } catch (err: any) {
      results.openai = { ok: false, error: err?.message, status: err?.status, key_preview: openaiKey.slice(0,10) + '…' }
    }
  } else {
    results.openai = { ok: false, error: 'Not configured' }
  }

  const anyOk = results.anthropic?.ok || results.openai?.ok
  return NextResponse.json({ ok: anyOk, step: anyOk ? 'success' : 'all_failed', ...results })
}
