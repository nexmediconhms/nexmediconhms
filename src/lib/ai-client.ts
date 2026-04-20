/**
 * NexMedicon AI Client
 *
 * PDF Priority: pdf-parse (free, no key) to extract text → OpenAI/Anthropic to parse
 * Image Priority: Anthropic Claude vision → OpenAI GPT-4o vision
 * Text Priority: Anthropic Claude Haiku → OpenAI gpt-4o-mini
 *
 * NO Anthropic native PDF (too expensive).
 *
 * .env.local:
 *   ANTHROPIC_API_KEY=sk-ant-api03-...   (console.anthropic.com)
 *   OPENAI_API_KEY=sk-...                (platform.openai.com)
 */

import Anthropic from '@anthropic-ai/sdk'
import OpenAI    from 'openai'

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

export async function generateText(opts: {
  prompt:     string
  system?:    string
  maxTokens?: number
}): Promise<{ text: string; provider: string }> {
  const { prompt, system = '', maxTokens = 500 } = opts

  const anthropicKey = getAnthropicKey()
  if (anthropicKey) {
    const models = ['claude-haiku-4-5-20251001', 'claude-3-5-haiku-20241022', 'claude-3-haiku-20240307']
    for (const model of models) {
      try {
        const client = new Anthropic({ apiKey: anthropicKey })
        const msg = await client.messages.create({
          model, max_tokens: maxTokens,
          ...(system ? { system } : {}),
          messages: [{ role: 'user', content: prompt }],
        })
        const text = msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
        return { text, provider: `anthropic/${model}` }
      } catch (err: any) {
        console.warn(`[AI] Anthropic ${model}:`, err?.status, err?.message?.slice(0, 80))
        if (err?.status === 401) break
      }
    }
  }

  const openaiKey = getOpenAIKey()
  if (openaiKey) {
    const client = new OpenAI({ apiKey: openaiKey })
    const resp = await client.chat.completions.create({
      model: 'gpt-4o-mini', max_tokens: maxTokens,
      messages: [
        ...(system ? [{ role: 'system' as const, content: system }] : []),
        { role: 'user', content: prompt },
      ],
    })
    return { text: resp.choices[0]?.message?.content ?? '', provider: 'openai/gpt-4o-mini' }
  }

  throw new Error('NO_AI_KEY: Add ANTHROPIC_API_KEY or OPENAI_API_KEY to .env.local.')
}

export async function analyzeImage(opts: {
  base64:    string
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp'
  prompt:    string
  system?:   string
  maxTokens?:number
}): Promise<{ text: string; provider: string }> {
  const { base64, mediaType, prompt, system = '', maxTokens = 2048 } = opts

  const anthropicKey = getAnthropicKey()
  if (anthropicKey) {
    const models = ['claude-sonnet-4-6', 'claude-3-5-sonnet-20241022', 'claude-3-5-sonnet-20240620']
    for (const model of models) {
      try {
        const client = new Anthropic({ apiKey: anthropicKey })
        const msg = await client.messages.create({
          model, max_tokens: maxTokens,
          ...(system ? { system } : {}),
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text',  text: prompt },
          ]}],
        })
        const text = msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
        return { text, provider: `anthropic/${model}` }
      } catch (err: any) {
        console.warn(`[AI] Anthropic vision ${model}:`, err?.status, err?.message?.slice(0, 80))
        if (err?.status === 401) break
      }
    }
  }

  const openaiKey = getOpenAIKey()
  if (openaiKey) {
    const client = new OpenAI({ apiKey: openaiKey })
    const resp = await client.chat.completions.create({
      model: 'gpt-4o', max_tokens: maxTokens,
      messages: [
        ...(system ? [{ role: 'system' as const, content: system }] : []),
        { role: 'user', content: [
          { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}`, detail: 'high' } },
          { type: 'text',      text: prompt },
        ]},
      ],
    })
    return { text: resp.choices[0]?.message?.content ?? '', provider: 'openai/gpt-4o' }
  }

  throw new Error('NO_AI_KEY: Add ANTHROPIC_API_KEY or OPENAI_API_KEY to .env.local.')
}

// PDF: pdf-parse (free) extracts text → AI parses it. No expensive vision API.
export async function analyzePDF(opts: {
  base64:    string
  prompt:    string
  system?:   string
  maxTokens?:number
}): Promise<{ text: string; provider: string }> {
  const { base64, prompt, system = '', maxTokens = 2048 } = opts

  // Step 1 — free text extraction using pdf-parse
  // Using dynamic import — works on Vercel serverless and local dev
  let pdfText = ''
  try {
    // pdf-parse v1 exports the function directly (not as .default)
    // Must use require() — dynamic import gives wrong module shape
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pdfParse: (buf: Buffer) => Promise<{ text: string }> = require('pdf-parse')
    const data = await pdfParse(Buffer.from(base64, 'base64'))
    pdfText = (data.text ?? '').trim()
  } catch (err: any) {
    console.warn('[PDF] pdf-parse failed:', err?.message?.slice(0, 100))
  }

  if (!pdfText) {
    throw new Error(
      'This PDF has no text layer — it is a scanned image. ' +
      'Please photograph the paper form and upload as JPG instead.'
    )
  }

  const fullPrompt = `${prompt}\n\nEXTRACTED PDF TEXT:\n${pdfText}`

  // Step 2 — OpenAI first (user preference)
  const openaiKey = getOpenAIKey()
  if (openaiKey) {
    try {
      const client = new OpenAI({ apiKey: openaiKey })
      const resp = await client.chat.completions.create({
        model: 'gpt-4o-mini', max_tokens: maxTokens,
        messages: [
          ...(system ? [{ role: 'system' as const, content: system }] : []),
          { role: 'user', content: fullPrompt },
        ],
      })
      return { text: resp.choices[0]?.message?.content ?? '', provider: 'openai/pdf-text-extract' }
    } catch (err: any) {
      console.warn('[PDF] OpenAI:', err?.message?.slice(0, 80))
    }
  }

  // Step 3 — Anthropic Haiku (cheapest)
  const anthropicKey = getAnthropicKey()
  if (anthropicKey) {
    const client = new Anthropic({ apiKey: anthropicKey })
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages: [{ role: 'user', content: fullPrompt }],
    })
    const text = msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
    return { text, provider: 'anthropic/pdf-text-extract' }
  }

  throw new Error('NO_AI_KEY: Add OPENAI_API_KEY or ANTHROPIC_API_KEY to .env.local for PDF parsing.')
}
