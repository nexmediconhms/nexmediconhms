/**
 * src/app/api/portal/health-check/route.ts
 *
 * Portal Health Check Endpoint
 *
 * Hit this URL to verify the portal fix is deployed correctly:
 *   https://your-domain.com/api/portal/health-check
 *
 * Returns deployment info, environment status, AND the URL that
 * WOULD be generated if you clicked the Portal button right now.
 *
 * KEY OUTPUT TO CHECK:
 *   sample_urls.verify_url ← This is what patients will see
 *   url_construction_correct: true ← Means the URL is well-formed
 *   url_uses_current_deployment: true ← Means the URL points to a LIVE deployment
 */

import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * SAME logic as send-link/route.ts — uses request host as primary source.
 * This guarantees the URL points to the LIVE deployment, not a stale env var.
 */
function getSiteOrigin(req: NextRequest): string {
  const forwardedHost = req.headers.get('x-forwarded-host')
  const host = req.headers.get('host')
  const proto = req.headers.get('x-forwarded-proto') || 'https'
  const liveHost = forwardedHost || host

  if (liveHost) {
    try {
      const u = new URL(`${proto}://${liveHost}`)
      return u.origin
    } catch {
      // Fall through
    }
  }

  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL
  if (fromEnv && fromEnv.trim()) {
    try {
      const u = new URL(fromEnv.trim())
      return u.origin
    } catch {
      // Fall through
    }
  }

  if (process.env.VERCEL_URL) {
    try {
      const u = new URL(`https://${process.env.VERCEL_URL}`)
      return u.origin
    } catch {
      // Fall through
    }
  }

  return 'https://your-domain.vercel.app'
}

export async function GET(req: NextRequest) {
  const origin = getSiteOrigin(req)
  const requestHost = req.headers.get('x-forwarded-host') || req.headers.get('host') || ''

  // Build sample URLs using URL constructor (bulletproof)
  const sampleVerifyUrl = new URL('/portal/verify', origin)
  sampleVerifyUrl.searchParams.set('token', 'SAMPLE-TOKEN-FOR-TESTING')

  const sampleLoginUrl = new URL('/portal/login', origin)

  // Detect issues
  const envSiteUrl = process.env.NEXT_PUBLIC_SITE_URL || ''
  const hasTrailingSlashIssue = envSiteUrl.endsWith('/')

  // Check if URL has double slashes (should NEVER happen with new code)
  const verifyUrlString = sampleVerifyUrl.toString()
  const verifyHasDoubleSlash = verifyUrlString.split('://')[1]?.includes('//') || false

  // CRITICAL CHECK: Does the URL point to the same deployment as the request?
  let urlUsesCurrentDeployment = false
  try {
    const sampleUrlObj = new URL(verifyUrlString)
    urlUsesCurrentDeployment = sampleUrlObj.host === requestHost
  } catch {
    urlUsesCurrentDeployment = false
  }

  // Determine the issue (if any)
  let issue: string | null = null
  let action: string | null = null

  if (verifyHasDoubleSlash) {
    issue = 'Generated URL has double-slash. URL construction logic is broken.'
    action = 'Check the deployment — fix code may not be deployed correctly.'
  } else if (!urlUsesCurrentDeployment && envSiteUrl) {
    issue = `Generated URL points to a DIFFERENT deployment than the current one. The env var NEXT_PUBLIC_SITE_URL points to "${envSiteUrl}" but you are on "${requestHost}".`
    action = 'Either: (a) Remove NEXT_PUBLIC_SITE_URL env var entirely (recommended — code will use request host), OR (b) Update it to your actual production domain.'
  } else if (hasTrailingSlashIssue) {
    issue = 'NEXT_PUBLIC_SITE_URL has a trailing slash (cosmetic issue, fix code handles it).'
    action = 'Optional: Remove the trailing / in Vercel env vars for cleanliness.'
  }

  return NextResponse.json({
    deployment: {
      timestamp: new Date().toISOString(),
      fix_version: 'fix/portal-use-request-host',
      vercel_env: process.env.VERCEL_ENV || 'unknown',
      vercel_url: process.env.VERCEL_URL || 'not-set',
      vercel_region: process.env.VERCEL_REGION || 'unknown',
      node_env: process.env.NODE_ENV || 'unknown',
    },
    env_check: {
      NEXT_PUBLIC_SITE_URL_set: !!envSiteUrl,
      NEXT_PUBLIC_SITE_URL_has_trailing_slash: hasTrailingSlashIssue,
      NEXT_PUBLIC_SITE_URL_value: envSiteUrl || '(not set, using request host)',
      derived_origin: origin,
      derived_origin_source: req.headers.get('x-forwarded-host') || req.headers.get('host')
        ? 'request_host_header'
        : envSiteUrl
        ? 'env_var'
        : 'fallback',
    },
    request_info: {
      host_header: req.headers.get('host') || 'none',
      forwarded_proto: req.headers.get('x-forwarded-proto') || 'none',
      forwarded_host: req.headers.get('x-forwarded-host') || 'none',
    },
    sample_urls: {
      verify_url: sampleVerifyUrl.toString(),
      login_url: sampleLoginUrl.toString(),
      verify_url_has_double_slash: verifyHasDoubleSlash,
      url_points_to_host: new URL(verifyUrlString).host,
    },
    fix_status: {
      url_construction_correct: !verifyHasDoubleSlash,
      url_uses_current_deployment: urlUsesCurrentDeployment,
      env_var_clean: !hasTrailingSlashIssue,
      ready_for_production: !verifyHasDoubleSlash && urlUsesCurrentDeployment,
    },
    instructions: issue ? { issue, action } : { status: 'All good. URL points to current deployment.' },
  }, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
    },
  })
}
