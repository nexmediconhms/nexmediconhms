/**
 * src/app/api/portal/health-check/route.ts
 *
 * Portal Health Check Endpoint
 *
 * Hit this URL to verify the portal fix is deployed:
 *   https://your-domain.com/api/portal/health-check
 *
 * Returns the deployment version, environment info, and a sample
 * portal URL built using the same logic as the send-link route.
 *
 * If the sample URL has a double slash, the env var still has a
 * trailing slash and you need to fix it in Vercel.
 */

import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Same getSiteOrigin logic as send-link route
function getSiteOrigin(req: NextRequest): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL
  if (fromEnv && fromEnv.trim()) {
    try {
      const u = new URL(fromEnv.trim())
      return u.origin
    } catch {
      // Malformed env var
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

  const host = req.headers.get('host')
  const proto = req.headers.get('x-forwarded-proto') || 'https'
  if (host) {
    return `${proto}://${host}`
  }

  return 'https://your-domain.vercel.app'
}

export async function GET(req: NextRequest) {
  const origin = getSiteOrigin(req)

  // Build sample URLs using URL constructor (bulletproof)
  const sampleVerifyUrl = new URL('/portal/verify', origin)
  sampleVerifyUrl.searchParams.set('token', 'SAMPLE-TOKEN-FOR-TESTING')

  const sampleLoginUrl = new URL('/portal/login', origin)

  // Detect if env var has trailing slash issue
  const envSiteUrl = process.env.NEXT_PUBLIC_SITE_URL || ''
  const hasTrailingSlashIssue = envSiteUrl.endsWith('/')

  // Test if URLs have double slashes (they should NEVER have them)
  const verifyHasDoubleSlash = sampleVerifyUrl.toString().includes('://') &&
    sampleVerifyUrl.toString().split('://')[1].includes('//')

  return NextResponse.json({
    deployment: {
      timestamp: new Date().toISOString(),
      fix_version: 'fix/portal-final-vercel-rewrites',
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
    },
    fix_status: {
      url_construction_correct: !verifyHasDoubleSlash,
      env_var_clean: !hasTrailingSlashIssue,
      ready_for_production: !verifyHasDoubleSlash,
    },
    instructions: hasTrailingSlashIssue ? {
      issue: 'NEXT_PUBLIC_SITE_URL has a trailing slash. The fix code handles this, but you should clean it up.',
      action: 'Go to Vercel → Settings → Environment Variables → NEXT_PUBLIC_SITE_URL → Remove the trailing /',
      after: 'Redeploy after saving',
    } : {
      status: 'All good. URL construction is clean.',
    },
  }, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
    },
  })
}
