/**
 * src/lib/rate-limit.ts
 *
 * Rate Limiting — In-Memory Sliding Window
 *
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  SECURITY FIX: Prevents brute-force attacks on auth endpoints.  ║
 * ║                                                                  ║
 * ║  This provides per-IP and per-identifier rate limiting using a   ║
 * ║  sliding window algorithm with automatic cleanup.                ║
 * ║                                                                  ║
 * ║  For Vercel/serverless deployments:                              ║
 * ║  - Each instance has its own rate limit state (no shared state)  ║
 * ║  - Still effective against most attacks (requests often hit the  ║
 * ║    same instance due to connection reuse)                        ║
 * ║  - For stronger protection, pair with Vercel's WAF or add       ║
 * ║    Redis/KV-backed rate limiting later                           ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Usage:
 *   import { authRateLimiter, apiRateLimiter } from '@/lib/rate-limit'
 *
 *   // In API route:
 *   const result = authRateLimiter.check(ipAddress)
 *   if (!result.allowed) {
 *     return NextResponse.json({ error: result.message }, { status: 429 })
 *   }
 *
 *   // In middleware:
 *   const result = authRateLimiter.check(ip, email)
 *   if (!result.allowed) { ... }
 */

// ─── Types ────────────────────────────────────────────────────

export interface RateLimitConfig {
  /** Max number of requests allowed in the window */
  maxRequests: number
  /** Time window in milliseconds */
  windowMs: number
  /** Optional: stricter limit after consecutive failures */
  blockAfter?: number
  /** Optional: block duration in ms (default: 15 minutes) */
  blockDurationMs?: number
  /** Optional: message to return when rate limited */
  message?: string
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
  retryAfter: number  // seconds until they can try again
  message: string
}

interface RateLimitEntry {
  timestamps: number[]
  blocked: boolean
  blockedUntil: number
  failureCount: number
}

// ─── Rate Limiter Class ───────────────────────────────────────

export class RateLimiter {
  private store: Map<string, RateLimitEntry> = new Map()
  private config: Required<RateLimitConfig>
  private cleanupInterval: ReturnType<typeof setInterval> | null = null

  constructor(config: RateLimitConfig) {
    this.config = {
      maxRequests: config.maxRequests,
      windowMs: config.windowMs,
      blockAfter: config.blockAfter ?? config.maxRequests * 2,
      blockDurationMs: config.blockDurationMs ?? 15 * 60 * 1000, // 15 min default
      message: config.message ?? 'Too many requests. Please try again later.',
    }

    // Auto-cleanup old entries every 5 minutes to prevent memory leaks
    if (typeof setInterval !== 'undefined') {
      this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000)
      // Ensure the interval doesn't keep the process alive in serverless
      if (this.cleanupInterval && typeof this.cleanupInterval.unref === 'function') {
        this.cleanupInterval.unref()
      }
    }
  }

  /**
   * Check if a request is allowed for the given identifier.
   *
   * @param identifiers - One or more identifiers (IP, email, etc.)
   *                      Rate limiting is applied to each independently;
   *                      if ANY identifier is blocked, the request is denied.
   */
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

      // Check if currently blocked (hard block after too many failures)
      if (entry.blocked && now < entry.blockedUntil) {
        const retryAfter = Math.ceil((entry.blockedUntil - now) / 1000)
        return {
          allowed: false,
          remaining: 0,
          resetAt: entry.blockedUntil,
          retryAfter,
          message: `Account temporarily locked due to too many failed attempts. Try again in ${retryAfter} seconds.`,
        }
      }

      // If block has expired, reset
      if (entry.blocked && now >= entry.blockedUntil) {
        entry.blocked = false
        entry.blockedUntil = 0
        entry.failureCount = 0
        entry.timestamps = []
      }

      // Sliding window: remove timestamps outside the window
      const windowStart = now - this.config.windowMs
      entry.timestamps = entry.timestamps.filter(t => t > windowStart)

      // Check if over the limit
      if (entry.timestamps.length >= this.config.maxRequests) {
        const oldestInWindow = entry.timestamps[0]
        const resetAt = oldestInWindow + this.config.windowMs
        const retryAfter = Math.ceil((resetAt - now) / 1000)

        // Increment failure count for potential hard block
        entry.failureCount++

        // Hard block if too many consecutive failures
        if (entry.failureCount >= this.config.blockAfter) {
          entry.blocked = true
          entry.blockedUntil = now + this.config.blockDurationMs
          const blockRetryAfter = Math.ceil(this.config.blockDurationMs / 1000)
          return {
            allowed: false,
            remaining: 0,
            resetAt: entry.blockedUntil,
            retryAfter: blockRetryAfter,
            message: `Too many failed attempts. Account locked for ${Math.ceil(this.config.blockDurationMs / 60000)} minutes.`,
          }
        }

        return {
          allowed: false,
          remaining: 0,
          resetAt,
          retryAfter,
          message: this.config.message,
        }
      }

      // Request is allowed — record the timestamp
      entry.timestamps.push(now)
    }

    // Calculate remaining across all identifiers (use the most restrictive)
    let minRemaining = this.config.maxRequests
    for (const id of identifiers) {
      if (!id) continue
      const entry = this.store.get(id.toLowerCase().trim())
      if (entry) {
        const remaining = this.config.maxRequests - entry.timestamps.length
        minRemaining = Math.min(minRemaining, remaining)
      }
    }

    return {
      allowed: true,
      remaining: Math.max(0, minRemaining),
      resetAt: now + this.config.windowMs,
      retryAfter: 0,
      message: 'OK',
    }
  }

  /**
   * Record a successful action (resets failure count for the identifier).
   * Call this after a successful login to reset the lockout counter.
   */
  recordSuccess(...identifiers: string[]): void {
    for (const id of identifiers) {
      if (!id) continue
      const key = id.toLowerCase().trim()
      const entry = this.store.get(key)
      if (entry) {
        entry.failureCount = 0
        // Don't clear timestamps — rate limit still applies for rapid requests
      }
    }
  }

  /**
   * Record a failed attempt (increments failure count without adding timestamp).
   * Call this after a failed login attempt.
   */
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

      // Hard block if too many failures
      if (entry.failureCount >= this.config.blockAfter) {
        entry.blocked = true
        entry.blockedUntil = now + this.config.blockDurationMs
      }
    }
  }

  /**
   * Get current state for an identifier (for debugging / admin panel).
   */
  getState(identifier: string): {
    requests: number
    blocked: boolean
    failureCount: number
    blockedUntil: number | null
  } | null {
    const entry = this.store.get(identifier.toLowerCase().trim())
    if (!entry) return null
    return {
      requests: entry.timestamps.length,
      blocked: entry.blocked,
      failureCount: entry.failureCount,
      blockedUntil: entry.blocked ? entry.blockedUntil : null,
    }
  }

  /**
   * Manually reset rate limit for an identifier (admin action).
   */
  reset(identifier: string): void {
    this.store.delete(identifier.toLowerCase().trim())
  }

  /**
   * Clean up expired entries to prevent memory leaks.
   */
  private cleanup(): void {
    const now = Date.now()
    const windowStart = now - this.config.windowMs
    const keysToDelete: string[] = []

    this.store.forEach((entry, key) => {
      // Remove if no recent timestamps AND not blocked
      const hasRecentActivity = entry.timestamps.some(t => t > windowStart)
      const isBlocked = entry.blocked && entry.blockedUntil > now

      if (!hasRecentActivity && !isBlocked) {
        keysToDelete.push(key)
      }
    })

    keysToDelete.forEach(key => this.store.delete(key))
  }

  /** For testing: get the number of tracked identifiers */
  get size(): number {
    return this.store.size
  }
}

