/**
 * NexMedicon AI Client
 *
 * Priority: Anthropic Claude → OpenAI GPT-4o (automatic fallback)
 *
 * Set in .env.local:
 *   ANTHROPIC_API_KEY=sk-ant-api03-...   (from console.anthropic.com)
 *   OPENAI_API_KEY=sk-...                (from platform.openai.com — fallback)
 */

import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'

// ── Key validation ────────────────────────────────────────────
export function getAnthropicKey(): string | null {
  const key = (process.env.ANTHROPIC_API_KEY ?? '').trim()
  if (!key || key.length < 20 || key.includes('YOUR')) return null
  return key
}

export function getOpenAIKey(): string | null {
  const key = (process.env.OPENAI_API_KEY ?? '').trim()
  if (!key || key.length < 20 || key.includes('YOUR')) return null
  return key
}

export function hasAnyAIKey(): boolean {
  return getAnthropicKey() !== null || getOpenAIKey() !== null
}

// ── Text generation with automatic fallback ───────────────────
export async function generateText(opts: {
  prompt:       string
  system?:      string
  maxTokens?:   number
}): Promise<{ text: string; provider: string }> {
  const { prompt, system = '', maxTokens = 500 } = opts

  const anthropicKey = getAnthropicKey()
  if (anthropicKey) {
    const models = ['claude-haiku-4-5-20251001', 'claude-3-5-haiku-20241022', 'claude-3-haiku-20240307']
    for (const model of models) {
      try {
        const client = new Anthropic({ apiKey: anthropicKey })
        const msg = await client.messages.create({
          model,
          max_tokens: maxTokens,
          ...(system ? { system } : {}),
          messages: [{ role: 'user', content: prompt }],
        })
        const text = msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
        return { text, provider: `anthropic/${model}` }
      } catch (err: any) {
        console.warn(`[AI] Anthropic ${model} failed:`, err?.status, err?.message?.slice(0, 80))
        if (err?.status === 401) break  // Bad key — no point retrying other models
      }
    }
  }

  const openaiKey = getOpenAIKey()
  if (openaiKey) {
    try {
      const client = new OpenAI({ apiKey: openaiKey })
      const resp = await client.chat.completions.create({
        model:      'gpt-4o-mini',
        max_tokens: maxTokens,
        messages: [
          ...(system ? [{ role: 'system' as const, content: system }] : []),
          { role: 'user', content: prompt },
        ],
      })
      const text = resp.choices[0]?.message?.content ?? ''
      return { text, provider: 'openai/gpt-4o-mini' }
    } catch (err: any) {
      console.warn('[AI] OpenAI fallback failed:', err?.message?.slice(0, 80))
      throw new Error(`OpenAI fallback failed: ${err?.message}`)
    }
  }

  throw new Error('NO_AI_KEY: Neither ANTHROPIC_API_KEY nor OPENAI_API_KEY is configured. Add at least one to .env.local.')
}

// ── Vision / OCR with automatic fallback ─────────────────────
export async function analyzeImage(opts: {
  base64:     string
  mediaType:  'image/jpeg' | 'image/png' | 'image/webp'
  prompt:     string
  system?:    string
  maxTokens?: number
}): Promise<{ text: string; provider: string }> {
  const { base64, mediaType, prompt, system = '', maxTokens = 2048 } = opts

  const anthropicKey = getAnthropicKey()
  if (anthropicKey) {
    const visionModels = ['claude-sonnet-4-6', 'claude-3-5-sonnet-20241022', 'claude-3-5-sonnet-20240620']
    for (const model of visionModels) {
      try {
        const client = new Anthropic({ apiKey: anthropicKey })
        const msg = await client.messages.create({
          model,
          max_tokens: maxTokens,
          ...(system ? { system } : {}),
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
              { type: 'text',  text: prompt },
            ],
          }],
        })
        const text = msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
        return { text, provider: `anthropic/${model}` }
      } catch (err: any) {
        console.warn(`[AI] Anthropic vision ${model} failed:`, err?.status, err?.message?.slice(0, 80))
        if (err?.status === 401) break
      }
    }
  }

  const openaiKey = getOpenAIKey()
  if (openaiKey) {
    try {
      const client = new OpenAI({ apiKey: openaiKey })
      const resp = await client.chat.completions.create({
        model: 'gpt-4o',  // GPT-4o has vision; gpt-4o-mini also supports images
        max_tokens: maxTokens,
        messages: [
          ...(system ? [{ role: 'system' as const, content: system }] : []),
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}`, detail: 'high' } },
              { type: 'text',      text: prompt },
            ],
          },
        ],
      })
      const text = resp.choices[0]?.message?.content ?? ''
      return { text, provider: 'openai/gpt-4o' }
    } catch (err: any) {
      console.warn('[AI] OpenAI vision fallback failed:', err?.message?.slice(0, 80))
      throw new Error(`OpenAI vision failed: ${err?.message}`)
    }
  }

  throw new Error('NO_AI_KEY: Neither ANTHROPIC_API_KEY nor OPENAI_API_KEY is configured.')
}
