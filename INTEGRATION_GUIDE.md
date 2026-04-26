# NexMedicon HMS — v11 Integration Guide

## What's in this patch

| Feature | Files |
|---------|-------|
| **A. Lab Results → Supabase** | `supabase_v11_improvements.sql` · `src/app/labs/page.tsx` |
| **B. OPD Queue → Realtime** | `supabase_v11_improvements.sql` · `src/app/queue/page.tsx` |
| **D. Billing → GST + Packages** | `supabase_v11_improvements.sql` · `src/lib/billing-gst.ts` · `src/components/billing/BillingExtras.tsx` |
| **E. Audit Log** | `supabase_v11_improvements.sql` · `src/lib/audit.ts` · `src/app/audit-log/page.tsx` |
| **F. API Route Auth Middleware** | `src/lib/api-auth.ts` |
| **Doctor Note Handwriting OCR** | `src/app/api/doctor-note-ocr/route.ts` · `src/components/shared/ConsultationAttachments.tsx` |

---

## Step 1 — Run the SQL migration

In Supabase → SQL Editor, paste and run:

```
supabase_v11_improvements.sql
```

This creates:
- `lab_reports` table
- `opd_queue` table (or adds to it if it exists)
- `billing_packages` table + adds GST columns to `bills`
- `audit_log` table
- `v_active_users` view
- Triggers for auto invoice numbers, audit on patient delete, updated_at

---

## Step 2 — Enable Supabase Realtime for OPD Queue

1. Supabase Dashboard → **Database → Replication**
2. Find `opd_queue` in the table list
3. Toggle it **ON**

The queue page will now show a **⚡ Live** badge and update instantly when any token status changes.

---

## Step 3 — Copy/replace files

Replace these files in your project:

```
src/app/labs/page.tsx                         ← full replacement
src/app/queue/page.tsx                        ← full replacement
src/components/shared/ConsultationAttachments.tsx ← full replacement
```

Add these new files:

```
src/lib/audit.ts
src/lib/api-auth.ts
src/lib/billing-gst.ts
src/components/billing/BillingExtras.tsx
src/app/api/doctor-note-ocr/route.ts
src/app/audit-log/page.tsx
```

---

## Step 4 — Migrate existing localStorage lab data (one-time)

If users have lab reports stored in localStorage, they can migrate manually:
run this in the browser console on the labs page to export and re-import,
OR add a one-time migration button to the labs page.

The new Supabase-backed labs page is a **drop-in replacement** — all new reports
go to Supabase. Old localStorage reports won't disappear until the user
clears their browser storage.

---

## Step 5 — Wire Audit Log into existing pages (recommended places)

Add `import { audit } from '@/lib/audit'` and call `audit(...)` in:

| Page | Where to call audit |
|------|---------------------|
| `patients/new/page.tsx` | After successful patient create |
| `patients/[id]/edit/page.tsx` | After save |
| `patients/[id]/page.tsx` | On delete |
| `opd/[id]/page.tsx` | On encounter save |
| `billing/page.tsx` | On bill create, mark paid |
| `login/page.tsx` | After successful login: `auditLogin(email)` |
| `AppShell.tsx` | On signOut: `auditLogout(email)` |
| `[id]/prescription/page.tsx` | On print |
| `[id]/discharge/page.tsx` | On discharge save |

The `audit()` function is **fire-and-forget** — it never throws or blocks the UI.

---

## Step 6 — Wire API Route Auth into existing API routes

Replace unprotected routes one by one. Example for `api/discharge-ai/route.ts`:

```ts
// OLD:
export async function POST(req: NextRequest) {
  // ... no auth check

// NEW:
import { requireAuth } from '@/lib/api-auth'

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth   // 401 if not logged in
  // ... rest unchanged
```

For admin-only routes (e.g. user management):
```ts
const auth = await requireRole(req, 'admin')
if (auth instanceof Response) return auth
```

**Important:** The frontend must pass the token. Update `fetch()` calls to include:
```ts
const { data: { session } } = await supabase.auth.getSession()
headers: { Authorization: `Bearer ${session?.access_token}` }
```

The new `/api/doctor-note-ocr` route already demonstrates this pattern.

---

## Step 7 — Add billing GST to billing/page.tsx

1. Import the new components:
```ts
import { GSTSelector, PackageSelector, BillTotalSummary } from '@/components/billing/BillingExtras'
import { calculateTotals } from '@/lib/billing-gst'
```

2. Add state:
```ts
const [gstPercent, setGstPercent] = useState(0)
const [gstAmount,  setGstAmount]  = useState(0)
const [packageId,  setPackageId]  = useState('')
const [packageName,setPackageName]= useState('')
```

3. Replace total calculation:
```ts
const { afterDiscount, gstAmount: gst, netAmount } = calculateTotals(subtotal, discount, gstPercent)
```

4. Add to form JSX (beside discount field):
```tsx
<GSTSelector
  gstPercent={gstPercent}
  subtotalAfterDiscount={subtotal - discount}
  onChange={(pct, amt) => { setGstPercent(pct); setGstAmount(amt) }}
/>
<PackageSelector
  onSelect={(pkg) => {
    setItems(pkg.items)
    setPackageId(pkg.id)
    setPackageName(pkg.name)
  }}
/>
```

5. Add to Supabase insert:
```ts
gst_percent: gstPercent,
gst_amount:  gstAmount,
package_id:  packageId   || null,
package_name:packageName || null,
```

---

## Step 8 — Add Audit Log to Admin sidebar

In `src/components/layout/Sidebar.tsx`, add to the admin-only nav items:

```ts
{ href: '/audit-log', label: 'Audit Log', icon: Shield, roles: ['admin'] }
```

---

## Step 9 — Doctor Note Handwriting OCR

**No setup needed** — it uses the same `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` already in your `.env`.

The new `ConsultationAttachments.tsx` adds a **📖 Read Handwriting** button (purple book icon) on every uploaded image. It:
- Works with cursive, block, mixed handwriting
- Understands Indian medical abbreviations (c/o, h/o, P/A, P/V, etc.)
- Shows a transcription + structured extraction modal
- Falls back gracefully if no AI key configured

**Tips for best results:**
- Good lighting, no shadows
- Camera directly above the note (not at an angle)
- If still unreadable, try enhancing contrast in phone photo editor before upload

---

## Environment variables (no new ones needed)

All features use existing env vars:
```
NEXT_PUBLIC_SUPABASE_URL     ← already set
NEXT_PUBLIC_SUPABASE_ANON_KEY ← already set
SUPABASE_SERVICE_ROLE_KEY    ← already set (needed for api-auth.ts)
ANTHROPIC_API_KEY            ← already set (for doctor note OCR)
```

---

## Troubleshooting

**"audit_log: permission denied"** → User is not admin. The RLS policy on audit_log allows SELECT only for admins.

**"opd_queue: column not found"** → Run `supabase_v11_improvements.sql` first.

**"lab_reports: relation does not exist"** → Run the SQL migration.

**Doctor note OCR returns low confidence** → Image quality issue. Ensure: (1) good lighting, (2) camera perpendicular to paper, (3) no motion blur.

**Realtime not working** → Check Supabase Dashboard → Database → Replication → opd_queue is toggled ON.

**Billing packages not showing** → The SQL migration seeds 4 default packages. Check `billing_packages` table in Supabase.
