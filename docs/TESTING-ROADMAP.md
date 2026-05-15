# Automated Testing Roadmap (Bug #16)

## Why This Matters

NexMediconHMS currently has **ZERO automated tests**. Every code change relies on manual testing:
- Developer changes a function → manually clicks through the app to verify
- Bug fix in one module might silently break another module
- No way to know if a deployment is safe before pushing to production
- In a **healthcare application**, bugs can lead to wrong medication doses, missed appointments, or lost patient data

## What Types of Tests Do We Need?

### 1. Unit Tests (Test individual functions in isolation)

**What they test:** A single function with specific inputs → verify correct output.

**Example:**
```typescript
// Testing src/lib/date-utils.ts
import { getTodayIST } from './date-utils'

test('getTodayIST returns correct IST date at 2 AM IST', () => {
  // At 2 AM IST on Jan 15, UTC would be Jan 14 at 8:30 PM
  jest.setSystemTime(new Date('2025-01-14T20:30:00.000Z'))
  expect(getTodayIST()).toBe('2025-01-15')  // Should be Jan 15 in IST!
})

test('getTodayIST returns correct date at 6 AM IST', () => {
  // At 6 AM IST on Jan 15, UTC would be Jan 15 at 00:30 AM
  jest.setSystemTime(new Date('2025-01-15T00:30:00.000Z'))
  expect(getTodayIST()).toBe('2025-01-15')  // Same date both timezones
})
```

