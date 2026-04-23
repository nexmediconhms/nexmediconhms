# NexMedicon HMS — Complete Deployment Guide
# Deploy from localhost to Vercel production (shareable URL for doctors)

---

## PREREQUISITES (do these once)

1. Create accounts (free):
   - https://github.com       — stores your code
   - https://vercel.com       — hosts your app
   - https://supabase.com     — your database

2. Install on your computer:
   - Node.js 20+ → https://nodejs.org (click "LTS" download)
   - Git → https://git-scm.com/downloads
   - Verify: open Terminal/Command Prompt and run:
     node --version    # should show v20.x.x
     git --version     # should show git version 2.x.x

---

## STEP 1 — SET UP SUPABASE (your database)

1. Go to https://supabase.com → Sign up → New Project
2. Give it a name (e.g. "nexmedicon-clinic"), choose a region close to India (Singapore)
3. **IMPORTANT**: Save the database password — you'll need it later
4. Wait ~2 minutes for it to start

5. Go to SQL Editor (left sidebar) and run these files IN ORDER:
   - Paste contents of `supabase_setup.sql` → Run
   - Paste contents of `supabase_add_discharge.sql` → Run
   - Paste contents of `supabase_add_billing.sql` → Run
   - Paste contents of `supabase_v5_updates.sql` → Run
   - Paste contents of `supabase_v6_updates.sql` → Run
   - Paste contents of `supabase_v7_abdm_fhir.sql` → Run
   - Paste contents of `supabase_add_aadhaar.sql` → Run
   - Paste contents of `supabase_v8_roles.sql` → Run ← **NEW: roles & user management**
   - Paste contents of `supabase_v9_appointments.sql` → Run ← **NEW: appointments in database**
   - Paste contents of `supabase_v10_procedures.sql` → Run ← **NEW: procedure tracking**

   ⚠️ Do NOT run `seed_demo_data.sql` on a production database!

6. Get your Supabase credentials:
   - Go to Project Settings → API
   - Copy "Project URL" → this is your `SUPABASE_URL`
   - Copy "anon public" key → this is your `SUPABASE_ANON_KEY`
   - Copy "service_role" key → this is your `SUPABASE_SERVICE_ROLE_KEY`
     ⚠️ Keep the service_role key secret — never expose it in frontend code

---

## STEP 2 — GET AI API KEY (for PDF/photo scanning)

You only need ONE of these:

**Option A: OpenAI (easiest, $5 credit lasts months)**
1. Go to https://platform.openai.com → Sign up
2. Go to API Keys → Create new secret key
3. Copy the key (starts with sk-)

**Option B: Anthropic Claude**
1. Go to https://console.anthropic.com → Sign up
2. Go to API Keys → Create Key
3. Copy the key (starts with sk-ant-)

---

## STEP 3 — SET UP YOUR CODE ON GITHUB

Open Terminal in the `hms-mvp` folder:

```bash
# Install dependencies
npm install

# Initialise git (if not already done)
git init
git add .
git commit -m "NexMedicon HMS v1"

# Create a new repo on GitHub (go to github.com → New Repository)
# Then connect:
git remote add origin https://github.com/YOUR_USERNAME/nexmedicon-hms.git
git branch -M main
git push -u origin main
```

---

## STEP 4 — DEPLOY TO VERCEL

1. Go to https://vercel.com → Sign up with GitHub → click "Import"
2. Find your `nexmedicon-hms` repo → Import
3. Framework: Next.js (auto-detected)
4. Click **Environment Variables** and add EACH of these:

| Variable Name | Value | Required? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase Project URL | ✅ Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anon key | ✅ Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase service_role key | ✅ Yes (for user management) |
| `OPENAI_API_KEY` | Your OpenAI key (sk-...) | ✅ Yes (or use Anthropic) |
| `ANTHROPIC_API_KEY` | Your Anthropic key (sk-ant-...) | Alternative to OpenAI |
| `NEXT_PUBLIC_HOSPITAL_NAME` | e.g. Dr. Patel Gynecology Clinic | ✅ Yes |
| `NEXT_PUBLIC_SITE_URL` | Leave blank for now (fill after deploy) | Fill after deploy |

Optional (for payments):
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | rzp_live_... | Optional |
| `RAZORPAY_KEY_ID` | rzp_live_... | Optional |
| `RAZORPAY_KEY_SECRET` | Your Razorpay secret | Optional |
| `NEXT_PUBLIC_UPI_ID` | yourname@bankname | Optional |

5. Click **Deploy** → wait 3-4 minutes

