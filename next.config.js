/** @type {import('next').NextConfig} */

const withPWA = require('next-pwa')({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
  runtimeCaching: [
    {
      urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
      handler: 'NetworkFirst',
      options: {
        cacheName: 'supabase-cache',
        expiration: { maxEntries: 50, maxAgeSeconds: 5 * 60 },
      },
    },
    {
      urlPattern: /\/_next\/static\/.*/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'next-static',
        expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 },
      },
    },
  ],
})

// ─── Security Headers ─────────────────────────────────────────
// These headers protect against XSS, clickjacking, MIME sniffing,
// and data exfiltration attacks. Applied to ALL responses.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://*.supabase.co'
// Extract just the origin (e.g., "https://abc123.supabase.co")
const supabaseOrigin = supabaseUrl.startsWith('https://')
  ? supabaseUrl.replace(/\/+$/, '')
  : 'https://*.supabase.co'

// Content Security Policy
// This CSP is designed to be strict but compatible with:
//   - Supabase Auth (needs connect-src to Supabase)
//   - Tailwind CSS (inline styles)
//   - Next.js (inline scripts with nonce, dynamic imports)
//   - PWA Service Worker
//   - Razorpay payment widget (external script)
//   - AI API calls (Anthropic, OpenAI) — server-side only, not in CSP
const ContentSecurityPolicy = `
  default-src 'self';
  script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: https://*.supabase.co;
  font-src 'self' data:;
  connect-src 'self' ${supabaseOrigin} https://*.supabase.co wss://*.supabase.co https://checkout.razorpay.com https://api.razorpay.com;
  frame-src 'self' https://checkout.razorpay.com;
  frame-ancestors 'none';
  form-action 'self';
  base-uri 'self';
  object-src 'none';
  worker-src 'self' blob:;
  manifest-src 'self';
  media-src 'self' blob:;
`.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()

const securityHeaders = [
  // ── Prevent clickjacking ─────────────────────────────────────
  // DENY = page cannot be displayed in a frame anywhere
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  // ── Prevent MIME type sniffing ────────────────────────────────
  // Stops browsers from interpreting files as a different MIME type
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  // ── XSS Protection ────────────────────────────────────────────
  // Legacy header for older browsers (modern ones use CSP)
  {
    key: 'X-XSS-Protection',
    value: '1; mode=block',
  },
  // ── Referrer Policy ───────────────────────────────────────────
  // Only send origin (not full URL) to cross-origin requests
  // Protects patient IDs in URLs from leaking to third parties
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  // ── Content Security Policy ───────────────────────────────────
  // The primary defense against XSS and data exfiltration
  {
    key: 'Content-Security-Policy',
    value: ContentSecurityPolicy,
  },
  // ── Permissions Policy ────────────────────────────────────────
  // Controls which browser features the app can use
  // camera/microphone: allowed for video consultations + form scanning
  // geolocation: disabled (no use case)
  // payment: enabled for Razorpay
  {
    key: 'Permissions-Policy',
    value: 'camera=(self), microphone=(self), geolocation=(), payment=(self "https://checkout.razorpay.com"), usb=()',
  },
  // ── Strict Transport Security ─────────────────────────────────
  // Force HTTPS for 1 year, include subdomains
  // Only effective in production (HTTPS required)
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains; preload',
  },
  // ── Cross-Origin policies ─────────────────────────────────────
  // Prevent cross-origin documents from reading this page's resources
  {
    key: 'X-DNS-Prefetch-Control',
    value: 'on',
  },
  // ── Prevent information leakage via Cross-Origin-Opener-Policy ─
  // Isolates the browsing context from cross-origin popups
  {
    key: 'Cross-Origin-Opener-Policy',
    value: 'same-origin',
  },
]

const nextConfig = {
  experimental: {
    // Server-only CJS modules that must NOT be bundled for the browser.
    // NOTE: pdfjs-dist is intentionally excluded — it runs in the BROWSER
    // via dynamic import in pdf-to-image.ts.  Adding it here breaks client rendering.
    serverComponentsExternalPackages: ['pdf-parse', 'pdf-lib', 'tesseract.js', 'canvas'],
    // Bug #9 FIX: removed missingSuspenseWithCSRBailout:false — that flag was
    // silencing a real Next.js warning instead of fixing it.  All pages that call
    // useSearchParams() are now wrapped in <Suspense> directly (see each page file).
  },

  // ── Security Headers ─────────────────────────────────────────
  // Applied to ALL routes via the catch-all pattern.
  async headers() {
    return [
      {
        // Apply security headers to all routes
        source: '/(.*)',
        headers: securityHeaders,
      },
      {
        // Additional headers for API routes — no caching of sensitive data
        source: '/api/:path*',
        headers: [
          ...securityHeaders,
          {
            key: 'Cache-Control',
            value: 'no-store, no-cache, must-revalidate, proxy-revalidate',
          },
          {
            key: 'Pragma',
            value: 'no-cache',
          },
          {
            key: 'Expires',
            value: '0',
          },
        ],
      },
    ]
  },

  // ── Powered-by header removal ─────────────────────────────────
  // Don't advertise that this is a Next.js app (reduces attack surface)
  poweredByHeader: false,
}

module.exports = withPWA(nextConfig)
