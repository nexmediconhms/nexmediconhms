# Supabase Edge Functions & Cron Jobs — Implementation Guide

## Overview

Your NexMedicon HMS needs 3 automated daily tasks that run without any manual effort:

| # | Task | When (IST) | Endpoint |
|---|------|-----------|----------|
| 1 | **Follow-up Escalation** | 8:00 AM | `POST /api/cron/followup-escalation` |
| 2 | **Auto-Send Reminders** | 8:30 AM | `POST /api/reminders/auto-generate` |
| 3 | **Daily Closing Report** | 11:00 PM | `POST /api/billing/daily-closing` |

---

## Option A: Vercel Cron (Recommended — Zero Setup)

If your app is deployed on **Vercel**, this is the easiest option. Already configured in `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/followup-escalation",
      "schedule": "0 2 * * *"
    },
    {
      "path": "/api/reminders/auto-generate",
      "schedule": "30 2 * * *"
    },
    {
      "path": "/api/billing/daily-closing",
      "schedule": "30 17 * * *"
    }
  ]
}
```

> **Note on times:** Vercel cron uses UTC. IST = UTC + 5:30.
> - `0 2 * * *` UTC = 7:30 AM IST
> - `30 2 * * *` UTC = 8:00 AM IST
> - `30 17 * * *` UTC = 11:00 PM IST

### Setup Steps:

1. **Add `CRON_SECRET` to Vercel env**:
   - Go to Vercel → Project → Settings → Environment Variables
   - Add: `CRON_SECRET` = any random 32-character string
   - This protects cron endpoints from unauthorized access

2. **Deploy** — Vercel automatically reads `vercel.json` and schedules the crons

3. **Verify** — Go to Vercel Dashboard → Project → Cron Jobs tab to see scheduled runs

### Vercel Cron Limits:
| Plan | Cron Jobs | Min Interval |
|------|-----------|--------------|
| Hobby (Free) | 2 crons | Daily only |
| Pro ($20/mo) | 40 crons | Every minute |

> **If on Hobby plan:** Combine all 3 into a single endpoint (see Option D below)

---

## Option B: Supabase pg_cron (Free — Database-Level)

If you want crons that run inside Supabase itself (no Vercel needed):

### Step 1: Enable pg_cron Extension

```sql
-- Run in Supabase SQL Editor:
CREATE EXTENSION IF NOT EXISTS pg_cron;
GRANT USAGE ON SCHEMA cron TO postgres;
```

### Step 2: Create SQL Functions for Each Task

```sql
-- Daily Closing at 11 PM IST (5:30 PM UTC)
SELECT cron.schedule(
  'daily-closing',
  '30 17 * * *',
  $$
  INSERT INTO daily_closings (closing_date, closed_by, closed_at)
  SELECT 
    CURRENT_DATE,
    'auto',
    NOW()
  WHERE NOT EXISTS (
    SELECT 1 FROM daily_closings WHERE closing_date = CURRENT_DATE
  );
  $$
);

-- Follow-up escalation at 8 AM IST (2:30 AM UTC)
SELECT cron.schedule(
  'followup-escalation',
  '0 2 * * *',
  $$
  UPDATE follow_ups 
  SET status = 'missed', updated_at = NOW()
  WHERE status = 'pending' 
    AND recommended_date < CURRENT_DATE;
  $$
);
```

> **Limitation:** pg_cron can only run SQL — it can't call your API endpoints or send WhatsApp messages. For that, you need Option A or C.

---

## Option C: Supabase Edge Functions (Most Flexible)

Supabase Edge Functions run Deno/TypeScript on Supabase's infrastructure.

### Step 1: Install Supabase CLI

```bash
npm install -g supabase
supabase login
supabase init  # in your project root
```

### Step 2: Create Edge Function

```bash
supabase functions new cron-handler
```

Create `supabase/functions/cron-handler/index.ts`:

