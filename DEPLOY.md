# NexMedicon HMS — Deployment Guide

## 🚀 Deploy to Vercel (Recommended — Free)

### Step 1: Push to GitHub
```bash
cd hms-mvp
git init
git add .
git commit -m "NexMedicon HMS v18"
# Create repo at github.com/new, then:
git remote add origin https://github.com/YOUR_USERNAME/nexmedicon-hms.git
git push -u origin main
```

### Step 2: Connect to Vercel
1. Go to **vercel.com** → Sign up free with GitHub
2. Click **"Add New Project"** → Import your GitHub repo
3. Framework: **Next.js** (auto-detected)
4. Click **"Environment Variables"** and add ALL of these:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | From Supabase → Project → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | From Supabase → Project → Settings → API |
| `ANTHROPIC_API_KEY` | From console.anthropic.com → API Keys |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | From Razorpay dashboard (rzp_live_...) |
| `RAZORPAY_KEY_ID` | Same as above |
| `RAZORPAY_KEY_SECRET` | From Razorpay dashboard |
| `NEXT_PUBLIC_UPI_ID` | Your hospital UPI (yourhospital@bank) |
| `NEXT_PUBLIC_HOSPITAL_NAME` | Your hospital name |
| `NEXT_PUBLIC_SITE_URL` | Your Vercel URL (e.g. https://nexmedicon.vercel.app) |

5. Click **Deploy** — takes 2-3 minutes
6. Your URL: `https://your-project.vercel.app`

### Step 3: Set up Supabase for Production
- In Supabase → Settings → API → Allowed URLs: add your Vercel URL
- Run all SQL migrations in order (see below)

---

## 📱 Mobile App (PWA — Install from Browser)

NexMedicon HMS is a **Progressive Web App**. No app store needed.

### On Android (Chrome):
1. Open your deployed URL in Chrome
2. Tap the **⋮ menu** → **"Add to Home screen"**
3. Tap **Add** — icon appears on home screen like a native app

### On iPhone (Safari):
1. Open your deployed URL in Safari
2. Tap the **Share button** (box with arrow)
3. Scroll down → **"Add to Home Screen"**
4. Tap **Add** — icon appears on home screen

### What the PWA gives you:
- ✅ Opens full-screen (no browser bar)
- ✅ Works offline for navigation
- ✅ Camera access (for OCR scanning)
- ✅ Home screen icon with NexMedicon logo
- ✅ Fast load times (cached)
- ✅ Works on Android + iPhone + iPad + Desktop

---

## 🗄️ SQL Migrations (Run in Order in Supabase → SQL Editor)

1. `supabase_setup.sql` — patients, encounters, prescriptions, beds
2. `supabase_add_discharge.sql` — discharge summaries
3. `supabase_add_billing.sql` — bills table
4. `supabase_v5_updates.sql` — performance indexes
5. `supabase_v6_updates.sql` — mediclaim, attachments, IPD nursing, baby_birth_time

### Supabase Storage Bucket (required for file uploads):
Storage → New Bucket → Name: `consultation-files` → **Private** → Save

---

## ⚙️ Supabase Auth Settings
Authentication → URL Configuration:
- Site URL: `https://your-project.vercel.app`
- Redirect URLs: `https://your-project.vercel.app/**`

---

## 🔑 Getting Your API Keys

| Key | Where to get |
|---|---|
| Supabase URL + Anon Key | supabase.com → Project → Settings → API |
| Anthropic API Key | console.anthropic.com → API Keys → Create Key |
| Razorpay Keys | dashboard.razorpay.com → Settings → API Keys |

---

## 🐛 Troubleshooting

**OCR / AI features showing errors:**
→ Check ANTHROPIC_API_KEY is set in Vercel env vars and doesn't contain "YOUR"
→ Restart deployment after adding env vars

**Patient data not saving:**
→ Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
→ Make sure SQL migrations were run

**File uploads failing:**
→ Create "consultation-files" bucket in Supabase Storage
→ Set bucket to Private

**Login not working on deployed URL:**
→ Add your Vercel URL to Supabase Auth → URL Configuration → Redirect URLs
