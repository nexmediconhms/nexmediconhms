/**
 * src/lib/env.ts
 *
 * Centralized environment-variable validation.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Before this module, several API routes did:
 *
 *    const supabase = createClient(
 *      process.env.NEXT_PUBLIC_SUPABASE_URL!,
 *      process.env.SUPABASE_SERVICE_ROLE_KEY!,
 *      ...
 *    )
 *
 * at the *top level* of a route file.  If the env var was missing or
 * empty, this surfaced as a generic
 *      "Error: supabaseKey is required."
 * 50 frames deep inside the Supabase SDK during `next build`, with
 * zero indication of *which* variable was wrong, *which* file
 * triggered it, or *how* to fix it.
 *
 * This module replaces that with single, well-tested helpers:
 *
 *    const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL')
 *
 * which throw clear, actionable errors with a "Get it from / Add to"
 * hint for every known env-var name.
 *
 * USAGE
 * ─────
 *   import { requireEnv, optionalEnv, getEnvOrFallback } from '@/lib/env'
 *
 *   // Required — throws if missing/empty
 *   const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL')
 *
 *   // Optional — returns undefined if missing
 *   const flag = optionalEnv('OPTIONAL_FEATURE_FLAG')
 *
 *   // Fallback chain — first non-empty wins; warns on fallback
 *   const key = getEnvOrFallback(
 *     ['SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'],
 *     { usedBy: 'supabase-admin.ts' }
 *   )
 *
 *   // Bulk check at app startup (e.g. in instrumentation.ts)
 *   assertRequiredEnv([
 *     'NEXT_PUBLIC_SUPABASE_URL',
 *     'NEXT_PUBLIC_SUPABASE_ANON_KEY',
 *     'SUPABASE_SERVICE_ROLE_KEY',
 *   ])
 *
 * NOTES
 * ─────
 * - All checks are LAZY (called from inside handlers/factories, NOT at
 *   module top-level).  This is critical: `next build` evaluates module
 *   top-level code during page-data collection, and any synchronous
 *   throw there crashes the entire build.
 * - Empty string ("") is treated the same as missing.
 * - A placeholder like "your-key-here" passes the empty check; use
 *   `looksLikePlaceholder` for the heuristic placeholder detector.
 */

/**
 * Maps known env-var names to actionable instructions, used to build
 * friendly error messages.  Adding a new entry here costs nothing and
 * pays back the next time someone hits "missing env var" at 2 AM.
 */
const ENV_HINTS: Record<string, { source: string; addTo: string }> = {
  NEXT_PUBLIC_SUPABASE_URL: {
    source: 'Supabase dashboard → Project Settings → API → Project URL',
    addTo: '.env.local',
  },
  NEXT_PUBLIC_SUPABASE_ANON_KEY: {
    source: 'Supabase dashboard → Project Settings → API → anon / public',
    addTo: '.env.local',
  },
  SUPABASE_SERVICE_ROLE_KEY: {
    source: 'Supabase dashboard → Project Settings → API → service_role  (KEEP SECRET — bypasses RLS)',
    addTo: '.env.local (NEVER commit to git)',
  },
  ANTHROPIC_API_KEY: {
    source: 'console.anthropic.com → API Keys',
    addTo: '.env.local',
  },
  OPENAI_API_KEY: {
    source: 'platform.openai.com → API Keys',
    addTo: '.env.local',
  },
  RAZORPAY_KEY_ID: {
    source: 'Razorpay Dashboard → Settings → API Keys',
    addTo: '.env.local',
  },
  RAZORPAY_KEY_SECRET: {
    source: 'Razorpay Dashboard → Settings → API Keys (Secret)',
    addTo: '.env.local (NEVER commit)',
  },
  RAZORPAY_WEBHOOK_SECRET: {
    source: 'Razorpay Dashboard → Settings → Webhooks → Secret',
    addTo: '.env.local',
  },
  HOSPITAL_ENCRYPTION_KEY: {
    source: 'Generate with: openssl rand -hex 32',
    addTo: '.env.local (NEVER rotate without re-encrypting PHI)',
  },
  CRON_SECRET: {
    source: 'Generate with: openssl rand -hex 32',
    addTo: '.env.local + Vercel Cron headers',
  },
  LAB_IMPORT_SECRET: {
    source: 'Generate with: openssl rand -hex 32',
    addTo: '.env.local',
  },
  E2E_LOGIN_EMAIL: {
    source: 'Dedicated test/staging account (NEVER reuse a production login)',
    addTo: '.env.test.local OR CI secret',
  },
  E2E_LOGIN_PASSWORD: {
    source: 'Dedicated test/staging account password',
    addTo: '.env.test.local OR CI secret',
  },
}