6. After deploy: copy your production URL (e.g. https://nexmedicon.vercel.app)
   Go back to Vercel → Settings → Environment Variables
   Update `NEXT_PUBLIC_SITE_URL` = `https://nexmedicon.vercel.app`
   Then redeploy: Deployments → three dots → Redeploy

---

## STEP 5 — CREATE YOUR FIRST LOGIN (Admin Account)

1. Go to Supabase → Authentication → Users → **Add User**
2. Enter the **doctor/admin email** and a **password**
3. Open your production URL → log in with that email/password
4. The system will detect this is the first login and show a **"Set Up Admin Account"** screen
5. Enter the admin's full name → click "Create Admin Account"
6. You're now the admin with full access!

---

## STEP 6 — INVITE STAFF (Doctor & Receptionist)

1. Log in as admin → go to **Settings** (sidebar)
2. Scroll down to **"Manage Users"** section
3. Click **"Invite New User"**
4. Enter the staff member's:
   - Full name
   - Email address
   - Role: **Doctor** or **Staff**
5. Click "Create User" → a temporary password is generated
6. **Share the temporary password** with the staff member
7. They can log in and should change their password

### Role Permissions

| Feature | Admin | Doctor | Staff |
|---------|-------|--------|-------|
| View patients | ✅ | ✅ | ✅ |
| Register patients | ✅ | ✅ | ✅ |
| OPD consultations | ✅ | ✅ | View only |
| Write prescriptions | ✅ | ✅ | ❌ |
| Billing | ✅ | View | ✅ |
| Financial reports | ✅ | ❌ | ❌ |
| Manage users | ✅ | ❌ | ❌ |
| Settings | ✅ | ✅ | View only |
| Delete patients | ✅ | ❌ | ❌ |

---

## STEP 7 — CONFIGURE THE APP

1. Open your production URL → log in as admin
2. Go to **Settings** (sidebar) → fill in:
   - Hospital Name
   - Doctor Name & Qualifications
   - Address, Phone
   - Consultation fees
   - UPI ID (for payment links)
3. Click **Save**

---

## EVERY TIME YOU MAKE CHANGES

```bash
# In your hms-mvp folder:
git add .
git commit -m "describe what you changed"
git push
```

Vercel automatically redeploys in ~2 minutes after every push. 
No manual action needed — just push to GitHub.

---

## TROUBLESHOOTING

**"Invalid email or password"** → Check the email/password in Supabase → Authentication → Users

**"Access Not Configured"** → The user exists in Supabase Auth but doesn't have a clinic_users record. Admin needs to invite them from Settings → Manage Users.

**"Invalid API key"** → Check Vercel env vars, make sure no extra spaces, redeploy

**"Cannot connect to database"** → Check SUPABASE_URL and SUPABASE_ANON_KEY in Vercel env vars

**"PDF upload fails"** → 
  - Scanned image PDFs: use the Camera button to photograph instead
  - Fillable PDFs: should work without AI key
  - Check AI Status page in the app (/ai-setup)

**"Page not found" after changes** → Vercel may still be deploying, wait 2 min

**WhatsApp links not working** → Set NEXT_PUBLIC_SITE_URL to your full production URL

**Patient self-registration QR not working** → Same as above — NEXT_PUBLIC_SITE_URL must be set

**"Forgot password" not sending email** → Check Supabase → Authentication → Email Templates. Supabase sends emails via their built-in SMTP (free tier: 4 emails/hour).

**User management "Failed to create"** → Make sure SUPABASE_SERVICE_ROLE_KEY is set in Vercel env vars

---

## SHARE WITH THE CLINIC

Once deployed, share:
- **Doctor/Staff login URL**: `https://your-app.vercel.app` (they use their email/password)
- **Patient self-registration**: `https://your-app.vercel.app/intake?h=HospitalName`
  (shown as QR in app → Patient Intake → Digital Form tab)
- **Patient self-registration (Gujarati)**: `https://your-app.vercel.app/intake?h=HospitalName&lang=gu`

---

## ENVIRONMENT VARIABLES REFERENCE

```
# Required
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...  ← NEW (for user management)
NEXT_PUBLIC_HOSPITAL_NAME=Your Hospital Name
NEXT_PUBLIC_SITE_URL=https://your-app.vercel.app

# Required for PDF/photo scanning (add at least one)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# Optional — payments
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_live_...
RAZORPAY_KEY_ID=rzp_live_...
RAZORPAY_KEY_SECRET=...
NEXT_PUBLIC_UPI_ID=hospital@bankname
```

---

## DATA SAFETY

- All patient data is stored in Supabase (PostgreSQL) with Row Level Security
- Only authenticated clinic staff can access patient records
- Role-based access: staff can't edit prescriptions, only admins can delete patients
- Supabase provides automatic daily backups (on Pro plan)
- Data is stored in SOC2-certified infrastructure
- The `/intake` page (patient self-registration) only allows inserting new patients — no read/update access