```typescript
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const CRON_SECRET = Deno.env.get('CRON_SECRET') || ''
const APP_URL = Deno.env.get('APP_URL') || 'https://your-app.vercel.app'

serve(async (req) => {
  // Verify cron secret
  const auth = req.headers.get('authorization')?.replace('Bearer ', '') || ''
  if (auth !== CRON_SECRET && CRON_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }

  const url = new URL(req.url)
  const task = url.searchParams.get('task') || 'all'

  const results: Record<string, any> = {}

  // 1. Follow-up escalation
  if (task === 'all' || task === 'followup') {
    try {
      const res = await fetch(`${APP_URL}/api/cron/followup-escalation`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${CRON_SECRET}` },
      })
      results.followup = await res.json()
    } catch (e) {
      results.followup = { error: String(e) }
    }
  }

  // 2. Auto-generate reminders
  if (task === 'all' || task === 'reminders') {
    try {
      const res = await fetch(`${APP_URL}/api/reminders/auto-generate`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${CRON_SECRET}` },
      })
      results.reminders = await res.json()
    } catch (e) {
      results.reminders = { error: String(e) }
    }
  }

  // 3. Daily closing (only after 10 PM IST)
  if (task === 'all' || task === 'closing') {
    try {
      const res = await fetch(`${APP_URL}/api/billing/daily-closing`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${CRON_SECRET}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ closedBy: 'auto-cron' }),
      })
      results.closing = await res.json()
    } catch (e) {
      results.closing = { error: String(e) }
    }
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
```

### Step 3: Deploy & Schedule

```bash
supabase functions deploy cron-handler
```

Then schedule via pg_cron:
```sql
-- Call edge function at 8 AM IST
SELECT cron.schedule(
  'morning-cron',
  '30 2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://your-project.supabase.co/functions/v1/cron-handler?task=all',
    headers := '{"Authorization": "Bearer YOUR_CRON_SECRET"}'::jsonb
  );
  $$
);
```

> Requires `pg_net` extension for HTTP calls from SQL.

---

## Option D: Single Combined Cron Endpoint (For Vercel Hobby Plan)

If you're on Vercel's free plan (limited to 2 crons), create a single endpoint that runs all tasks:

Already implemented at: `POST /api/cron/followup-escalation` handles follow-ups.

Create a combined one:

**File:** `src/app/api/cron/run-all/route.ts` (already considering creating)

This calls all 3 endpoints in sequence. Schedule it once daily.

---

## Option E: External Cron Service (Free Alternatives)

If you don't use Vercel Pro and Supabase pg_cron isn't enough:

| Service | Free Tier | Setup |
|---------|-----------|-------|
| [cron-job.org](https://cron-job.org) | 5 jobs, 1-min interval | Add URL + secret |
| [EasyCron](https://www.easycron.com) | 1 job free | Simple UI |
| [Upstash QStash](https://upstash.com/qstash) | 500 msgs/day free | Best for serverless |
| [GitHub Actions](https://github.com/features/actions) | Unlimited for public repos | Use workflow_dispatch |

### Example: cron-job.org Setup

1. Sign up at cron-job.org
2. Create job:
   - URL: `https://your-app.vercel.app/api/cron/followup-escalation`
   - Method: POST
   - Headers: `Authorization: Bearer YOUR_CRON_SECRET`
   - Schedule: `0 2 * * *` (8 AM IST)
3. Repeat for other endpoints

---

## Environment Variables Required

Add these to your deployment platform (Vercel / Railway / etc.):

```env
# Required for all cron endpoints
CRON_SECRET=generate-a-random-32-character-string-here

# Required for Supabase Edge Functions (Option C)
APP_URL=https://your-app.vercel.app

# Required for daily closing
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### Generate CRON_SECRET:
```bash
openssl rand -hex 16
# Example output: a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5
```

---

## Testing Crons Manually

You can trigger any cron manually for testing:

```bash
# Test follow-up escalation (dry run — no changes)
curl "https://your-app.vercel.app/api/cron/followup-escalation?dryRun=true&secret=YOUR_CRON_SECRET"

# Test auto-generate reminders (dry run)
curl -X POST "https://your-app.vercel.app/api/reminders/auto-generate?dryRun=true" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"

# Test daily closing
curl -X POST "https://your-app.vercel.app/api/billing/daily-closing" \
  -H "Authorization: Bearer YOUR_CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"closedBy": "manual-test"}'
```

---

## Monitoring & Alerts

### Check cron execution in Vercel:
- Vercel Dashboard → Project → **Logs** tab
- Filter by `/api/cron/` to see execution logs

### Check in app:
- **Daily Closing**: Go to Billing → CA Report to verify today's closing exists
- **Reminders**: Go to Reminders page → check "Auto-generated" badge
- **Follow-ups**: Go to Reminders → filter by "Overdue Follow-ups"

### Recommended: Add Slack/Discord alert
Add to each cron endpoint's success response:
```typescript
// After successful execution
if (process.env.SLACK_WEBHOOK_URL) {
  await fetch(process.env.SLACK_WEBHOOK_URL, {
    method: 'POST',
    body: JSON.stringify({ text: `✅ Daily closing completed: ₹${totalCollected} collected` })
  })
}
```

---

## Summary — Recommended Approach

| Your Setup | Recommended Approach |
|------------|---------------------|
| Vercel Pro ($20/mo) | **Option A** — Just deploy, vercel.json handles everything |
| Vercel Hobby (free) | **Option E** — Use cron-job.org (free) to call your endpoints |
| Self-hosted / Railway | **Option E** — Use cron-job.org or system crontab |
| Supabase only (no Vercel) | **Option B + C** — pg_cron + Edge Functions |

**Zero-effort winner:** Deploy on Vercel Pro → crons work automatically from `vercel.json`. No additional setup needed.
