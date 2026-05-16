# Lab Report Auto-Import — Implementation Guide

## Overview

This feature allows partner labs to automatically send lab reports to NexMedicon HMS. When a lab completes a test, the report is automatically attached to the patient's record and the doctor is notified.

---

## How It Works

```
Lab completes test
       ↓
Lab emails PDF to clinic's dedicated email (e.g., labs@yourclinic.com)
       ↓
Email parsing service (SendGrid/Mailgun) forwards to webhook
       ↓
POST /api/labs/import-email
       ↓
System identifies patient from email subject (MRN or name)
       ↓
PDF stored in Supabase Storage
       ↓
Lab report record created in database
       ↓
Doctor sees new report in Labs section (Supabase Realtime)
```

---

## Setup Options (Choose ONE)

### Option A: SendGrid Inbound Parse (Recommended — Free tier available)

1. **Sign up** at [sendgrid.com](https://sendgrid.com) (free plan: 100 emails/day)

2. **Add your domain** (e.g., `yourclinic.com`) in SendGrid → Settings → Sender Auth

3. **Set up MX Record** for `labs.yourclinic.com`:
   ```
   Type: MX
   Host: labs.yourclinic.com
   Value: mx.sendgrid.net
   Priority: 10
   ```

4. **Configure Inbound Parse** in SendGrid:
   - Go to: Settings → Inbound Parse
   - Add: `labs.yourclinic.com`
   - Destination URL: `https://your-app.vercel.app/api/labs/import-email`
   - Check: "POST the raw, full MIME message"

5. **Add env variable** to Vercel:
   ```
   LAB_IMPORT_SECRET=your-secure-random-string
   ```

6. **Tell your lab partners** to email reports to: `reports@labs.yourclinic.com`

### Option B: Mailgun Routes

1. Sign up at [mailgun.com](https://mailgun.com)
2. Create a route that forwards to your webhook URL
3. Same env variable setup

### Option C: Direct API Integration (For tech-savvy labs)

If your lab partner has their own LIS (Lab Information System), they can POST directly:

```bash
curl -X POST https://your-app.vercel.app/api/labs/import-email \
  -H "Authorization: Bearer YOUR_LAB_IMPORT_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "patientId": "uuid-of-patient",
    "reportName": "Complete Blood Count",
    "text": "Hemoglobin: 12.5 g/dL, WBC: 8000/μL",
    "attachmentData": "base64-encoded-pdf-content",
    "attachmentName": "CBC_Report.pdf",
    "labPartnerName": "Niramaya Lab"
  }'
```

---

## Email Subject Format (Important for Auto-Matching)

Tell your lab partners to use ONE of these subject formats:

| Format | Example |
|--------|---------|
| `Report for P-042` | Uses MRN to match |
| `CBC Report - Priya Sharma (P-042)` | Uses MRN + name |
| `Lab Results for Priya Sharma` | Fuzzy name match |
| `Blood Sugar Report - P-042` | Report name + MRN |

**The MRN format (`P-042`) is the most reliable.** Print MRN on lab requisition slips so labs include it.

---

## What Doctor & Staff Need to Do

### For Doctor:
1. **Nothing changes** — reports appear automatically in the patient's Lab tab
2. Check the **Labs** section (🔬) for new reports
3. Reports marked as "Auto-imported" show the source lab

### For Staff (Receptionist):
1. **Print MRN on lab slips** — When sending samples to labs, write the patient's MRN (e.g., P-042) clearly on the request form
2. **Tell labs the email format** — Share the email subject format with partner labs
3. **Verify imports** — Check Labs page daily; if a report couldn't match a patient, it shows in "Unmatched Reports"

### For Lab Partners:
1. **Email reports** to: `reports@labs.yourclinic.com` (or the configured address)
2. **Include patient MRN** in email subject (e.g., "CBC Report for P-042")
3. **Attach PDF** of the report
4. Reports are auto-processed within 1-2 minutes

---

## Fallback: Manual Import

If auto-import fails or isn't configured, staff can:
1. Go to **Labs** page → Click **Upload Report**
2. Select patient → Enter report name → Upload PDF
3. Same result — just manual

---

## Database Changes Required

Run this SQL in Supabase if `lab_reports` table doesn't have the new columns:

```sql
ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';
ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS lab_partner_name TEXT;
ALTER TABLE lab_reports ADD COLUMN IF NOT EXISTS attachment_url TEXT;
```

---

## Environment Variables

```env
# Required for email webhook security
LAB_IMPORT_SECRET=generate-a-random-32-char-string

# Optional: If using SendGrid
SENDGRID_WEBHOOK_KEY=your-sendgrid-verification-key
```

---

## Monitoring & Troubleshooting

- **Check import logs**: Go to Audit Log page → filter by "lab_report_imported"
- **Unmatched reports**: If MRN/name doesn't match, the API returns an error (logged in email service)
- **Storage issues**: If PDF upload fails, report is still created without attachment (staff can manually upload later)

---

## Cost Estimate

| Service | Free Tier | Paid |
|---------|-----------|------|
| SendGrid Inbound Parse | 100 emails/day | $20/mo for 40,000 |
| Supabase Storage | 1 GB free | $0.021/GB after |
| Vercel API calls | 100,000/mo free | Included in Pro |

**For a typical clinic (10-20 lab reports/day): Completely free.**

---

## Future Enhancements

1. **AI PDF Parsing** — Extract values (Hb, WBC, etc.) from PDF using OCR + GPT
2. **Abnormal Value Alerts** — Flag out-of-range results and notify doctor immediately
3. **Lab Partner Dashboard** — Give labs a portal to upload reports directly
4. **WhatsApp Notification** — Send patient a "Your report is ready" message
