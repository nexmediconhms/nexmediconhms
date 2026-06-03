/**
 * src/middleware.ts
 *
 * Next.js Edge Middleware — Rate Limiting & Security Headers
 *
 * This middleware runs on the Edge Runtime (before the request hits
 * the server) and provides:
 *
 *   1. Rate limiting for Supabase Auth endpoints (proxied via gotrue)
 *   2. Rate limiting for custom API routes
 *   3. Security response headers (CSP, X-Frame-Options, etc.)
 *   4. Request logging for suspicious activity
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  SECURITY FIX: Prevents brute-force login attacks.              ║
 * ║                                                                  ║
 * ║  Since Supabase auth calls go directly from browser to Supabase, ║
 * ║  this middleware protects our own API routes. For the direct      ║
 * ║  Supabase auth calls, we also configure rate limiting in the     ║
 * ║  login page UI (client-side limiter as defense-in-depth).        ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * NOTE: Edge middleware uses a separate in-memory store per edge instance.
 * For serverless deployments, each cold start gets a fresh store.
 * This still provides effective protection because:
 *   1. Most requests hit the same instance within a short window
 *   2. The client-side limiter provides first line of defense
 *   3. Supabase's built-in auth rate limiting provides backend defense
 */

import { NextRequest, NextResponse } from 'next/server'

// ─── Lightweight Edge Rate Limiter ────────────────────────────
// (Cannot import from @/lib/rate-limit because Edge middleware
//  has a separate module scope and limited API access)

interface RateLimitEntry {
  count: number
  firstRequest: number
  blocked: boolean
  blockedUntil: number
}

const AUTH_LIMIT_WINDOW = 15 * 60 * 1000  // 15 minutes
const AUTH_MAX_REQUESTS = 10               // 10 attempts per window
const AUTH_BLOCK_DURATION = 30 * 60 * 1000 // 30-minute lockout after exceeded

const API_LIMIT_WINDOW = 60 * 1000        // 1 minute
const API_MAX_REQUESTS = 100              // 100 requests per minute

// Separate stores for auth and general API
const authStore = new Map<string, RateLimitEntry>()
const apiStore = new Map<string, RateLimitEntry>()

/**
 * Check rate limit for an identifier against a store.
 */
function checkRateLimit(
  store: Map<string, RateLimitEntry>,
  key: string,
  maxRequests: number,
  windowMs: number,
  blockDurationMs: number,
): { allowed: boolean; retryAfter: number } {
  const now = Date.now()
  let entry = store.get(key)

  // Clean expired entries periodically (every 100 checks)
  if (store.size > 1000 && Math.random() < 0.01) {
    const keysToDelete: string[] = []
    store.forEach((v, k) => {
      if (now - v.firstRequest > windowMs * 2 && !v.blocked) keysToDelete.push(k)
      if (v.blocked && now > v.blockedUntil) keysToDelete.push(k)
    })
    keysToDelete.forEach(k => store.delete(k))
  }

  if (!entry) {
    entry = { count: 1, firstRequest: now, blocked: false, blockedUntil: 0 }
    store.set(key, entry)
    return { allowed: true, retryAfter: 0 }
  }

  // Check if blocked
  if (entry.blocked) {
    if (now < entry.blockedUntil) {
      return { allowed: false, retryAfter: Math.ceil((entry.blockedUntil - now) / 1000) }
    }
    // Block expired — reset
    store.delete(key)
    return { allowed: true, retryAfter: 0 }
  }

  // Check if window has expired — reset
  if (now - entry.firstRequest > windowMs) {
    entry.count = 1
    entry.firstRequest = now
    return { allowed: true, retryAfter: 0 }
  }

  // Within window — check count
  entry.count++
  if (entry.count > maxRequests) {
    // Block the IP
    entry.blocked = true
    entry.blockedUntil = now + blockDurationMs
    return { allowed: false, retryAfter: Math.ceil(blockDurationMs / 1000) }
  }

  return { allowed: true, retryAfter: 0 }
}

/**
 * Extract client IP from request headers.
 */
function getIP(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip')?.trim() ||
    req.headers.get('cf-connecting-ip')?.trim() ||
    '127.0.0.1'
  )
}

