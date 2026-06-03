# 🛡️ Portal 404 — Bulletproof Fix (5 Layers of Defense)

## The Problem
The WhatsApp message contains a portal link with **double slash** in the URL:
```
https://nexmediconhms-sarvam-iagzpcxz5-nexmediconhms.vercel.app//portal/verify?token=xxx
                                                              ^^
                                                              double slash
```
When the patient clicks this link, it opens a 404 page because Next.js can't match `//portal/verify` to any route.

## Root Cause
The `NEXT_PUBLIC_SITE_URL` environment variable in your Vercel deployment ends with a trailing slash. When the code builds the URL as `${siteUrl}/portal/verify`, it produces `//portal/verify`.

## The 5-Layer Fix in This Branch

### 🛡️ Layer 1 — Middleware Normalization (`src/middleware.ts`)
**The strongest layer.** The Edge Middleware now intercepts EVERY incoming request and:
- Detects any pathname containing `//` (consecutive slashes)
- Collapses them to single `/`
- Issues a **301 permanent redirect** to the normalized URL
- Browser caches the redirect, so the link works forever

This means **even if the env variable is wrong, the link still works**. Patients get redirected from `//portal/verify` → `/portal/verify` automatically.

### 🛡️ Layer 2 — Next.js Redirects (`next.config.js`)
Added a `redirects()` config that catches double-slash patterns and 301-redirects them. This runs at the routing layer, BEFORE middleware, as a backup.

### 🛡️ Layer 3 — Bulletproof URL Construction (`api/portal/send-link/route.ts`)
The code that GENERATES portal URLs now uses the native `URL()` constructor:
```js
const u = new URL('/portal/verify', origin)  // automatically normalizes
u.searchParams.set('token', token)
return u.toString()  // never has double slashes
```
**The URL constructor mathematically guarantees no double slashes.** Even if `origin` has trailing slashes, the constructor strips them.

### 🛡️ Layer 4 — Smart 404 Page Recovery (`src/app/not-found.tsx`)
If somehow a malformed URL still reaches the 404 page (e.g. cached service worker), the page detects portal URLs and auto-redirects to the correct path. The patient never sees the 404.

### 🛡️ Layer 5 — Origin Detection from Request (`getSiteOrigin()`)
The send-link route now derives the origin in this priority order:
1. `NEXT_PUBLIC_SITE_URL` env var (parsed via `URL()` to strip slashes)
2. `VERCEL_URL` auto-injected by Vercel
3. **Request `host` header** (works on any platform, no env var needed)
4. Hardcoded fallback

So even if env vars are missing/wrong, the URL is built from the actual request host.

---

## What This Means for the Doctor

### For URLs already sent in WhatsApp (with double slash)
✅ **They will now work.** When the patient clicks the link, the middleware redirects them to the correct URL automatically.

### For new URLs generated after this deploy
✅ **They will be correctly formatted.** No more double slashes in WhatsApp messages.

### Required Action After Deploying This Branch
**Just deploy.** No env variable changes needed. The fixes work even if `NEXT_PUBLIC_SITE_URL` still has a trailing slash.

But for cleanliness, you SHOULD also update the env variable:
1. Go to Vercel → Settings → Environment Variables
2. Find `NEXT_PUBLIC_SITE_URL`
3. Remove the trailing slash (e.g. `https://yourdomain.com/` → `https://yourdomain.com`)
4. Click **Save** → Vercel will redeploy automatically

---

## Test Cases After Deployment

### Test 1: Old WhatsApp Link (with double slash)
1. Open the existing WhatsApp message (with `//portal/verify`)
2. Click the link
3. **Expected:** Browser briefly shows redirect, then opens portal verify page → success message → redirects to `/portal/dashboard`

### Test 2: Send New Link
1. Login as staff
2. Click "Portal" button on any patient
3. **Expected:** WhatsApp opens with link `https://yourdomain.com/portal/verify?token=xxx` (single slash)

### Test 3: Direct URL Type
1. Type `https://yourdomain.com//portal/verify?token=ABC` in browser
2. **Expected:** Auto-redirects to `/portal/verify?token=ABC`, processes token

### Test 4: Patient Portal Dashboard
1. Patient verifies via magic link
2. **Expected:** Dashboard loads showing:
   - Patient profile
   - Prescriptions
   - Lab Reports
   - Bills
   - Appointments
   - Book Follow-up button

### Test 5: Triple Slash (extreme edge case)
1. Type `https://yourdomain.com///portal/verify?token=ABC`
2. **Expected:** Middleware normalizes `///` → `/`, redirects, works

---

## Files Changed in This Branch

| File | Layer | Change |
|------|-------|--------|
| `src/middleware.ts` | Layer 1 | Added double-slash normalization redirect |
| `next.config.js` | Layer 2 | Added `redirects()` rule for double slashes |
| `src/app/api/portal/send-link/route.ts` | Layer 3 | Bulletproof URL construction with `new URL()` |
| `src/app/not-found.tsx` | Layer 4 | Smart recovery on 404 |
| `src/components/shared/PatientPortalLinkButton.tsx` | (bonus) | Auth header fix from earlier branch |
| `migrations/017_comprehensive_schema_alignment.sql` | (bonus) | DB schema alignment for portal tables |

---

## Verification Commands

After deployment, run these tests:

```bash
# Test 1: Verify middleware catches double slashes
curl -I "https://yourdomain.com//portal/verify?token=test"
# Expected: HTTP/2 301 with Location: /portal/verify?token=test

# Test 2: Verify single slash works
curl -I "https://yourdomain.com/portal/verify?token=test"
# Expected: HTTP/2 200 (page renders)

# Test 3: Verify the verify-otp API
curl -X POST "https://yourdomain.com/api/portal/auth/verify-otp" \
  -H "Content-Type: application/json" \
  -d '{"token":"INVALID"}'
# Expected: 401 with {"error":"Invalid or expired link"}
```
