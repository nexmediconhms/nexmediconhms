/**
 * src/middleware.ts
 *
 * Next.js Edge Middleware — Rate Limiting & Security Headers
 *
 * SECURITY FIX: Prevents brute-force login attacks on API routes.
 * Also adds security headers to all matched responses.
 */

import { NextRequest, NextResponse } from 'next/server'

interface RateLimitEntry {
  count: number
  firstRequest: number
  blocked: boolean
  blockedUntil: number
}

const AUTH_LIMIT_WINDOW = 15 * 60 * 1000
const AUTH_MAX_REQUESTS = 10
const AUTH_BLOCK_DURATION = 30 * 60 * 1000

const API_LIMIT_WINDOW = 60 * 1000
const API_MAX_REQUESTS = 100

const authStore = new Map<string, RateLimitEntry>()
const apiStore = new Map<string, RateLimitEntry>()

function checkRateLimit(
  store: Map<string, RateLimitEntry>,
  key: string,
  maxRequests: number,
  windowMs: number,
  blockDurationMs: number,
): { allowed: boolean; retryAfter: number } {
  const now = Date.now()
  let entry = store.get(key)

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

  if (entry.blocked) {
    if (now < entry.blockedUntil) {
      return { allowed: false, retryAfter: Math.ceil((entry.blockedUntil - now) / 1000) }
    }
    store.delete(key)
    return { allowed: true, retryAfter: 0 }
  }

  if (now - entry.firstRequest > windowMs) {
    entry.count = 1
    entry.firstRequest = now
    return { allowed: true, retryAfter: 0 }
  }

  entry.count++
  if (entry.count > maxRequests) {
    entry.blocked = true
    entry.blockedUntil = now + blockDurationMs
    return { allowed: false, retryAfter: Math.ceil(blockDurationMs / 1000) }
  }

  return { allowed: true, retryAfter: 0 }
}

function getIP(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip')?.trim() ||
    req.headers.get('cf-connecting-ip')?.trim() ||
    '127.0.0.1'
  )
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const ip = getIP(req)

  const isAuthRoute = (
    pathname.startsWith('/api/users') ||
    pathname.startsWith('/api/phi') ||
    pathname.startsWith('/api/backup') ||
    pathname.startsWith('/api/export')
  )

  if (isAuthRoute) {
    const result = checkRateLimit(authStore, ip, AUTH_MAX_REQUESTS, AUTH_LIMIT_WINDOW, AUTH_BLOCK_DURATION)
    if (!result.allowed) {
      return new NextResponse(
        JSON.stringify({ error: 'Too many requests. Please try again later.', retryAfter: result.retryAfter }),
        { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(result.retryAfter), 'X-RateLimit-Limit': String(AUTH_MAX_REQUESTS), 'X-RateLimit-Remaining': '0' } }
      )
    }
  }

  if (pathname.startsWith('/api/')) {
    const result = checkRateLimit(apiStore, ip, API_MAX_REQUESTS, API_LIMIT_WINDOW, 10 * 60 * 1000)
    if (!result.allowed) {
      return new NextResponse(
        JSON.stringify({ error: 'Rate limit exceeded. Please slow down.', retryAfter: result.retryAfter }),
        { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(result.retryAfter), 'X-RateLimit-Limit': String(API_MAX_REQUESTS), 'X-RateLimit-Remaining': '0' } }
      )
    }
  }

  const response = NextResponse.next()

  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-XSS-Protection', '1; mode=block')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()')

  if (pathname.startsWith('/api/')) {
    response.headers.set('X-RateLimit-Limit', String(API_MAX_REQUESTS))
  }

  return response
}

export const config = {
  matcher: [
    '/api/:path*',
    '/login',
    '/reset-password',
    '/dashboard/:path*',
    '/patients/:path*',
    '/opd/:path*',
    '/billing/:path*',
    '/settings/:path*',
  ],
}
