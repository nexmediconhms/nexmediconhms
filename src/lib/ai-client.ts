/**
 * NexMedicon AI Client
 *
 * PDF: pdfjs-dist extracts text (free) → OpenAI/Anthropic parses → structured JSON
 *      For OUR fillable PDFs: pdf-lib reads AcroForm fields directly (100% accurate, no AI)
 *
 * Image: Anthropic vision → OpenAI GPT-4o vision
 * Text:  Anthropic Haiku  → OpenAI gpt-4o-mini
 */

import Anthropic from '@anthropic-ai/sdk'
import OpenAI    from 'openai'

// ── Key helpers ───────────────────────────────────────────────
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

// ── Text generation ───────────────────────────────────────────
export async function generateText(opts: {
  prompt: string; system?: string; maxTokens?: number
}): Promise<{ text: string; provider: string }> {
  const { prompt, system = '', maxTokens = 500 } = opts

  const anthropicKey = getAnthropicKey()
  if (anthropicKey) {
    for (const model of ['claude-haiku-4-5-20251001','claude-3-5-haiku-20241022','claude-3-haiku-20240307']) {
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

// ── Image OCR ─────────────────────────────────────────────────
export async function analyzeImage(opts: {
  base64: string; mediaType: 'image/jpeg'|'image/png'|'image/webp'
  prompt: string; system?: string; maxTokens?: number
}): Promise<{ text: string; provider: string }> {
  const { base64, mediaType, prompt, system = '', maxTokens = 2048 } = opts

  const anthropicKey = getAnthropicKey()
  if (anthropicKey) {
    for (const model of ['claude-sonnet-4-6','claude-3-5-sonnet-20241022','claude-3-5-sonnet-20240620']) {
      try {
        const client = new Anthropic({ apiKey: anthropicKey })
        const msg = await client.messages.create({
          model, max_tokens: maxTokens,
          ...(system ? { system } : {}),
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: prompt },
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
          { type: 'text', text: prompt },
        ]},
      ],
    })
    return { text: resp.choices[0]?.message?.content ?? '', provider: 'openai/gpt-4o' }
  }

  throw new Error('NO_AI_KEY: Add ANTHROPIC_API_KEY or OPENAI_API_KEY to .env.local.')
}

// ── PDF text extraction using pdfjs-dist ─────────────────────
// pdfjs-dist is ESM-only, use dynamic import
async function extractPdfText(base64: string): Promise<string> {
  try {
    // Dynamic import works in Next.js server routes with serverExternalPackages
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs' as any)
    const pdfData  = Buffer.from(base64, 'base64')
    const uint8    = new Uint8Array(pdfData)

    const loadingTask = (pdfjsLib as any).getDocument({
      data: uint8,
      // Suppress font warning — we don't need font rendering
      standardFontDataUrl: undefined,
      verbosity: 0,
    })
    const pdfDocument = await loadingTask.promise
    const numPages    = pdfDocument.numPages
    const pages: string[] = []

    for (let i = 1; i <= Math.min(numPages, 10); i++) {
      const page        = await pdfDocument.getPage(i)
      const textContent = await page.getTextContent()
      const pageText    = textContent.items
        .map((item: any) => ('str' in item ? item.str : ''))
        .join(' ')
      pages.push(pageText)
    }

    return pages.join('\n').trim()
  } catch (err: any) {
    console.warn('[PDF] pdfjs-dist extraction failed:', err?.message?.slice(0, 100))
    return ''
  }
}

// ── Read AcroForm fields from NexMedicon-generated fillable PDFs ──
// Uses pdf-lib to read field values — 100% accurate for digitally-filled PDFs
export async function readFillablePDF(base64: string): Promise<Record<string, string>> {
  try {
    const { PDFDocument } = await import('pdf-lib')
    const pdfBytes = Buffer.from(base64, 'base64')
    const doc      = await PDFDocument.load(pdfBytes, { ignoreEncryption: true })
    const form     = doc.getForm()
    const fields   = form.getFields()
    const result: Record<string, string> = {}

    for (const field of fields) {
      const name = field.getName()
      try {
        result[name] = form.getTextField(name).getText() ?? ''
      } catch {
        try {
          result[name] = form.getRadioGroup(name).getSelected() ?? ''
        } catch {
          try {
            result[name] = form.getCheckBox(name).isChecked() ? 'Yes' : 'No'
          } catch {
            // skip unreadable field
          }
        }
      }
    }
    return result
  } catch (err: any) {
    console.warn('[PDF] pdf-lib field read failed:', err?.message?.slice(0, 100))
    return {}
  }
}

// ── PDF OCR: try AcroForm fields first, then text extraction + AI ──
export async function analyzePDF(opts: {
  base64: string; prompt: string; system?: string; maxTokens?: number
}): Promise<{ text: string; provider: string }> {
  const { base64, prompt, system = '', maxTokens = 2048 } = opts

  // Step 1 — Try reading AcroForm fields (works for our fillable PDFs)
  const fields = await readFillablePDF(base64)
  const fieldValues = Object.entries(fields)
    .filter(([, v]) => v && v.trim())
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')

  // Step 2 — Extract text layer with pdfjs-dist
  const extractedText = await extractPdfText(base64)

  // Combine both
  const combinedText = [
    fieldValues ? `PDF FORM FIELDS:\n${fieldValues}` : '',
    extractedText ? `PDF TEXT CONTENT:\n${extractedText}` : '',
  ].filter(Boolean).join('\n\n')

  if (!combinedText.trim()) {
    throw new Error(
      'PDF_NO_TEXT: This PDF has no readable text. ' +
      'If it is a scanned paper form, please photograph it and upload as JPG. ' +
      'If it is a digitally filled form, make sure you saved it with the typed values.'
    )
  }

  const fullPrompt = `${prompt}\n\n${combinedText}`

  // Step 3 — OpenAI (preferred for structured extraction)
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
      return { text: resp.choices[0]?.message?.content ?? '', provider: 'openai/pdf' }
    } catch (err: any) {
      console.warn('[PDF] OpenAI failed:', err?.message?.slice(0, 80))
    }
  }

  // Step 4 — Anthropic Haiku fallback
  const anthropicKey = getAnthropicKey()
  if (anthropicKey) {
    try {
      const client = new Anthropic({ apiKey: anthropicKey })
      const msg = await client.messages.create({
        model: 'claude-haiku-4-5-20251001', max_tokens: maxTokens,
        ...(system ? { system } : {}),
        messages: [{ role: 'user', content: fullPrompt }],
      })
      const text = msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
      return { text, provider: 'anthropic/pdf' }
    } catch (err: any) {
      console.warn('[PDF] Anthropic failed:', err?.message?.slice(0, 80))
    }
  }

  throw new Error('NO_AI_KEY: Add OPENAI_API_KEY or ANTHROPIC_API_KEY to Vercel environment variables.')
}