**What to test first (highest value):**
- `src/lib/date-utils.ts` — IST conversion logic (Bug #19 regression prevention)
- `src/lib/sanitize-search.ts` — SQL pattern escaping (Bug #9 regression prevention)
- `src/lib/utils.ts` — calculateBMI, calculateEDD, calculateGA, ageFromDOB
- `src/lib/appointment-status.ts` — status constant correctness
- `src/lib/services/appointmentService.ts` — follow-up creation logic

### 2. Integration Tests (Test modules working together)

**What they test:** Multiple functions/components interacting, usually with a real or mocked database.

**Example:**
```typescript
// Testing appointmentService with mocked Supabase
import { createFollowUp } from './appointmentService'
import { supabase } from './supabase'

jest.mock('./supabase')

test('createFollowUp cancels old appointment before creating new one', async () => {
  // Mock: existing follow-up with linked appointment
  supabase.from.mockReturnValue({
    select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => ({
      data: { id: 'fu-1', linked_appointment_id: 'appt-1', recommended_date: '2025-01-10' }
    }) }) }) }) })
  })
  
  await createFollowUp('patient-1', 'enc-1', '2025-01-20', { patientName: 'Test' })
  
  // Verify: old appointment was cancelled
  expect(supabase.from('appointments').update).toHaveBeenCalledWith(
    expect.objectContaining({ status: 'cancelled' })
  )
  // Verify: new appointment was created with correct date
  expect(supabase.from('appointments').insert).toHaveBeenCalledWith(
    expect.objectContaining({ date: '2025-01-20', status: 'scheduled' })
  )
})
```

### 3. End-to-End (E2E) Tests (Test full user workflows)

**What they test:** Real browser, real clicks, real navigation — simulates actual user behavior.

**Example:**
```typescript
// Using Playwright (recommended for Next.js)
import { test, expect } from '@playwright/test'

test('New consultation flow — happy path', async ({ page }) => {
  // Login
  await page.goto('/login')
  await page.fill('[name=email]', 'doctor@clinic.com')
  await page.fill('[name=password]', 'TestPass123!')
  await page.click('button[type=submit]')
  await page.waitForURL('/dashboard')
  
  // Navigate to OPD
  await page.click('text=New Consultation')
  await page.waitForURL('/opd')
  
  // Search patient
  await page.fill('input[placeholder*="patient name"]', 'Priya')
  await page.waitForSelector('text=Priya Sharma')
  await page.click('text=Start Consultation')
  
  // Verify form is EMPTY (Bug #1 fix)
  await expect(page.locator('input[placeholder="72"]')).toHaveValue('')  // Pulse empty
  await expect(page.locator('textarea')).toHaveValue('')  // Chief complaint empty
  
  // Fill vitals
  await page.fill('input[placeholder="72"]', '80')
  await page.fill('input[placeholder="120"]', '130')
  
  // Save
  await page.click('text=Save & Continue')
  await page.waitForURL(/\/opd\/.*\/prescription/)
  
  // Verify on prescription page
  await expect(page).toHaveURL(/\/prescription/)
})
```

---

## Recommended Testing Stack

| Tool | Purpose | Why This One |
|------|---------|--------------|
| **Vitest** | Unit + Integration tests | Fast, works with Next.js/TypeScript, similar to Jest but faster |
| **React Testing Library** | Component rendering tests | Tests components like users use them (not implementation details) |
| **Playwright** | E2E browser tests | Official recommendation from Next.js, works with all browsers |
| **MSW (Mock Service Worker)** | API mocking for tests | Intercepts Supabase/API calls without modifying production code |

---

## Implementation Plan

### Phase 1: Setup (Week 1) — Configuration Only

```bash
# Install testing dependencies
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
npm install -D @playwright/test
npm install -D msw

# Add test scripts to package.json
```

Add to `package.json`:
```json
{
  "scripts": {
    "test": "vitest --run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "test:coverage": "vitest --run --coverage"
  }
}
```

Create `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

### Phase 2: Critical Path Unit Tests (Week 2)

| File to Test | Test File | Priority |
|-------------|-----------|----------|
| `src/lib/date-utils.ts` | `tests/unit/date-utils.test.ts` | 🔴 Critical (Bug #19) |
| `src/lib/sanitize-search.ts` | `tests/unit/sanitize-search.test.ts` | 🔴 Critical (Bug #9) |
| `src/lib/utils.ts` | `tests/unit/utils.test.ts` | 🟠 High |
| `src/lib/appointment-status.ts` | `tests/unit/appointment-status.test.ts` | 🟡 Medium |
| `src/lib/services/appointmentService.ts` | `tests/unit/appointment-service.test.ts` | 🟠 High |

**Goal:** 100% coverage on utility functions. These are pure functions — easiest to test.

### Phase 3: API Route Tests (Week 3)

| API Route | Test Cases |
|-----------|------------|
| `POST /api/users/reset-password` | ✅ Admin can reset, ❌ Non-admin rejected, ❌ Invalid userId returns 404 |
| `POST /api/users/invite` | ✅ Creates user, ❌ Duplicate email rejected, ❌ Invalid role rejected |
| `POST /api/doctor-note-ocr` | ✅ Returns structured data, ❌ No image returns 400, ❌ No auth returns 401 |

### Phase 4: Component Tests (Week 4)

| Component | Key Test Cases |
|-----------|---------------|
| `KeyboardShortcuts` | Alt+D navigates to /dashboard, doesn't fire when typing in input |
| `PaginationControls` | Next/Previous disabled at boundaries, shows correct page numbers |
| `ConsultationAttachments` | Upload triggers correct storage mode, error shown on failure |

### Phase 5: E2E Workflows (Weeks 5-6)

| Workflow | Positive Case | Negative/Edge Case |
|----------|--------------|-------------------|
| Patient Registration | Fill form → save → appears in list | Duplicate mobile rejected |
| OPD Consultation | Search patient → fill vitals → save → prescription page | Empty form validation |
| Follow-up Booking | Set follow-up date → save → appears in appointments | Date in past rejected |
| Login + MFA | Login → MFA code → dashboard | Wrong code → error message |
| Billing | Generate bill → mark paid → revenue updated | Zero amount rejected |

---

## Test File Structure

```
/projects/sandbox/nexmediconhms/
├── tests/
│   ├── setup.ts                          # Global test setup (mocks, env vars)
│   ├── unit/
│   │   ├── date-utils.test.ts
│   │   ├── sanitize-search.test.ts
│   │   ├── utils.test.ts
│   │   ├── appointment-status.test.ts
│   │   └── appointment-service.test.ts
│   ├── integration/
│   │   ├── api-reset-password.test.ts
│   │   ├── api-users-invite.test.ts
│   │   └── api-doctor-note-ocr.test.ts
│   ├── components/
│   │   ├── KeyboardShortcuts.test.tsx
│   │   ├── PaginationControls.test.tsx
│   │   └── ConsultationAttachments.test.tsx
│   └── e2e/
│       ├── patient-registration.spec.ts
│       ├── opd-consultation.spec.ts
│       ├── follow-up-booking.spec.ts
│       ├── login-mfa.spec.ts
│       └── billing-flow.spec.ts
├── vitest.config.ts
├── playwright.config.ts
└── package.json (updated scripts)
```

---

## Example: First Test File You Should Write

Here's a complete, copy-paste-ready test for `sanitize-search.ts`:

```typescript
// tests/unit/sanitize-search.test.ts
import { describe, it, expect } from 'vitest'
import { sanitizeSearchInput } from '@/lib/sanitize-search'

describe('sanitizeSearchInput', () => {
  // ── Normal inputs (should pass through unchanged) ──────────
  it('passes normal text unchanged', () => {
    expect(sanitizeSearchInput('Priya Sharma')).toBe('Priya Sharma')
  })

  it('passes numbers unchanged', () => {
    expect(sanitizeSearchInput('9876543210')).toBe('9876543210')
  })

  it('passes MRN codes unchanged', () => {
    expect(sanitizeSearchInput('MRN00123')).toBe('MRN00123')
  })

  it('returns empty string for empty input', () => {
    expect(sanitizeSearchInput('')).toBe('')
  })

  // ── Dangerous inputs (wildcards must be escaped) ──────────
  it('escapes % wildcard', () => {
    expect(sanitizeSearchInput('%')).toBe('\\%')
    expect(sanitizeSearchInput('100%')).toBe('100\\%')
  })

  it('escapes _ wildcard', () => {
    expect(sanitizeSearchInput('test_user')).toBe('test\\_user')
  })

  it('escapes backslash', () => {
    expect(sanitizeSearchInput('path\\file')).toBe('path\\\\file')
  })

  it('escapes multiple special characters', () => {
    expect(sanitizeSearchInput('%_\\')).toBe('\\%\\_\\\\')
  })

  // ── Real-world attack patterns ─────────────────────────────
  it('neutralizes "show all records" attack', () => {
    // Attacker types just "%" hoping to see all patients
    const result = sanitizeSearchInput('%')
    // In the query: ilike.%\%% — will match literal % only
    expect(result).not.toBe('%')
    expect(result).toBe('\\%')
  })

  it('handles mixed normal and special chars', () => {
    expect(sanitizeSearchInput('Dr. 100% sure')).toBe('Dr. 100\\% sure')
  })
})
```

---

## CI/CD Integration

Once tests are written, add to your deployment pipeline:

```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run test          # Unit + Integration
      - run: npx playwright install
      - run: npm run test:e2e      # E2E (requires env vars for Supabase)
```

---

## Summary: What to Do Right Now

1. **Install Vitest:** `npm install -D vitest jsdom @testing-library/react`
2. **Create `vitest.config.ts`** (copy from above)
3. **Write `tests/unit/sanitize-search.test.ts`** (copy from above — your first test!)
4. **Run:** `npx vitest --run` — see it pass
5. **Add `date-utils.test.ts`** next (most critical for Bug #19 prevention)
6. **Gradually expand** following the phases above

The goal is NOT to have 100% coverage on day 1. Start with the **functions that already caused bugs** — that way you prevent regressions and build confidence that fixes stay fixed.
