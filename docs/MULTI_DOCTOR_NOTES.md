# Multi‑Doctor Support — Current Stance

**Status:** Single‑doctor model (canonical). Multi‑doctor is partially scaffolded but **not** wired into uniqueness constraints.

## What today's schema assumes

`appointments` has a `doctor_id` column (added by migration 017 §5 / fresh‑install/01) but the **slot‑uniqueness index** (`uniq_appointments_slot_active` from `applied/v01_validation_constraints.sql` and `fresh-install/04_validation_constraints.sql`) is on `(date, time)` — **clinic‑wide**, not per‑doctor.

Concretely this means: at 10:00 on a given day, **at most ONE active appointment exists across the whole clinic**, regardless of which doctor is on it. This matches the typical Indian solo‑practice OPD where the doctor sees one patient at a time.

The `checkAppointmentOverlap()` guard in `src/lib/booking-guards.ts` (§9.2 fix, June 2026) now respects each appointment's actual `duration_min` instead of the old hardcoded 15‑minute window. So a 60‑minute OB/GYN review correctly blocks an attempted 10:30 booking, instead of silently letting it through.

## When (and how) to enable multi‑doctor

If the clinic adds a second doctor and wants concurrent OPD slots, do this once, in order:

1. **Confirm `appointments.doctor_id` is populated for all rows.** Back‑fill if necessary (`UPDATE appointments SET doctor_id = '...' WHERE doctor_id IS NULL`).
2. **Drop the clinic‑wide unique index, replace with per‑doctor:**
   ```sql
   DROP INDEX IF EXISTS uniq_appointments_slot_active;
   CREATE UNIQUE INDEX uniq_appointments_slot_active
     ON public.appointments (doctor_id, date, time)
     WHERE doctor_id IS NOT NULL
       AND status NOT IN ('cancelled', 'completed', 'no_show');
   ```
3. **Update `checkAppointmentOverlap`** so that when `doctorId` is supplied (it already is — the function takes it), the overlap loop only flags rows with the same `doctor_id`. The current code already does this; once the index is per‑doctor, two doctors can have 10:00 slots simultaneously.
4. **Test:** book the same `(date, time)` for two different doctors → both succeed. For the same doctor → second is rejected.

> Tip: do not enable multi‑doctor while OPD queue tokens are still single‑sequence. Token #1 of the day shouldn't mean "either doctor's first patient" — that's confusing for reception. Add a `doctor_id` column to `opd_queue` and partition `next_queue_token(queue_date)` by it (turning the helper into `next_queue_token(queue_date, doctor_id)`) before going live.

## OT scheduling — already multi‑room

The `ot_schedules` table is properly multi‑room from day one:

```sql
EXCLUDE USING gist (
  ot_room      WITH =,
  surgery_date WITH =,
  tsrange(...) WITH &&
)
```

means "no two surgeries can overlap in the **same** OT room, on the **same** date." Two rooms can run independent surgeries simultaneously. No changes required.

## Why we left it single‑doctor

About 90% of Indian standalone clinics this product targets are solo‑practitioner (gynaecologist, paediatrician, GP, etc.). Forcing every install to think about doctor partitioning at registration time slows them down without giving them anything they need. The path above is intentionally a 5‑minute SQL change once the clinic actually grows.

— **Last reviewed:** 2026‑06‑04, audit fix branch `fix/audit-findings-1-to-10`.
