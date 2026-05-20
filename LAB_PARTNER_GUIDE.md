# Lab Partner Access Guide — NexMedicon HMS

## Overview

Lab partners (external pathology labs like SRL, Thyrocare, local labs) can upload patient reports directly to the portal without needing a Supabase account.

---

## Setup Steps (Admin)

### 1. Create Lab Partner Record

Run in **Supabase SQL Editor**:

```sql
-- Create lab partner
INSERT INTO lab_partners (name) VALUES ('City Pathology Lab');

-- Create portal user with auth token
INSERT INTO lab_portal_users (name, email, lab_partner_id, auth_token, is_active)
VALUES (
  'Ramesh (City Pathology)',
  'ramesh@citypathlab.com',
  (SELECT id FROM lab_partners WHERE name = 'City Pathology Lab'),
  'LP-' || encode(gen_random_bytes(16), 'hex'),
  true
);

-- Get the generated token to share with the lab
SELECT auth_token FROM lab_portal_users WHERE email = 'ramesh@citypathlab.com';
```

### 2. Share the Portal URL with Lab Partner

Give the lab partner:
- **URL**: `https://your-app.vercel.app/lab-partner-portal`
- **Token**: The `auth_token` from step 1

### 3. Create Required Tables (if not exists)

```sql
-- Already included in migrations/001-fix-beds-schema.sql
-- Run that migration if you haven't already
```

---

## Lab Partner Workflow

### Step 1: Login
1. Open the Lab Partner Portal URL
2. Enter the auth token provided by the hospital
3. Click "Verify Token"

### Step 2: Upload Report
1. Enter patient **MRN** (e.g., P-042) — the system auto-searches
2. Select the **report type** (e.g., "CBC Report", "Thyroid Profile")
3. Enter the **report date**
4. Add any **notes** (e.g., "Sample collected yesterday")
5. Attach the **PDF file** of the lab report
6. Click **Upload Report**

### Step 3: What Happens Automatically
- Report is stored in `lab_reports` table with link to patient
- Doctor gets an **in-app alert** (dashboard) about the new report
- Patient gets a **WhatsApp notification** that report is ready
- If **AI extraction is enabled** (OPENAI_API_KEY configured):
  - All test values are extracted from the PDF
  - Abnormal values are flagged
  - Doctor gets a **critical alert** for abnormal values
- Report appears in the patient's profile under "Lab Reports"

### Step 4: View Upload History
- The portal shows all previously uploaded reports
- Status tracking: uploaded → processing → completed

---

## Doctor/Staff Workflow

### Viewing Lab Reports
1. Go to **Patient Profile** → Lab Reports section
2. Reports uploaded by lab partners show "Portal Upload" badge
3. Click on any report to see:
   - PDF attachment
   - AI-extracted values (if available)
   - Abnormal value alerts

### Dashboard Alerts
- Abnormal lab values appear as **red/orange alerts** on the Dashboard
- Click "Done" to dismiss after reviewing

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/labs/lab-portal` | GET | Verify token, get partner info |
| `/api/labs/lab-portal` | POST | Upload lab report (multipart) |
| `/api/labs/extract` | POST | AI extraction from report PDF |
| `/api/labs/notify` | POST | Send notifications to doctor/patient |

---

## Security

- **Token-based auth**: No Supabase credentials needed by lab
- **Token rotation**: Admin can regenerate tokens anytime
- **Audit trail**: Every upload is logged with timestamp and token used
- **MRN validation**: Reports are linked to verified patient records
- **Rate limiting**: Consider adding rate limiting in production

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Invalid token" | Check token is correct, check `is_active = true` |
| "Patient not found" | Verify MRN format (P-042 or P042 both work) |
| "Upload failed" | Check file size < 10MB, must be PDF |
| "AI extraction not working" | Set `OPENAI_API_KEY` in environment variables |

---

## Environment Variables Required

```env
# For lab portal
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# For AI extraction (optional but recommended)
OPENAI_API_KEY=sk-your-openai-key
```