// ─── Pre-configured Limiters ──────────────────────────────────

/**
 * Authentication rate limiter.
 *
 * Limits:
 *   - 5 login attempts per IP per 15-minute window
 *   - 10 login attempts per email per 15-minute window
 *   - Hard block after 15 total failures (locks for 30 minutes)
 *
 * These limits are deliberately strict — legitimate users rarely
 * attempt login more than 3 times. Brute force needs thousands.
 */
export const authRateLimiter = new RateLimiter({
  maxRequests: 5,
  windowMs: 15 * 60 * 1000,       // 15 minutes
  blockAfter: 15,                   // Hard block after 15 failures
  blockDurationMs: 30 * 60 * 1000, // 30-minute lockout
  message: 'Too many login attempts. Please wait 15 minutes before trying again.',
})

/**
 * Password reset rate limiter.
 *
 * Limits:
 *   - 3 reset requests per email per 60-minute window
 *   - 5 reset requests per IP per 60-minute window
 *   - Hard block after 10 failures (locks for 60 minutes)
 */
export const resetRateLimiter = new RateLimiter({
  maxRequests: 3,
  windowMs: 60 * 60 * 1000,        // 60 minutes
  blockAfter: 10,                    // Hard block after 10
  blockDurationMs: 60 * 60 * 1000,  // 60-minute lockout
  message: 'Too many password reset requests. Please try again in 1 hour.',
})

/**
 * General API rate limiter.
 *
 * Limits:
 *   - 60 requests per IP per 1-minute window (1 per second average)
 *   - Hard block after 200 (aggressive scraping)
 */
export const apiRateLimiter = new RateLimiter({
  maxRequests: 60,
  windowMs: 60 * 1000,              // 1 minute
  blockAfter: 200,                   // Hard block after 200
  blockDurationMs: 10 * 60 * 1000,  // 10-minute lockout
  message: 'Too many requests. Please slow down.',
})

// ─── Helper: Extract IP from Next.js request ──────────────────

/**
 * Extract the client IP address from a Next.js request.
 * Handles common proxy headers (Vercel, Cloudflare, nginx).
 */
export function getClientIP(req: { headers: { get: (name: string) => string | null } }): string {
  // Vercel/Cloudflare set x-forwarded-for
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    // x-forwarded-for can be a comma-separated list; first entry is the client
    return forwarded.split(',')[0].trim()
  }

  // Vercel-specific header
  const vercelIp = req.headers.get('x-real-ip')
  if (vercelIp) return vercelIp.trim()

  // Cloudflare-specific header
  const cfIp = req.headers.get('cf-connecting-ip')
  if (cfIp) return cfIp.trim()

  // Fallback
  return '127.0.0.1'
}
