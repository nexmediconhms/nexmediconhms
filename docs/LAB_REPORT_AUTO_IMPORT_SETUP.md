# Lab Report Auto-Import — Complete Setup Guide

## Overview

This guide walks you through setting up automatic lab report import via email.
When a lab sends a report PDF to a specific email address, the system automatically:
1. Receives the email via Mailgun
2. Extracts the PDF attachment
3. Matches it to a patient (by name/MRN in subject or email body)
4. Stores the PDF and creates a lab report entry linked to the patient

---

## Architecture

```
Lab sends email → Mailgun receives → Mailgun Route triggers webhook →
Your API endpoint → Parse PDF → Match patient → Store in Supabase
```

---

## Step-by-Step Setup

### STEP 1: Domain Setup with Cloudflare (DNS Configuration)

**Problem you're facing:** "Not able to go ahead after selecting Cloudflare for domain/DNS."

**Solution:**

1. **Go to Mailgun Dashboard** → Sending → Domains → Add New Domain

2. **Enter your domain:** e.g., `lab.yourhospital.com` (use a subdomain for lab emails)

3. **Mailgun will show DNS records to add.** These are the records you need to add in Cloudflare:

4. **Go to Cloudflare Dashboard** → Select your domain → DNS

5. **Add these records** (Mailgun provides exact values, but here's what they look like):

   | Type | Name | Content | Proxy | TTL |
   |------|------|---------|-------|-----|
   | TXT | lab | `v=spf1 include:mailgun.org ~all` | DNS only (⚠️ NO proxy) | Auto |
   | TXT | smtp._domainkey.lab | `k=rsa; p=XXXXXX...` (Mailgun gives this) | DNS only | Auto |
   | MX | lab | `mxa.mailgun.org` (Priority: 10) | DNS only (⚠️ NO proxy) | Auto |
   | MX | lab | `mxb.mailgun.org` (Priority: 10) | DNS only (⚠️ NO proxy) | Auto |
   | CNAME | email.lab | `mailgun.org` | DNS only (⚠️ NO proxy) | Auto |

   **⚠️ CRITICAL:** All Mailgun DNS records MUST have the orange cloud turned OFF (DNS only / gray cloud). Cloudflare proxy breaks email routing.

6. **Common Cloudflare Error Fix:**
   - If you see "proxy not compatible with MX records" — click the record → toggle proxy OFF
   - MX records in Cloudflare are ALWAYS "DNS only" (cannot be proxied)
   - TXT records should also be "DNS only" for Mailgun

7. **Wait 10-30 minutes** for DNS propagation

8. **Go back to Mailgun** → Click "Verify DNS Settings" → All should show green ✓

**If verification fails:**
- Wait longer (up to 48 hours for some DNS providers)
- Double-check no typos in record values
- Ensure TXT records are on the exact subdomain Mailgun specifies
- In Cloudflare, check that you're adding records to the CORRECT domain

---

### STEP 2: Create Receiving Email Address

In Mailgun:
1. Go to **Receiving** → **Routes**
2. You don't need to "create" an email address — Mailgun routes will catch emails sent to any address on your domain

---

### STEP 3: Create Mailgun Route

This is the core step — the Route tells Mailgun what to do when an email arrives.

1. **Go to Mailgun** → Receiving → Routes → **Create Route**

2. Configure:
   - **Expression Type:** `Match Recipient`
   - **Recipient:** `labreport@lab.yourhospital.com` (or use catch-all: `.*@lab.yourhospital.com`)
   - **Actions:**
     - ✅ **Forward** → `https://yourdomain.vercel.app/api/lab-report-ingest`
     - ✅ **Store and notify** → `https://yourdomain.vercel.app/api/lab-report-ingest`
   - **Priority:** 0
   - **Description:** "Auto-import lab reports to NexMedicon"

3. **Click Create Route**

---

### STEP 4: Create the API Endpoint

Create file: `src/app/api/lab-report-ingest/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Use service role key for server-side operations
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    // Mailgun sends multipart/form-data
    const formData = await req.formData()

    // Extract email metadata
    const from = formData.get('from') as string || ''
    const subject = formData.get('subject') as string || ''
    const body = formData.get('body-plain') as string || ''
    const recipient = formData.get('recipient') as string || ''
    const timestamp = formData.get('timestamp') as string || ''

    // Verify Mailgun signature (security)
    const token = formData.get('token') as string || ''
    const signature = formData.get('signature') as string || ''
    // TODO: Verify HMAC signature with your Mailgun API key

    // Extract attachments (PDF files)
    const attachmentCount = parseInt(formData.get('attachment-count') as string || '0')

    if (attachmentCount === 0) {
      console.log('[Lab Import] No attachments in email from:', from)
      return NextResponse.json({ status: 'no_attachments' })
    }

    // Try to match patient from subject line
    // Expected format: "Lab Report - Patient Name - MRN001" or just "Patient Name"
    const patientMatch = await matchPatient(subject, body)

    for (let i = 1; i <= attachmentCount; i++) {
      const attachment = formData.get(`attachment-${i}`) as File
      if (!attachment) continue

      // Only process PDFs and images
      const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg']
      if (!validTypes.includes(attachment.type)) continue

      // Upload to Supabase Storage
      const fileName = `lab-imports/${Date.now()}_${attachment.name}`
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('patient-documents')
        .upload(fileName, attachment, {
          contentType: attachment.type,
          upsert: false,
        })

      if (uploadError) {
        console.error('[Lab Import] Upload error:', uploadError.message)
        continue
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('patient-documents')
        .getPublicUrl(fileName)

      // Create lab report entry
      const reportPayload: any = {
        report_date: new Date().toISOString().slice(0, 10),
        lab_name: extractLabName(from, subject),
        entries: [], // Empty — will be filled by AI parsing later
        notes: `Auto-imported from email.\nFrom: ${from}\nSubject: ${subject}\nFile: ${attachment.name}`,
        source: 'email_import',
        source_email: from,
        attachment_url: urlData?.publicUrl || fileName,
      }

      if (patientMatch) {
        reportPayload.patient_id = patientMatch.id
      }

      const { error: insertError } = await supabase
        .from('lab_reports')
        .insert(reportPayload)

      if (insertError) {
        console.error('[Lab Import] Insert error:', insertError.message)
      } else {
        console.log('[Lab Import] Successfully imported:', attachment.name, 'for patient:', patientMatch?.full_name || 'UNMATCHED')
      }
    }

    return NextResponse.json({ status: 'ok', processed: attachmentCount })
  } catch (err: any) {
    console.error('[Lab Import] Error:', err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// Match patient from email subject/body
async function matchPatient(subject: string, body: string): Promise<any | null> {
  const text = `${subject} ${body}`.toLowerCase()

  // Try to find MRN pattern (e.g., MRN001, MRN-001, etc.)
  const mrnMatch = text.match(/mrn[- ]?(\w+)/i)
  if (mrnMatch) {
    const { data } = await supabase
      .from('patients')
      .select('id, full_name, mrn')
      .ilike('mrn', `%${mrnMatch[1]}%`)
      .limit(1)
      .maybeSingle()
    if (data) return data
  }

  // Try to find patient name in subject
  // Common format: "Report - Priya Sharma" or "Priya Sharma - CBC Report"
  const { data: patients } = await supabase
    .from('patients')
    .select('id, full_name, mrn')
    .order('created_at', { ascending: false })
    .limit(100)

  if (patients) {
    for (const p of patients) {
      if (text.includes(p.full_name.toLowerCase())) {
        return p
      }
    }
  }

  return null
}

// Extract lab name from sender email
function extractLabName(from: string, subject: string): string {
  // Try to get lab name from email domain
  const domainMatch = from.match(/@([^.]+)/)
  if (domainMatch) {
    const domain = domainMatch[1]
    if (!['gmail', 'yahoo', 'hotmail', 'outlook'].includes(domain.toLowerCase())) {
      return domain.charAt(0).toUpperCase() + domain.slice(1) + ' Lab'
    }
  }

  // Try from subject
  const labKeywords = ['lab', 'pathology', 'diagnostic', 'metropolis', 'srl', 'thyrocare']
  for (const kw of labKeywords) {
    if (subject.toLowerCase().includes(kw)) {
      return subject.split('-')[0].trim() || 'External Lab'
    }
  }

  return 'External Lab (Email Import)'
}
```

---

### STEP 5: Environment Variables

Add to your `.env.local` or Vercel Environment Variables:

```env
# Supabase (already configured)
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Mailgun (for signature verification)
MAILGUN_API_KEY=your_mailgun_api_key
MAILGUN_WEBHOOK_SIGNING_KEY=your_webhook_signing_key
```

---

### STEP 6: Supabase Storage Bucket

1. Go to Supabase Dashboard → Storage
2. Create bucket: `patient-documents` (if not already exists)
3. Set policy: Allow insert for authenticated and service_role

---

### STEP 7: Test the Setup

1. Send a test email to `labreport@lab.yourhospital.com`
2. Attach a PDF lab report
3. Subject: "Lab Report - [Patient Name] - [MRN]"
4. Check Mailgun logs: Sending → Logs
5. Check your API endpoint logs (Vercel → Functions → Logs)
6. Check Lab Reports page in NexMedicon

---

## Troubleshooting

### "Not going ahead after selecting Cloudflare"
- Ensure ALL MX records have proxy OFF (gray cloud)
- Wait 30 minutes after adding DNS records
- Try Mailgun's "Check DNS" button multiple times

### "Webhook not receiving emails"
- Check Mailgun Routes → Logs
- Verify your endpoint is publicly accessible (not localhost)
- Check Vercel function logs for errors

### "PDF not being parsed"
- Ensure `patient-documents` bucket exists in Supabase
- Check SUPABASE_SERVICE_ROLE_KEY is set (not the anon key)

### "Patient not matching"
- Include MRN in email subject: "Report - Priya Sharma - MRN001"
- Patient must exist in database before report arrives
- Name matching is case-insensitive

---

## Future Enhancements Implementation Plan

### 1. AI PDF Parsing (Extract Values from PDF)

**What:** After PDF is stored, run OCR + GPT to extract test values (Hb, WBC, etc.)

**Implementation:**
```typescript
// After uploading PDF, call your existing OCR endpoint:
const response = await fetch('/api/doctor-note-ocr', {
  method: 'POST',
  body: formDataWithPDF,
})
const extracted = await response.json()
// Update lab_reports entry with extracted values
```

**Where:** Add to `lab-report-ingest/route.ts` after the upload step.

### 2. Abnormal Value Alerts

**What:** When a lab value is outside normal range, notify doctor immediately.

**Implementation:**
- After AI extracts values, compare against reference ranges (already in your `LAB_GROUPS` constant)
- If any value is HIGH or LOW, create a notification entry
- Show alert badge on dashboard

**Where:** `src/lib/lab-alerts.ts` (new file) + dashboard component update

### 3. Lab Partner Dashboard

**What:** Give lab partners a separate portal to upload reports directly.

**Implementation:**
- Create `/portal/lab/[partnerId]` page
- Lab partner logs in with a token/link
- Upload interface → directly creates lab_report entry
- Shows their revenue summary

**Where:** `src/app/portal/lab/page.tsx` (new)

### 4. WhatsApp Notification ("Your report is ready")

**What:** Send patient WhatsApp message when their report is imported.

**Implementation:**
```typescript
// After successful import:
const patient = await getPatient(patientId)
const whatsappUrl = `https://wa.me/91${patient.mobile}?text=${encodeURIComponent(
  `Dear ${patient.full_name}, your lab report is ready. Please visit the clinic or call us for results. - ${hospitalName}`
)}`
// Or use WhatsApp Business API for automated sending
```

**Where:** Add to end of `lab-report-ingest/route.ts`

---

*Document Version: 2.0 | Last Updated: May 2026*
