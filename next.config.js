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

const nextConfig = {
  experimental: {
    // Server-only CJS modules that must NOT be bundled for the browser.
    // NOTE: pdfjs-dist is intentionally excluded — it runs in the BROWSER
    // via dynamic import in pdf-to-image.ts.  Adding it here breaks client rendering.
    serverComponentsExternalPackages: ['pdf-parse', 'pdf-lib', 'tesseract.js', 'canvas'],
    // Allow useSearchParams() in client pages without requiring a Suspense boundary
    missingSuspenseWithCSRBailout: false,
  },
}

module.exports = withPWA(nextConfig)
