/**
 * src/lib/rate-limit.ts
 *
 * Rate Limiting — In-Memory Sliding Window
 *
 * SECURITY FIX: Prevents brute-force attacks on auth endpoints.
 *
 * Usage:
 *   import { authRateLimiter, apiRateLimiter } from '@/lib/rate-limit'
 *
 *   const result = authRateLimiter.check(ipAddress)
 *   if (!result.allowed) {
 *     return NextResponse.json({ error: result.message }, { status: 429 })
 *   }
 */

export interface RateLimitConfig {
  maxRequests: number
  windowMs: number
  blockAfter?: number
  blockDurationMs?: number
  message?: string
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
  retryAfter: number
  message: string
}

interface RateLimitEntry {
  timestamps: number[]
  blocked: boolean
  blockedUntil: number
  failureCount: number
}

export class RateLimiter {
  private store: Map<string, RateLimitEntry> = new Map()
  private config: Required<RateLimitConfig>
  private cleanupInterval: ReturnType<typeof setInterval> | null = null

  constructor(config: RateLimitConfig) {
    this.config = {
      maxRequests: config.maxRequests,
      windowMs: config.windowMs,
      blockAfter: config.blockAfter ?? config.maxRequests * 2,
      blockDurationMs: config.blockDurationMs ?? 15 * 60 * 1000,
      message: config.message ?? 'Too many requests. Please try again later.',
    }

    if (typeof setInterval !== 'undefined') {
      this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000)
      if (this.cleanupInterval && typeof this.cleanupInterval.unref === 'function') {
        this.cleanupInterval.unref()
      }
    }
  }

  check(...identifiers: string[]): RateLimitResult {
    const now = Date.now()

    for (const id of identifiers) {
      if (!id) continue
      const key = id.toLowerCase().trim()
      let entry = this.store.get(key)

      if (!entry) {
        entry = { timestamps: [], blocked: false, blockedUntil: 0, failureCount: 0 }
        this.store.set(key, entry)
      }

      if (entry.blocked && now < entry.blockedUntil) {
        const retryAfter = Math.ceil((entry.blockedUntil - now) / 1000)
        return {
          allowed: false, remaining: 0, resetAt: entry.blockedUntil, retryAfter,
          message: `Account temporarily locked due to too many failed attempts. Try again in ${retryAfter} seconds.`,
        }
      }

      if (entry.blocked && now >= entry.blockedUntil) {
        entry.blocked = false
        entry.blockedUntil = 0
        entry.failureCount = 0
        entry.timestamps = []
      }

      const windowStart = now - this.config.windowMs
      entry.timestamps = entry.timestamps.filter(t => t > windowStart)

      if (entry.timestamps.length >= this.config.maxRequests) {
        const oldestInWindow = entry.timestamps[0]
        const resetAt = oldestInWindow + this.config.windowMs
        const retryAfter = Math.ceil((resetAt - now) / 1000)
        entry.failureCount++

        if (entry.failureCount >= this.config.blockAfter) {
          entry.blocked = true
          entry.blockedUntil = now + this.config.blockDurationMs
          const blockRetryAfter = Math.ceil(this.config.blockDurationMs / 1000)
          return {
            allowed: false, remaining: 0, resetAt: entry.blockedUntil, retryAfter: blockRetryAfter,
            message: `Too many failed attempts. Account locked for ${Math.ceil(this.config.blockDurationMs / 60000)} minutes.`,
          }
        }

        return { allowed: false, remaining: 0, resetAt, retryAfter, message: this.config.message }
      }

      entry.timestamps.push(now)
    }

    let minRemaining = this.config.maxRequests
    for (const id of identifiers) {
      if (!id) continue
      const entry = this.store.get(id.toLowerCase().trim())
      if (entry) {
        const remaining = this.config.maxRequests - entry.timestamps.length
        minRemaining = Math.min(minRemaining, remaining)
      }
    }

    return { allowed: true, remaining: Math.max(0, minRemaining), resetAt: Date.now() + this.config.windowMs, retryAfter: 0, message: 'OK' }
  }

  recordSuccess(...identifiers: string[]): void {
    for (const id of identifiers) {
      if (!id) continue
      const entry = this.store.get(id.toLowerCase().trim())
      if (entry) entry.failureCount = 0
    }
  }

  recordFailure(...identifiers: string[]): void {
    const now = Date.now()
    for (const id of identifiers) {
      if (!id) continue
      const key = id.toLowerCase().trim()
      let entry = this.store.get(key)
      if (!entry) {
        entry = { timestamps: [], blocked: false, blockedUntil: 0, failureCount: 0 }
        this.store.set(key, entry)
      }
      entry.failureCount++
      if (entry.failureCount >= this.config.blockAfter) {
        entry.blocked = true
        entry.blockedUntil = now + this.config.blockDurationMs
      }
    }
  }

  getState(identifier: string): { requests: number; blocked: boolean; failureCount: number; blockedUntil: number | null } | null {
    const entry = this.store.get(identifier.toLowerCase().trim())
    if (!entry) return null
    return { requests: entry.timestamps.length, blocked: entry.blocked, failureCount: entry.failureCount, blockedUntil: entry.blocked ? entry.blockedUntil : null }
  }

  reset(identifier: string): void {
    this.store.delete(identifier.toLowerCase().trim())
  }

  private cleanup(): void {
    const now = Date.now()
    const windowStart = now - this.config.windowMs
    const keysToDelete: string[] = []
    this.store.forEach((entry, key) => {
      const hasRecentActivity = entry.timestamps.some(t => t > windowStart)
      const isBlocked = entry.blocked && entry.blockedUntil > now
      if (!hasRecentActivity && !isBlocked) keysToDelete.push(key)
    })
    keysToDelete.forEach(key => this.store.delete(key))
  }

  get size(): number { return this.store.size }
}

export const authRateLimiter = new RateLimiter({
  maxRequests: 5,
  windowMs: 15 * 60 * 1000,
  blockAfter: 15,
  blockDurationMs: 30 * 60 * 1000,
  message: 'Too many login attempts. Please wait 15 minutes before trying again.',
})

export const resetRateLimiter = new RateLimiter({
  maxRequests: 3,
  windowMs: 60 * 60 * 1000,
  blockAfter: 10,
  blockDurationMs: 60 * 60 * 1000,
  message: 'Too many password reset requests. Please try again in 1 hour.',
})

export const apiRateLimiter = new RateLimiter({
  maxRequests: 60,
  windowMs: 60 * 1000,
  blockAfter: 200,
  blockDurationMs: 10 * 60 * 1000,
  message: 'Too many requests. Please slow down.',
})

export function getClientIP(req: { headers: { get: (name: string) => string | null } }): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  const vercelIp = req.headers.get('x-real-ip')
  if (vercelIp) return vercelIp.trim()
  const cfIp = req.headers.get('cf-connecting-ip')
  if (cfIp) return cfIp.trim()
  return '127.0.0.1'
}
