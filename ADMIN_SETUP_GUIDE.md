# NexMedicon HMS — Admin Setup & Fixes Guide

## Issue 1: Admin Account Setup — Step-by-Step

### Why You Can't Switch to Admin
The app uses **Supabase Auth** for login credentials + a `clinic_users` table for roles.
If your user exists in Supabase Auth but has no `clinic_users` record (or has the wrong role), login will fail or you'll land as a non-admin.

---

### OPTION A — Reset Everything From Scratch (Recommended)

#### Step 1: Clear all users from Supabase Auth
Go to your **Supabase Dashboard → Authentication → Users** and delete ALL existing users.

#### Step 2: Clear the clinic_users table
In **Supabase → SQL Editor**, run:

```sql
-- ⚠️ WARNING: This deletes ALL user accounts. Patient data is NOT deleted.
-- Run this ONLY if you want to start fresh with user accounts.

TRUNCATE clinic_users CASCADE;

-- Optional: If you also want to clear demo patients:
-- TRUNCATE patients, encounters, prescriptions, lab_reports, bills CASCADE;
```

#### Step 3: Create your Admin user in Supabase Auth
1. Go to **Supabase → Authentication → Users → Add User**
2. Enter your **email** (e.g. `admin@yourclinic.com`) and a **strong password**
3. Click **Create User**
4. Copy the **User UID** shown (you'll need it in Step 4)

#### Step 4: Create the clinic_users record directly in SQL
In **Supabase → SQL Editor**, run (replace the values):

```sql
-- Replace 'YOUR-UUID-HERE' with the UID from Step 3
-- Replace 'Dr. Your Name' with the admin's actual name
-- Replace 'admin@yourclinic.com' with your email

INSERT INTO clinic_users (auth_id, full_name, email, role, is_active)
VALUES (
  'YOUR-UUID-HERE',
  'Dr. Your Name',
  'admin@yourclinic.com',
  'admin',
  true
);
```

#### Step 5: Log in
Go to your app → `/login` → Enter your email & password → You are now Admin with full access.

---

### OPTION B — Change an Existing User to Admin (No Data Loss)

If you already have a working account but it's Doctor/Staff and you want to make it Admin:

```sql
-- In Supabase SQL Editor:
-- Find your user first:
SELECT id, full_name, email, role FROM clinic_users;

-- Then update the role:
UPDATE clinic_users SET role = 'admin' WHERE email = 'your@email.com';
```

---

### OPTION C — Create Separate Credentials for Admin, Doctor, Staff

**For each new user:**

1. **Supabase → Authentication → Users → Add User**
   - Enter email + password for each person
   - Copy their UID

2. **In SQL Editor**, insert their clinic_users record:

```sql
-- Admin account
INSERT INTO clinic_users (auth_id, full_name, email, role, is_active)
VALUES ('ADMIN-UID', 'Dr. Admin Name', 'admin@clinic.com', 'admin', true);

-- Doctor account
INSERT INTO clinic_users (auth_id, full_name, email, role, is_active)
VALUES ('DOCTOR-UID', 'Dr. Doctor Name', 'doctor@clinic.com', 'doctor', true);

-- Staff/Nurse account
INSERT INTO clinic_users (auth_id, full_name, email, role, is_active)
VALUES ('STAFF-UID', 'Nurse Name', 'staff@clinic.com', 'staff', true);
```

**OR** — Once you have one Admin account working, use the app's Settings → Manage Users → Invite New User to create Doctor and Staff accounts without touching SQL.

---

### Role Permissions Reference

| Feature | Admin 👑 | Doctor 🩺 | Staff 📋 |
|---------|----------|-----------|---------|
| View patients | ✅ | ✅ | ✅ |
| Register patients | ✅ | ✅ | ✅ |
| OPD consultations | ✅ | ✅ | View only |
| Write prescriptions | ✅ | ✅ | ❌ |
| Billing | ✅ | View | ✅ |
| Add Hospital Fund (top-up) | ✅ | ❌ | ❌ |
| Submit expenses (fund) | ✅ | ✅ | ✅ |
| Financial reports | ✅ | ❌ | ❌ |
| Manage users | ✅ | ❌ | ❌ |
| Settings | ✅ | ✅ | View only |
| Delete patients | ✅ | ❌ | ❌ |
| Create Video Slots | ✅ | ✅ | ❌ |
| IPD admissions | ✅ | ✅ | View only |

---

## Issue 2: Hospital Fund — Who Can Add Funds?

**Only Admin** can top up the hospital fund balance.
**Any authenticated user** (Admin, Doctor, Staff) can submit expenses.

The "Add Funds" button (`+ Add Funds`) only appears for users with `isAdmin = true`.
If you're logged in as Doctor/Staff, you will see the expense form but not the fund top-up form.

**Fix:** Log in as Admin → Go to `/fund` → You'll see "Add Funds" button in the top-right.

---

## Issue 3: How to Create Video Slots ("Create Slots" button)

The **"Create Slots"** button is on the **Video Consult page** (`/video`), NOT the Appointments page.

### Where to find it:
1. Log in as **Admin** or **Doctor**
2. Click **"Video Consult"** in the left sidebar (under IPD section)
3. At the top of the page, click the **"+ Create Slots"** button (blue button, top right)
4. A form slides down — fill in:
   - **Date** — which day to create slots for
   - **Time** — start time (e.g., 10:00 AM)
   - **Number of slots** — how many consecutive slots to create
   - **Duration per slot** — 15, 20, or 30 minutes
   - **Doctor name** — which doctor will take the call
   - Optionally attach a patient
5. Click **"Create Slots"**

Each slot gets a unique Jitsi video link automatically.

### Who can create slots?
- ✅ Admin
- ✅ Doctor
- ❌ Staff (view only)

---

## Issues 4 & 5: IPD Notes with AI + OPD Smart Autofill

See the updated code files delivered alongside this guide:
- `src/app/ipd/[bedId]/page.tsx` — IPD with doctor notes + AI autofill for vitals/fields
- `src/app/opd/new/page.tsx` — OPD consultation with smart complaint autofill from photos

---

## Supabase SQL: Add Missing Tables (if not already run)

Run this in **Supabase SQL Editor** if `hospital_fund` or `ipd_nursing` tables are missing:

```sql
-- Hospital Fund table
CREATE TABLE IF NOT EXISTS hospital_fund (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type          TEXT NOT NULL CHECK (type IN ('topup', 'expense')),
  category      TEXT NOT NULL DEFAULT 'other',
  amount        NUMERIC(10,2) NOT NULL,
  description   TEXT,
  submitted_by  TEXT,
  approved_by   TEXT,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  receipt_note  TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- IPD Nursing table (if not present)
CREATE TABLE IF NOT EXISTS ipd_nursing (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bed_id        UUID,
  patient_id    UUID REFERENCES patients(id),
  entry_type    TEXT NOT NULL CHECK (entry_type IN ('vital', 'io', 'note', 'doctor_note')),
  recorded_time TEXT,
  -- vitals
  pulse         TEXT,
  bp_systolic   TEXT,
  bp_diastolic  TEXT,
  temperature   TEXT,
  spo2          TEXT,
  vital_note    TEXT,
  -- i/o
  io_type       TEXT,
  io_label      TEXT,
  io_amount_ml  NUMERIC,
  -- notes
  nurse_name    TEXT,
  note_text     TEXT,
  -- doctor notes (NEW)
  doctor_name   TEXT,
  note_type     TEXT DEFAULT 'nursing',  -- 'nursing' | 'doctor'
  file_url      TEXT,
  ocr_raw       TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- RLS: allow authenticated users to read/write
ALTER TABLE hospital_fund ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_access" ON hospital_fund
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE ipd_nursing ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_access" ON ipd_nursing
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
```
