/**
 * src/app/api/generate-qr/route.ts
 *
 * QR Code Generator
 *
 * GET /api/generate-qr?url=<target>&size=<px>
 *   → returns image/png
 *
 * Used as <img src="/api/generate-qr?url=..."> from the Forms page to
 * embed printable intake QR codes.  Because <img> tags cannot send
 * Authorization headers we deliberately do NOT require user auth here;
 * instead we lock down what `url` values are acceptable so the route
 * cannot be abused as an open QR-code generator for arbitrary content.
 *
 * ─── HARDENING (May 2026) ────────────────────────────────────────────
 *  - `url` MUST point at a same-origin URL (or one of the configured
 *    NEXT_PUBLIC_SITE_URL allowlist origins).  External URLs are
 *    rejected with 400.  This stops the endpoint from being used as
 *    a free QR-code generator for phishing pages.
 *  - `url` is length-capped at 2048 chars to prevent payload abuse.
 *  - `size` is clamped to 64–600 px (was already capped at 600 by
 *    Math.min, but very small values made unreadable QR codes).
 *  - Errors no longer return raw `err.message` to the caller — they
 *    return a generic message and log details server-side.
 *  - Cache header restricted to `private, max-age=3600` so QR images
 *    can still be cached by the user's browser (this is what makes
 *    print pages snappy) but never by intermediate proxies.
 * ─────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'

export const runtime = 'nodejs'

const MAX_URL_LEN = 2048
const MIN_SIZE = 64
const MAX_SIZE = 600

/** Build the list of acceptable origins for the `url` param. */
function allowedOrigins(req: NextRequest): string[] {
  const origins = new Set<string>()
  // Always allow the request's own origin.
  origins.add(new URL(req.url).origin)
  // Plus anything explicitly configured in env.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  if (siteUrl) {
    try { origins.add(new URL(siteUrl).origin) } catch { /* ignore malformed env */ }
  }
  return Array.from(origins)
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const rawUrl  = searchParams.get('url') || ''
  const rawSize = searchParams.get('size') || '300'

  if (!rawUrl) {
    return NextResponse.json({ error: 'url param required' }, { status: 400 })
  }
  if (rawUrl.length > MAX_URL_LEN) {
    return NextResponse.json({ error: 'url is too long' }, { status: 400 })
  }

  // Reject anything that isn't a well-formed http/https URL on an
  // allowed origin.  This prevents the endpoint from being used as
  // an open QR generator for arbitrary payloads.
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return NextResponse.json({ error: 'url is not a valid URL' }, { status: 400 })
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return NextResponse.json({ error: 'Only http(s) URLs are allowed' }, { status: 400 })
  }
  const allowed = allowedOrigins(req)
  if (!allowed.includes(parsed.origin)) {
    return NextResponse.json(
      { error: `URL origin not allowed. Permitted: ${allowed.join(', ')}` },
      { status: 400 }
    )
  }

  const sizeParsed = parseInt(rawSize, 10)
  const size = Number.isFinite(sizeParsed)
    ? Math.min(MAX_SIZE, Math.max(MIN_SIZE, sizeParsed))
    : 300

  try {
    const buffer = await QRCode.toBuffer(parsed.toString(), {
      type:                 'png',
      width:                size,
      margin:               2,
      color:                { dark: '#1e40af', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    })

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type':           'image/png',
        // Browser-only cache, never proxies (QR encodes a URL, not PHI,
        // but we keep proxies out as defence in depth).
        'Cache-Control':          'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[generate-qr] error:', (err as { message?: string })?.message ?? err)
    return NextResponse.json({ error: 'Failed to generate QR code' }, { status: 500 })
  }
}
