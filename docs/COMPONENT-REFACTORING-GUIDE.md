# Component Refactoring Guide (Bug #14)

## Problem

Several pages in NexMediconHMS are **monolithic** — single files with 500-1700 lines:

| File | Lines | Concern |
|------|-------|---------|
| `src/app/opd/new/page.tsx` | 1697 | Vitals form, OB form, OCR, Camera, Voice, all in one |
| `src/app/patients/[id]/page.tsx` | ~900 | Patient detail, encounters, prescriptions, labs, billing, insurance tabs |
| `src/app/appointments/page.tsx` | ~700 | List, new form, reminder generator, WhatsApp templates |

## Recommended Decomposition

### Phase 1: Extract Shared UI Components (Low Risk)

Already started:
- `src/components/shared/PaginationControls.tsx` ✅

Next candidates:
- `SearchBar.tsx` — debounced search input (used in 4+ pages)
- `ErrorBanner.tsx` — error display with retry button
- `StatusBadge.tsx` — appointment/encounter status pill
- `PatientCard.tsx` — patient name + MRN + age display (used everywhere)

### Phase 2: Split OPD New Page (Medium Risk)

Split `src/app/opd/new/page.tsx` into:
```
src/app/opd/new/
  page.tsx              — Shell + state orchestrator (200 lines)
  VitalsForm.tsx        — Vitals tab content
  ConsultationForm.tsx  — Diagnosis tab content
  OBGynForm.tsx         — Gynecology tab content
  DoctorNoteCamera.tsx  — Camera + OCR for handwritten notes
  FormScannerSection.tsx — Paper form scanner section
```

### Phase 3: Split Patient Detail (Medium Risk)

Split `src/app/patients/[id]/page.tsx` into:
```
src/app/patients/[id]/
  page.tsx              — Shell + data loading
  PatientHeader.tsx     — Header card with action buttons
  OverviewTab.tsx       — Overview content
  VisitsTab.tsx         — Encounters list
  PrescriptionsTab.tsx  — Prescriptions list
  DischargeTab.tsx      — Discharge summaries
  BillingTab.tsx        — Bills list
  InsuranceTab.tsx      — Insurance info
```

## Rules for Safe Refactoring

1. **One component at a time** — extract, test, then move to next
2. **Props down, events up** — child components receive data via props, report changes via callbacks
3. **Keep state in parent** — don't move state into child unless it's purely local UI state
4. **No logic changes** — refactoring means moving code, not changing behavior
5. **Test after each extraction** — verify the page still works identically

## How to Extract a Component

```typescript
// BEFORE (in page.tsx):
{tab === 'vitals' && (
  <div className="card p-5">
    <h2>Vital Signs</h2>
    <input value={vitals.pulse} onChange={e => setV('pulse', e.target.value)} />
    ...150 more lines...
  </div>
)}

// AFTER (in page.tsx):
{tab === 'vitals' && (
  <VitalsForm
    vitals={vitals}
    highlights={vHL}
    onVitalChange={(key, val) => setV(key, val)}
    bmi={bmi}
  />
)}

// NEW FILE: VitalsForm.tsx
interface VitalsFormProps {
  vitals: Vitals
  highlights: VitalsHL
  onVitalChange: (key: keyof Vitals, value: string) => void
  bmi: string
}
export function VitalsForm({ vitals, highlights, onVitalChange, bmi }: VitalsFormProps) {
  return (
    <div className="card p-5">
      <h2>Vital Signs</h2>
      <input value={vitals.pulse} onChange={e => onVitalChange('pulse', e.target.value)} />
      ...
    </div>
  )
}
```