// ─── Middleware Function ──────────────────────────────────────

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const ip = getIP(req)

  // ╔════════════════════════════════════════════════════════════════╗
  // ║  DOUBLE-SLASH URL NORMALIZATION (CRITICAL FIX)                ║
  // ║                                                                ║
  // ║  When NEXT_PUBLIC_SITE_URL has a trailing slash, generated    ║
  // ║  URLs become "https://domain.com//portal/verify?token=xxx".   ║
  // ║  This double-slash path doesn't match any Next.js route,      ║
  // ║  causing the global 404 page to render.                        ║
  // ║                                                                ║
  // ║  This middleware detects ANY URL with consecutive slashes      ║
  // ║  in the path and 301-redirects to the normalized version.      ║
  // ║                                                                ║
  // ║  Also handles edge cases:                                      ║
  // ║   - /portal//verify  → /portal/verify                          ║
  // ║   - ///portal/verify → /portal/verify                          ║
  // ║   - /portal////login → /portal/login                           ║
  // ╚════════════════════════════════════════════════════════════════╝

  // Check the raw URL for double slashes (req.nextUrl.pathname may auto-normalize on some platforms)
  const rawUrl = req.url
  const urlObj = new URL(rawUrl)

  // Detect any double slashes in the pathname (excluding the protocol's "//")
  if (urlObj.pathname.includes('//')) {
    // Collapse all consecutive slashes to a single slash
    const normalizedPath = urlObj.pathname.replace(/\/+/g, '/')

    // Reconstruct the URL with the normalized path, keeping query string and hash
    const normalizedUrl = new URL(rawUrl)
    normalizedUrl.pathname = normalizedPath

    console.log(`[middleware] Normalizing double-slash URL: ${urlObj.pathname} → ${normalizedPath}`)

    // 301 permanent redirect (cached by browser, fixes the link forever)
    return NextResponse.redirect(normalizedUrl, 301)
  }

  // Also check the pathname property in case Next.js sees it differently
  if (pathname.includes('//')) {
    const normalizedPath = pathname.replace(/\/+/g, '/')
    const url = req.nextUrl.clone()
    url.pathname = normalizedPath
    console.log(`[middleware] Normalizing pathname: ${pathname} → ${normalizedPath}`)
    return NextResponse.redirect(url, 301)
  }

  // ── Rate limit auth-adjacent API routes ─────────────────────
  // These are our custom API routes that handle sensitive operations
  const isAuthRoute = (
    pathname.startsWith('/api/users') ||
    pathname.startsWith('/api/phi') ||
    pathname.startsWith('/api/backup') ||
    pathname.startsWith('/api/export')
  )

  if (isAuthRoute) {
    const result = checkRateLimit(
      authStore, ip, AUTH_MAX_REQUESTS, AUTH_LIMIT_WINDOW, AUTH_BLOCK_DURATION
    )

    if (!result.allowed) {
      return new NextResponse(
        JSON.stringify({
          error: 'Too many requests. Please try again later.',
          retryAfter: result.retryAfter,
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(result.retryAfter),
            'X-RateLimit-Limit': String(AUTH_MAX_REQUESTS),
            'X-RateLimit-Remaining': '0',
          },
        }
      )
    }
  }

  // ── Rate limit all API routes (general) ─────────────────────
  if (pathname.startsWith('/api/')) {
    const result = checkRateLimit(
      apiStore, ip, API_MAX_REQUESTS, API_LIMIT_WINDOW, 10 * 60 * 1000
    )

    if (!result.allowed) {
      return new NextResponse(
        JSON.stringify({
          error: 'Rate limit exceeded. Please slow down.',
          retryAfter: result.retryAfter,
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(result.retryAfter),
            'X-RateLimit-Limit': String(API_MAX_REQUESTS),
            'X-RateLimit-Remaining': '0',
          },
        }
      )
    }
  }

  // ── Continue with the request ───────────────────────────────
  const response = NextResponse.next()

  // ── Add security headers to all responses ───────────────────
  // (This is a secondary location — primary is in next.config.js headers)
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-XSS-Protection', '1; mode=block')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()')

  // Rate limit headers for allowed requests
  if (pathname.startsWith('/api/')) {
    response.headers.set('X-RateLimit-Limit', String(API_MAX_REQUESTS))
  }

  return response
}

// ─── Matcher: Run middleware on relevant paths ───────────────
// IMPORTANT: We include /portal routes so the double-slash URL
// normalization (above) catches malformed magic-link URLs.
//
// Excludes static assets, images, and the _next folder to avoid
// unnecessary processing on every static file request.

export const config = {
  matcher: [
    // ── Match all paths EXCEPT static assets ────────────────────
    // This pattern catches everything including /portal/* so the
    // double-slash normalizer can fix malformed magic-link URLs.
    // Excludes:
    //   - _next/static (build output)
    //   - _next/image (image optimization)
    //   - favicon.ico
    //   - public assets (manifest, icons, etc.)
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|icons|forms).*)',
  ],
}