function hintFor(name: string): string {
  const hint = ENV_HINTS[name]
  if (!hint) return ''
  return `\n           Get it from: ${hint.source}\n           Add to:      ${hint.addTo}`
}

/**
 * Return a required env var.  Throws a clear error if missing or empty.
 *
 * @param name      The environment variable name (e.g. 'SUPABASE_SERVICE_ROLE_KEY')
 * @param usedBy    (optional) The file or module name making the request,
 *                  to make the error message more actionable.
 */
export function requireEnv(name: string, usedBy?: string): string {
  const raw = process.env[name]
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (value === '') {
    const usedByLine = usedBy ? `\n           Used by:     ${usedBy}` : ''
    throw new Error(
      `Missing required environment variable: ${name}${usedByLine}${hintFor(name)}`
    )
  }
  return value
}

/**
 * Return an optional env var, or `undefined` if it is missing/empty.
 * Never throws.
 */
export function optionalEnv(name: string): string | undefined {
  const raw = process.env[name]
  const value = typeof raw === 'string' ? raw.trim() : ''
  return value === '' ? undefined : value
}

/**
 * Try a chain of env-var names; return the first non-empty value.
 * Throws if NONE of them are set.
 *
 * Useful for back-compat fallbacks like:
 *   getEnvOrFallback(['SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'])
 *
 * @param names              Candidate env-var names, highest priority first.
 * @param opts.usedBy        Optional caller name for the error message.
 * @param opts.warnFallback  If true, console.warn when we fall back to a
 *                           lower-priority var. Default true (helps catch
 *                           silent runtime degradation).
 */
export function getEnvOrFallback(
  names: string[],
  opts: { usedBy?: string; warnFallback?: boolean } = {}
): string {
  const { usedBy, warnFallback = true } = opts
  for (let i = 0; i < names.length; i++) {
    const v = optionalEnv(names[i])
    if (v !== undefined) {
      if (i > 0 && warnFallback) {
        // eslint-disable-next-line no-console
        console.warn(
          `[env] '${names[0]}' is missing; falling back to '${names[i]}'` +
            (usedBy ? ` (used by ${usedBy})` : '') +
            `. This may cause RLS / permission issues at runtime.`
        )
      }
      return v
    }
  }
  const usedByLine = usedBy ? `\n           Used by: ${usedBy}` : ''
  throw new Error(
    `Missing env vars (tried in order): ${names.join(', ')}${usedByLine}${hintFor(names[0])}`
  )
}

/**
 * Validate a list of required env vars all at once.
 * Throws a single aggregated error listing every missing variable.
 *
 * Intended to be called at application startup (e.g. from
 * `instrumentation.ts`) so a misconfigured deploy fails loudly
 * BEFORE serving any traffic.
 */
export function assertRequiredEnv(names: string[]): void {
  const missing: string[] = []
  for (const name of names) {
    const raw = process.env[name]
    if (!raw || (typeof raw === 'string' && raw.trim() === '')) {
      missing.push(name)
    }
  }
  if (missing.length > 0) {
    const lines = missing.map((n) => `  • ${n}${hintFor(n)}`).join('\n')
    throw new Error(
      `Environment validation failed.  ${missing.length} required variable(s) missing:\n${lines}`
    )
  }
}

/**
 * Best-effort detection of placeholder values like "your-key-here",
 * "REPLACE_ME", "CHANGE_THIS", or suspiciously short values.
 *
 * This is a HEURISTIC — not a security check — meant to catch the
 * common case where someone copies `.env.production.example` to
 * `.env.local` and forgets to substitute real values.
 */
export function looksLikePlaceholder(value: string): boolean {
  if (!value) return true
  const v = value.toLowerCase().trim()
  if (v.length < 8) return true
  const placeholderMarkers = [
    'your-',
    'your_',
    'replace',
    'change',
    'todo',
    'example',
    'placeholder',
    'xxxxxx',
    'redacted',
    '<your',
    '<key',
    '<secret',
  ]
  return placeholderMarkers.some((m) => v.includes(m))
}

/**
 * Friendly summary for logs at startup (NEVER logs values — only
 * names + status).  Useful for a `/api/health` or `/status` endpoint.
 */
export function envStatusSummary(
  names: string[]
): Array<{ name: string; ok: boolean; placeholder: boolean }> {
  return names.map((name) => {
    const value = optionalEnv(name)
    return {
      name,
      ok: value !== undefined,
      placeholder: value !== undefined && looksLikePlaceholder(value),
    }
  })
}