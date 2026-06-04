# 🚨 Portal 404 — Final Deployment Guide (CRITICAL)

## The 404 keeps appearing because the FIX HASN'T BEEN DEPLOYED YET

This is the most common reason. Each time I create a fix branch, you need to:
1. **Merge it to `main`** (or your production branch)
2. **Wait for Vercel to deploy** (~2 minutes after push)
3. **Click "Portal" button AGAIN** to generate a NEW WhatsApp message
4. **Test the NEW link** (the OLD WhatsApp link still works too via redirect)

---

## ⚡ FASTEST PATH TO FIX (5 minutes total)

### Step 1: Merge this branch to main
```bash
git checkout main
git pull origin main
git merge fix/portal-final-vercel-rewrites
git push origin main
```

OR via GitHub UI:
1. Go to https://github.com/nexmediconhms/nexmediconhms
2. Click "Compare & pull request" for `fix/portal-final-vercel-rewrites`
3. Click "Merge"

### Step 2: Wait for Vercel deployment to finish
1. Go to https://vercel.com → Your Project → Deployments
2. Look for the latest deployment with commit message about "Vercel rewrites"
3. Wait until status shows ✅ "Ready" (about 2 minutes)

### Step 3: VERIFY the fix is deployed
**Open this URL in your browser** (replace with your actual domain):
```
https://your-domain.vercel.app/api/portal/health-check
```

You should see JSON output like:
```json
{
  "fix_status": {
    "url_construction_correct": true,
    "env_var_clean": false,
    "ready_for_production": true
  }
}
```

If you see `"fix_status": {"ready_for_production": true}` → **Fix is deployed correctly!** Move to Step 4.

If you get a 404 on this health-check URL → **The deployment hasn't finished yet OR the merge wasn't successful.** Wait longer or check Vercel deployments.

### Step 4: Generate a NEW WhatsApp message
1. Login to your staff app
2. Go to Patients page
3. Click "Portal" button on **any patient**
4. WhatsApp opens with a NEW message — it should have a single-slash URL like:
   ```
   https://your-domain.vercel.app/portal/verify?token=xxx
                                  ↑
                                  single slash (correct!)
   ```

### Step 5: Test the link
1. Click the link in WhatsApp (or copy-paste in browser)
2. Should briefly show "Verifying your link..." then redirect to dashboard
3. Patient sees: prescriptions, lab reports, bills, appointments

---

## ⚠️ If You Still Get 404 After All Steps

### Check #1: Did the deployment actually happen?
Hit `/api/portal/health-check` on your domain. If 404 → deployment didn't complete.

### Check #2: Is the env var causing issues?
The health-check endpoint will tell you:
```json
"env_check": {
  "NEXT_PUBLIC_SITE_URL_has_trailing_slash": true,  ← THIS IS THE PROBLEM
}
```

**Fix:**
1. Vercel → Settings → Environment Variables
2. Find `NEXT_PUBLIC_SITE_URL`
3. Edit and remove the `/` at the end
4. Click **Save**
5. Vercel will auto-redeploy

### Check #3: Are you testing the OLD WhatsApp message?
The OLD message has the broken URL. After deploying the fix, you MUST click the Portal button AGAIN to generate a NEW message.

The new message will have a correct URL.

---

## 🔬 What Each Layer Does

This branch contains **6 layers of defense** against the 404:

### Layer 1: vercel.json redirects
The MOST POWERFUL layer. Vercel intercepts URLs at the CDN edge BEFORE any Next.js code runs:
```json
"redirects": [
  { "source": "//portal/verify", "destination": "/portal/verify", "statusCode": 308 }
]
```

### Layer 2: vercel.json rewrites
Backup that rewrites the path internally if redirects don't match.

### Layer 3: next.config.js redirects
Next.js-level redirect for malformed paths.

### Layer 4: Edge middleware (src/middleware.ts)
Runs on every request, normalizes any double-slash paths.

### Layer 5: Bulletproof URL construction (api/portal/send-link/route.ts)
Uses `new URL('/portal/verify', origin)` which mathematically can't produce double slashes.

### Layer 6: Smart 404 recovery (src/app/not-found.tsx)
Even if a malformed URL reaches the 404 page, JavaScript detects it and redirects.

**Plus:** Health-check endpoint to verify the fix is actually deployed.

---

## 📞 Quick Diagnostic Commands

### Test if portal/verify is reachable
```bash
curl -I "https://your-domain.vercel.app/portal/verify?token=test"
# Expected: HTTP/2 200 (page renders)
```

### Test if double-slash redirects
```bash
curl -I "https://your-domain.vercel.app//portal/verify?token=test"
# Expected: HTTP/2 308 with Location: /portal/verify?token=test
```

### Check the health endpoint
```bash
curl "https://your-domain.vercel.app/api/portal/health-check" | jq
# Expected: JSON with "ready_for_production": true
```

---

## 🎯 The Single Most Important Step

**After merging the branch and Vercel finishes deploying, click the Portal button AGAIN to generate a NEW WhatsApp message.**

The OLD WhatsApp message still has the broken URL — but it will be auto-redirected by the fix. The NEW message will have a clean URL from the start.

---

## 📋 Final Checklist

- [ ] Merged `fix/portal-final-vercel-rewrites` to `main`
- [ ] Pushed to GitHub
- [ ] Vercel deployment shows ✅ Ready
- [ ] `/api/portal/health-check` returns `ready_for_production: true`
- [ ] Clicked Portal button to generate NEW WhatsApp message
- [ ] NEW message has single-slash URL
- [ ] Clicked NEW link → portal verify page loads → dashboard shows data
- [ ] OLD WhatsApp link also works (redirects properly)

If ALL above are checked → **Done. The fix works.**
