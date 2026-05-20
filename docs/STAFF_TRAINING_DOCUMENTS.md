# NexMedicon HMS — Clinic Staff Training & Reference Documents

**Version:** 1.0  
**Prepared For:** Front-Desk Receptionists, Nursing Staff, Lab Coordinators, Billing & Admin Teams  
**Last Updated:** May 2026  
**Confidentiality:** Internal Use Only — Do Not Share Outside Clinic

---

> **Welcome to NexMedicon!** This document is your complete operational guide to the Hospital Management System. It is written specifically for clinic staff — no technical jargon, only step-by-step workflows you will use every day.

---


---

# DOCUMENT 1: Role-Based Feature Quick-Reference Matrix

## Overview

NexMedicon assigns every user one of **three roles**. Your role determines exactly what you can see, create, edit, or approve in the system. This prevents accidental data changes and protects patient privacy.

| Role | Typical Staff | Summary |
|------|--------------|---------|
| **Admin** | Clinic Owner, Office Manager | Full access to all features including finances, settings, user management, and audit logs |
| **Doctor** | Consulting Physicians, Surgeons | Clinical access — can create encounters, prescriptions, discharge summaries, and view billing |
| **Staff** | Receptionists, Nurses, Lab Coordinators | Day-to-day operations — patient registration, queue management, bed management, and billing entry |

---

## Detailed Permission Matrix

### Patient Management

| Action | Admin | Doctor | Staff |
|--------|:-----:|:------:|:-----:|
| View patient profiles & history | ✅ | ✅ | ✅ |
| Register a new patient | ✅ | ✅ | ✅ |
| Edit patient details (mobile, address, insurance) | ✅ | ✅ | ✅ |
| **Permanently delete** a patient record | ✅ | ❌ | ❌ |



### Appointments & OPD Queue

| Action | Admin | Doctor | Staff |
|--------|:-----:|:------:|:-----:|
| View today's queue & appointment list | ✅ | ✅ | ✅ |
| Add a patient to the queue (assign token) | ✅ | ✅ | ✅ |
| Move queue status (Waiting → In Progress → Done) | ✅ | ✅ | ✅ |
| Schedule / reschedule appointments | ✅ | ✅ | ✅ |

### Clinical Encounters & Prescriptions

| Action | Admin | Doctor | Staff |
|--------|:-----:|:------:|:-----:|
| View past encounter records | ✅ | ✅ | ✅ |
| **Create** a new consultation encounter | ✅ | ✅ | ❌ |
| **Edit** an existing encounter | ✅ | ✅ | ❌ |
| View prescriptions | ✅ | ✅ | ✅ |
| **Create / edit** prescriptions | ✅ | ✅ | ❌ |

> **Key Point for Nursing Staff:** You can *view* all clinical records and vitals, but only Doctors or Admin can *create* or *modify* encounter notes and prescriptions.



### Bed Management & IPD (In-Patient Department)

| Action | Admin | Doctor | Staff |
|--------|:-----:|:------:|:-----:|
| View bed board (all wards) | ✅ | ✅ | ✅ |
| Manage bed status (mark available, reserved, maintenance) | ✅ | ✅ | ✅ |
| **Admit** a patient (assign to bed) | ✅ | ✅ | ✅ |
| Record nursing entries (vitals, I/O, medications, notes) | ✅ | ✅ | ✅ |
| **Discharge** a patient (initiate discharge process) | ✅ | ✅ | ❌ |

> **Key Point:** Receptionists and Nurses *can* admit patients to beds. However, only Doctors or Admin can formally **discharge** a patient.

### Lab Reports

| Action | Admin | Doctor | Staff |
|--------|:-----:|:------:|:-----:|
| View lab reports for any patient | ✅ | ✅ | ✅ |
| **Create or edit** a lab report entry | ✅ | ✅ | ❌ |
| Assign a lab partner to a report | ✅ | ✅ | ❌ |
| Receive notification when a report is uploaded | ✅ | ✅ | ✅ |



### Billing & Financial Operations

| Action | Admin | Doctor | Staff |
|--------|:-----:|:------:|:-----:|
| **Create** a new bill for a patient | ✅ | ❌ | ✅ |
| View all bills & payment history | ✅ | ✅ | ❌ |
| View **financial analytics** (CA Reports, Revenue Splits) | ✅ | ❌ | ❌ |
| Generate daily closing report | ✅ | ❌ | ❌ |
| Lab Revenue Report (Net to Hospital vs. Lab Payable) | ✅ | ❌ | ❌ |

> **Key Point for Receptionists:** You *create* bills (add items, apply discounts, collect payment) but you cannot see the overall financial reports. Those are restricted to Admin only.

### Discharge Summaries

| Action | Admin | Doctor | Staff |
|--------|:-----:|:------:|:-----:|
| View discharge summaries | ✅ | ✅ | ✅ |
| **Create / edit** a discharge summary | ✅ | ✅ | ❌ |
| **Finalize & sign** a discharge summary (lock it) | ✅ | ✅ | ❌ |
| **Unfinalize** (reopen a locked summary) — requires reason | ✅ | ❌ | ❌ |

### System Settings & Administration

| Action | Admin | Doctor | Staff |
|--------|:-----:|:------:|:-----:|
| View system settings | ✅ | ✅ | ✅ |
| **Edit** hospital settings (name, fees, logo, doctor info) | ✅ | ❌ | ❌ |
| **Manage users** (create/deactivate staff accounts) | ✅ | ❌ | ❌ |
| View audit log (who did what, when) | ✅ | ❌ | ❌ |
| Approve hospital fund expenses | ✅ | ❌ | ❌ |



### Quick "Who Does What?" Summary

| Daily Task | Responsible Role |
|-----------|-----------------|
| Register walk-in patients | Staff (Reception) |
| Add patient to OPD queue | Staff (Reception) |
| Call patient in, conduct examination, write notes | Doctor |
| Record vitals in IPD nursing chart | Staff (Nurse) |
| Create OPD/IPD bill and collect payment | Staff (Billing) |
| Upload or scan lab reports | Doctor / Admin |
| Discharge IPD patient | Doctor / Admin |
| Finalize and sign discharge summary | Doctor / Admin |
| Run end-of-day financial closing | Admin |
| Add/remove clinic staff accounts | Admin |

---
---



# DOCUMENT 2: Operational User Guides (Step-by-Step)

---

## SECTION A: Front-Desk & Reception

### A1. Registering a New Patient

**When:** A patient visits the clinic for the first time.

**Steps:**

1. Navigate to **Patients** from the left menu.
2. Click the **"+ New Patient"** button (top-right corner).
3. Fill in the registration form:

| Field | Required? | Notes |
|-------|:---------:|-------|
| Full Name | **Yes** | As it appears on Aadhaar/ID card |
| Mobile Number | **Yes** | 10-digit Indian mobile — used for WhatsApp reminders |
| Date of Birth / Age | Recommended | System auto-calculates age from DOB |
| Gender | **Yes** | Female / Male / Other |
| Blood Group | Recommended | A+, B+, O+, AB+, A−, B−, O−, AB− |
| Address | Recommended | House No, Area, City, PIN |
| Aadhaar Number | Optional | 12-digit Aadhaar for identity verification |
| ABHA Health ID | Optional | 14-digit Ayushman Bharat Health Account number |
| Emergency Contact Name & Phone | Recommended | Required for IPD admissions |
| Insurance / TPA Name | Optional | e.g., "Star Health", "Medi Assist" |
| Policy Number | Optional | Insurance card/policy number |

4. Click **"Save Patient"**.
5. The system automatically generates a unique **MRN** (Medical Record Number) for this patient.

> **Tip:** The MRN is the patient's permanent ID in this system. Always quote it when searching.



### A2. Finding an Existing Patient

**Steps:**

1. Go to the **Search** bar (available on most pages, or use the dedicated Search page).
2. Type any of the following:
   - Patient's **name** (partial match works: "Priya" finds "Priya Sharma")
   - **MRN** number
   - **Mobile number**
3. Click on the matching result to open their full profile.

> **Privacy Note:** The system only shows patients you are authorized to see. All searches are logged for audit purposes.

---

### A3. Managing the OPD Queue (Token System)

**When:** Patients arrive and need to wait their turn to see the doctor.

**Steps to add a patient to today's queue:**

1. Navigate to **Queue** from the left menu.
2. Click **"+ Add to Queue"**.
3. Search for the patient by name, MRN, or mobile.
4. Select the patient from the dropdown.
5. Choose **Priority**:
   - **Normal** — Standard walk-in
   - **Urgent** — Needs faster attention
   - **Emergency** — Immediate attention required
6. Add optional notes (e.g., "Follow-up from last week").
7. Click **Save**. The system assigns the next available **token number** automatically.

**Queue Status Flow:**

```
Waiting → In Progress (Doctor calls patient) → Done (Consultation complete)
                                              → Cancelled (Patient left)
```

**To update a patient's queue status:**
- Click the status badge next to their name.
- Select the new status from the dropdown.
- The queue board updates in **real-time** — all staff see changes instantly without refreshing.



### A4. Scheduling & Managing Appointments

**When:** Patient calls ahead or doctor prescribes a follow-up date.

**Steps to create an appointment:**

1. Navigate to **Appointments**.
2. Click **"+ New Appointment"**.
3. Search and select the patient.
4. Choose:
   - **Date** (calendar picker)
   - **Time slot** (15-minute intervals from 8:00 AM to 7:45 PM)
   - **Appointment Type** — select from:
     - ANC Follow-up
     - OPD Consultation
     - Follow-up
     - Pre-Surgery Assessment
     - Post-op Review
     - Lab Report Discussion
     - Infertility Counselling
     - PCOS Follow-up
     - USG Follow-up
     - Discharge Follow-up
     - Colposcopy / Procedure
     - Other
5. Add any notes for the doctor.
6. Click **"Save Appointment"**.

**Appointment Status Codes:**

| Status | Meaning | Colour |
|--------|---------|--------|
| Scheduled | Booked, awaiting confirmation | Blue |
| Confirmed | Patient confirmed attendance | Green |
| Completed | Visit finished | Grey |
| Cancelled | Appointment cancelled | Red |
| No Show | Patient did not arrive | Orange |

**Sending Reminders:** Click the bell icon next to any appointment to generate a WhatsApp reminder message you can send to the patient.

---



## SECTION B: Nursing & IPD Ward Management

### B1. Admitting a Patient to IPD

**When:** Doctor orders admission (e.g., for surgery, observation, or delivery).

**Steps:**

1. Navigate to **IPD Management**.
2. Click **"Admit Patient"** (top-right).
3. **Search & select** the patient (by name, MRN, or mobile).
4. **Assign a bed:**
   - The system shows only **available** beds, grouped by ward.
   - Select the bed from the dropdown (e.g., "LW-01 — Labour Ward").
5. **Select the admitting (primary) doctor** from the dropdown.
6. **Add consulting doctors** (optional) — tick the names of any additional doctors involved in the patient's care. Multiple doctors can be assigned.
7. **Fill clinical details:**
   - Chief Complaint (e.g., "Abdominal pain, fever since 2 days")
   - Diagnosis on Admission
   - Allergies (or write "NKDA" for No Known Drug Allergies)
   - Co-morbidities (DM, HTN, Thyroid, etc.)
   - Insurance / TPA details
8. **Select Diet Type:** Normal, Soft, Liquid, NPO (Nothing by mouth), Diabetic, Low salt, High protein
9. **Enter attendant/relative information** (name, contact, relation).
10. **Set admission date & time** (defaults to now).
11. Click **"Admit Patient"**.

**What happens automatically:**
- The selected bed status changes from "Available" to **"Occupied"**.
- The patient appears in the **IPD Census** board.
- The bed board updates instantly for all staff.



### B2. Recording Vitals in the Nursing Chart

**When:** Every shift (or as ordered — e.g., hourly for critical patients).

**Steps:**

1. In the **IPD Census** view, find the patient.
2. Click the **"Chart"** button next to their name.
3. The **Nursing Chart** opens, showing all previous entries.
4. Click **"+ Add Vital"**.
5. Fill in the vital signs:

| Vital Sign | Unit | Normal Range (Adult) |
|-----------|------|---------------------|
| Pulse | bpm | 60–100 |
| BP Systolic | mmHg | 90–140 |
| BP Diastolic | mmHg | 60–90 |
| Temperature | °C | 36.1–37.2 |
| SpO2 | % | 95–100 |
| Weight | kg | — |
| Respiratory Rate (RR) | breaths/min | 12–20 |

6. Add a **Vital Note** if needed (e.g., "Patient complaining of headache").
7. Set the **Recorded Time** (defaults to current time).
8. Click **Save**. Your name is automatically stamped as the recording nurse.

> **Important:** You do NOT need to fill every field every time. Record only what is measured. Empty fields are saved as blank — not as zero.

---

### B3. Intake/Output (I/O) Fluid Charting

**When:** Doctor orders strict I/O monitoring (common in post-surgery, renal cases, or pre-eclampsia).

**Steps:**

1. Open the patient's **Nursing Chart** (same as above).
2. Switch to **"I/O"** entry type.
3. Select:
   - **Type:** Input or Output
   - **Label:** e.g., "IV Fluid (NS)", "Oral water", "Urine", "Drain"
   - **Amount:** In **millilitres (ml)**
4. Set the **Recorded Time**.
5. Click **Save**.

**The system automatically:**
- Shows a running total of Input vs. Output for the current shift/day.
- Alerts if output is significantly less than input (fluid retention risk).



### B4. Recording Nursing Notes & Medication Administration

**Nursing Notes:**

1. In the Nursing Chart, select entry type **"Note"**.
2. Write your observation (e.g., "Patient slept well. No complaints. Wound dry.").
3. Click **Save**. Timestamped with your name.

**Medication Administration:**

1. Select entry type **"Medication"**.
2. Fill in:
   - Medication Name (e.g., "Inj. Ceftriaxone 1g")
   - Dose (e.g., "1g")
   - Route (IV, IM, Oral, SC, Topical)
   - Given By (your name — auto-filled)
3. Click **Save**.

> **Shift Handover Tip:** Before ending your shift, add a final Nursing Note summarizing the patient's status. The next shift nurse can read your summary immediately.

---

### B5. Using AI/OCR to Scan Paper Forms

**When:** Patient brings a handwritten form or an external lab report printed on paper.

**Steps:**

1. On the relevant page (Lab Reports, Patient Registration), look for the **"Scan Form"** or **"Upload"** button (camera icon).
2. **Take a photo** of the document using your device camera, OR select an existing image file.
3. The system's built-in scanner will:
   - Extract printed/handwritten text automatically.
   - Attempt to match lab test names and fill in values.
   - Pre-fill form fields with detected data.
4. **Review the auto-filled values carefully.** Correct any misreads.
5. Click **Save** once verified.

> **Important:** AI scanning is a *helper* — always verify the output before saving. The system highlights uncertain matches in yellow for your review.

---

### B6. Understanding the Bed Board

The **Beds** page shows a visual overview of all beds in the hospital.

| Bed Status | Colour | Meaning |
|-----------|--------|---------|
| **Available** | 🟢 Green | Ready for a new patient |
| **Occupied** | 🔴 Red | Patient currently admitted |
| **Reserved** | 🟡 Amber | Held for an expected admission |
| **Cleaning** | ⚪ Grey | Being cleaned after discharge — not yet available |

**Status Transitions (what you can do):**

- Available → Reserved (hold for incoming patient)
- Available → Maintenance (if bed/equipment needs repair)
- Reserved → Available (release hold)
- Cleaning → Available (housekeeping confirms done)
- Occupied → *(only freed via formal discharge by Doctor/Admin)*

---



## SECTION C: Billing & Accounts (Financial Processing)

### C1. Creating a Patient Bill

**When:** After consultation, procedure, or at discharge.

**Steps:**

1. Navigate to **Billing**.
2. Click **"+ New Bill"**.
3. **Search and select the patient** (by name, MRN, or mobile).
4. **Add line items** — choose from common fee presets:

| Preset Item | Default Amount (₹) |
|------------|-------------------:|
| OPD Consultation | 500 |
| ANC Consultation | 400 |
| Follow-up Consultation | 300 |
| Emergency Consultation | 800 |
| USG (Obstetric) | 1,200 |
| USG (Pelvis) | 1,000 |
| Colour Doppler | 2,000 |
| PAP Smear | 600 |
| Colposcopy | 2,500 |
| Dressing / Procedure | 300 |
| Injection Administration | 100 |
| IUD Insertion | 800 |
| IPD Admission (per day) | 1,500 |
| OT Charges (minor) | 5,000 |
| OT Charges (major) | 15,000 |
| Blood Test (CBC) | 300 |
| Blood Test (panel) | 800 |

   - You can also type a **custom item** with a custom amount.
   - Adjust **quantity** if needed (e.g., 5 days × ₹1,500 for IPD).

5. **Apply Discount** (optional):
   - Enter the discount amount in ₹.
   - The system ensures the discount cannot exceed the subtotal.

6. **GST** (optional):
   - If applicable, select the GST percentage.
   - The system calculates the tax amount automatically.



7. **Bill Calculation** (automatic):

```
   Subtotal     = Sum of all items × quantities
 − Discount     = Amount entered
 + GST          = (Subtotal − Discount) × GST%
 ─────────────────────────────────────────────────
   Net Amount   = Final amount patient pays
```

8. **Select Payment Mode:**

| Mode | Icon | When to Use |
|------|------|------------|
| **Cash** | 💵 | Patient pays cash at counter |
| **UPI** | 📱 | Google Pay, PhonePe, or any UPI app |
| **Card** | 💳 | Debit or Credit card swipe/tap |

9. Click **"Save & Mark Paid"** (or **"Save as Pending"** if patient will pay later).

**Bill Status Codes:**

| Status | Meaning |
|--------|---------|
| **Paid** | Full amount collected |
| **Partial** | Some amount collected, balance remaining |
| **Pending (Unpaid)** | No payment collected yet |
| **Refunded** | Amount returned to patient |
| **Waived** | Bill cancelled / written off |

> **Tip:** All amounts are in **Indian Rupees (₹ INR)**. The system formats numbers in the Indian style (e.g., ₹1,23,456).

---

### C2. IPD Billing (Discharge Bill)

**When:** Patient is being discharged from IPD.

The system can auto-generate IPD bill items based on the stay:

| Auto-Calculated Item | Formula |
|---------------------|---------|
| Bed Charges | Number of days × Daily bed rate |
| Nursing Charges | Number of days × Daily nursing rate |
| Doctor Visits | Number of visits × Per-visit fee |
| Surgery / OT Charges | As entered by Admin |
| Procedure Charges | As entered |
| Medicines / Pharmacy | As dispensed |

> **Note:** Minimum billing is **1 day** — even same-day admissions are charged for one full day.

---



### C3. CA Reports & Financial Summaries (Admin Only)

**What is a CA Report?**
A Chartered Accountant Revenue Report summarizing all financial activity for a selected period.

**How to generate:**

1. Navigate to **Billing** page.
2. Click the **"CA Report"** tab / section.
3. Select the **period:**
   - This Month
   - Last Month
   - This Quarter
   - Last Quarter
   - This Year
   - Custom date range
4. The system generates:

| Metric | Description |
|--------|------------|
| **Gross Revenue** | Total of all paid bills (before discounts) |
| **Total Discounts** | Sum of all discounts given |
| **Net Collected** | Actual money received (Gross − Discounts + GST) |
| **Bills Paid** | Number of fully-paid bills |
| **Pending Amount** | Outstanding dues from unpaid/partial bills |
| **Payment Breakdown** | Cash vs. UPI vs. Card — amounts and counts |
| **Service Breakdown** | Revenue per service type (OPD, USG, OT, etc.) |

5. Click **"Download PDF"** to get a formal CA-ready PDF report.

---

### C4. Lab Revenue Split — Partner Lab Payables (Admin Only)

**What is this?**
When the clinic outsources lab tests to external partner laboratories, revenue is split between the hospital and the lab.

**How it works:**

1. Navigate to **Reports → Lab Revenue**.
2. Select the **month** and optional **payment mode filter**.
3. The system shows:

| Column | Meaning |
|--------|---------|
| **Total Amount** | What the patient paid for the lab test |
| **Hospital Amount** | The clinic's share (e.g., 60%) |
| **Lab Amount** | The amount payable to the partner lab (e.g., 40%) |
| **Partner Name** | Which lab did the test |

4. **Summary view** shows totals per partner:
   - Net to Hospital (your revenue)
   - Net to Lab (what you owe the lab partner)
   - Number of tests done

> **Example:** If a patient pays ₹1,000 for a blood panel, and the hospital-lab split is 60:40, then Hospital keeps ₹600 and ₹400 is payable to the lab partner.

---

### C5. Daily Closing (End-of-Day Summary)

**When:** At the end of every business day, Admin runs the daily closing.

**What it captures:**

- Total OPD patients seen today
- Total IPD admissions today
- Cash collected / UPI collected / Card collected
- Total discounts given
- Pending amounts
- Refunds processed

**Steps:**
1. Navigate to **Billing → Daily Closing**.
2. Confirm the date (defaults to today).
3. Add any notes (e.g., "Power cut between 2–3 PM, some bills delayed").
4. Click **"Generate Closing"**.
5. The report is saved permanently and can be retrieved later.

---
---



# DOCUMENT 3: Intra-Clinic Notification Coordination Cheat-Sheet

---

## How the Notification System Works

NexMedicon has a built-in **Notification Center** (the bell icon 🔔 in the top navigation bar). This system automatically delivers important updates to the right people based on their role — so nothing falls through the cracks.

**Key Principles:**
- Notifications are **role-targeted** — each alert is delivered only to the roles that need it.
- Notifications appear **instantly** — no need to refresh or check manually.
- Each notification shows: **Title**, **Message**, **Patient Name/MRN** (if relevant), **Timestamp**.
- You can **mark as read** individually or click "Mark All Read" to clear the badge.
- Unread count shows as a red badge on the bell icon.

---

## Scenario A: Lab Partner Uploads a Fresh Lab Report

**The Situation:** An external partner lab (e.g., "City Path Lab") finishes processing blood tests for patient Priya Sharma and uploads the results via the Lab Partner Portal.

**What happens automatically:**

| Step | What the System Does | Who Sees It |
|------|---------------------|-------------|
| 1 | Lab partner uploads report through their secure portal link | — |
| 2 | System creates an **in-app notification**: "Lab Report Ready — Priya Sharma (MRN: PAT-001)" | 🔔 Staff + Doctor + Admin |
| 3 | If any values are **abnormal**, the notification is flagged as ⚠️ **Warning** or 🚨 **Critical** | Doctor sees alert on dashboard |
| 4 | **WhatsApp message** is auto-generated for the patient: "Your report is ready. Please visit for review." | Patient (via WhatsApp) |
| 5 | **WhatsApp message** is auto-generated for the doctor with abnormal values highlighted | Doctor (via WhatsApp) |
| 6 | **WhatsApp message** is sent to staff: "New report available — update patient file" | Staff (via WhatsApp) |



**What Staff should do when they see this notification:**

1. Click the notification to see the patient details.
2. Open the patient's profile → Labs section.
3. Verify the report is visible and values are correct.
4. If the patient is currently admitted (IPD), inform the attending nurse.
5. If the patient is an OPD patient, note it for when they come for their next visit.

> **Key Benefit:** Before this system, staff had to manually call the lab to ask "Is the report ready?" Now the system tells you the moment it's uploaded.

---

## Scenario B: Insurance Policy or Claim Update

**The Situation:** An insurance TPA (Third Party Administrator) processes a claim or there's an update to a patient's insurance coverage.

**What happens automatically:**

| Step | What the System Does | Who Sees It |
|------|---------------------|-------------|
| 1 | Insurance-related update is recorded in the system | — |
| 2 | System creates notification: "Insurance Update — [Patient Name] — [TPA Name]" | 🔔 Admin + Staff |
| 3 | Notification includes: policy status, claim ID, action required | Admin + Staff dashboard |

**What Staff should do:**

1. Click the notification to see the full insurance update.
2. If action is required (e.g., "Submit additional documents"), inform the patient or their attendant.
3. Update the patient's profile with any new policy details.
4. If a claim is approved, proceed with cashless billing workflow.

---

## Scenario C: Patient Discharge Triggers Multiple Notifications

**The Situation:** Doctor discharges patient Bhavna Rana from IPD.

**What happens automatically:**

| Notification | Target |
|-------------|--------|
| "Patient Discharged — Bhavna Rana — Bed LW-01 now available for cleaning" | Staff (Housekeeping/Reception) |
| WhatsApp to patient: "You have been discharged. Follow-up on [date]." | Patient |
| Follow-up appointment auto-created (if follow-up date was entered) | Queue/Appointments |
| Insurance document reminder (if insured): "Submit docs within 3 days" | Staff |

---

## Managing Your Notifications

| Action | How |
|--------|-----|
| View notifications | Click the 🔔 bell icon in the top bar |
| See only unread | Toggle the "Unread only" filter |
| Mark one as read | Click the notification |
| Mark all as read | Click "Mark All Read" button |
| See notification count | Red badge on bell icon shows unread count |

---
---



# DOCUMENT 4: Printing & Patient Communication Reference

---

## Overview of Printable Documents

NexMedicon generates professional, print-ready documents that can be handed to patients or kept for records. All prints include the **clinic branding** (hospital name, address, phone, registration number) automatically.

---

## 4.1 Patient Bills & Receipts

**What it contains:**

| Section | Details |
|---------|---------|
| **Header** | Hospital name, address, phone number, GSTIN (if applicable), registration number |
| **Patient Info** | Full name, MRN, mobile, address, age |
| **Bill Reference** | Unique Bill ID / Bill Number |
| **Itemized Charges** | Each service with amount (and quantity if > 1) |
| **Financial Summary** | Subtotal → Discount → GST (if any) → **Net Amount** |
| **Payment Details** | Payment mode (Cash / UPI / Card), Payment date & time |
| **Status** | PAID / PARTIAL / PENDING — clearly marked |
| **Timestamp** | Bill creation date, Payment confirmation time |

**Sample layout:**

```
┌──────────────────────────────────────────────────┐
│          NEXMEDICON HOSPITAL                      │
│     123, Main Road, Ahmedabad - 380015           │
│     Tel: 079-12345678 | GSTIN: 24XXXXX1234Z     │
├──────────────────────────────────────────────────┤
│  BILL / RECEIPT                                  │
│                                                  │
│  Patient: Priya Sharma                           │
│  MRN: PAT-001 | Mobile: 9876543210              │
│  Date: 15 May 2026, 3:30 PM                     │
├──────────────────────────────────────────────────┤
│  # │ Service              │ Amount (₹)           │
│  1 │ OPD Consultation     │       500            │
│  2 │ USG (Obstetric)      │     1,200            │
│  3 │ Blood Test (CBC)     │       300            │
├──────────────────────────────────────────────────┤
│        Subtotal:                    ₹2,000       │
│        Discount:                   −₹  200       │
│        GST (0%):                    ₹    0       │
│        ────────────────────────────────────      │
│        NET AMOUNT:                  ₹1,800       │
│                                                  │
│  Payment: Cash | Status: PAID                    │
│  Paid at: 15 May 2026, 3:32 PM                  │
└──────────────────────────────────────────────────┘
```



**How to print a bill:**

1. Open the patient's billing record (from Billing page or Patient Profile → Bills).
2. Click the **🖨️ Print** button.
3. The system generates a formatted receipt.
4. Your browser's print dialog opens — select your printer and print.

> **Tip:** For UPI payments, you can also share the receipt via WhatsApp using the "Share" button.

---

## 4.2 Prescriptions

**What it contains:**

| Section | Details |
|---------|---------|
| **Header** | Hospital name & branding, Doctor name, qualifications, registration number |
| **Patient Info** | Name, MRN, Age, Gender, Blood Group, Mobile |
| **Vitals** | BP, Pulse, Temperature, SpO2, Weight (from encounter) |
| **Diagnosis** | Primary diagnosis from the consultation |
| **Medications Table** | Drug name, Dose, Route, Frequency, Duration, Special Instructions |
| **Advice** | Doctor's general advice |
| **Dietary Advice** | Dietary recommendations |
| **Reports Needed** | Any lab tests or imaging ordered |
| **Follow-up** | Next appointment date |
| **Footer** | Doctor's digital signature stamp, Clinic contact, Disclaimer |

**How to print:**
1. Open the patient's profile → Encounters → Select the encounter.
2. Click **"Print Prescription"**.
3. The system generates a branded PDF.

---

## 4.3 Discharge Summaries

**⚠️ CRITICAL RULE: A discharge summary can ONLY be printed AFTER it is finalized.**

### What "Finalized" Means:

A discharge summary goes through this lifecycle:

```
Draft (editable) → Finalized (locked & signed) → Printable
```

### Requirements for Finalization:

The system **will not allow** finalization unless ALL of the following mandatory fields are completed:

| Required Field | Description |
|---------------|-------------|
| ✅ **Final Diagnosis** | The confirmed diagnosis at the time of discharge |
| ✅ **Condition at Discharge** | Patient's condition (Satisfactory, Stable, Fair, etc.) |
| ✅ **Discharge Advice** | Instructions for the patient post-discharge |



### What the Discharge Summary Contains:

| Section | Details |
|---------|---------|
| **Header** | Hospital branding |
| **Patient Info** | Name, MRN, Age, Gender |
| **Admission Details** | Admission date, Discharge date, Bed/Ward, Duration of stay |
| **Clinical Summary** | Reason for admission, course during stay |
| **Final Diagnosis** | Primary + Secondary diagnosis |
| **Investigations** | Lab results, imaging findings |
| **Treatment Given** | Medications, procedures, surgeries performed |
| **Condition at Discharge** | Satisfactory / Stable / Fair / LAMA / etc. |
| **Discharge Advice** | Diet, activity, wound care, warning signs |
| **Medications at Discharge** | Take-home medicines with dosage |
| **Follow-up** | Date and purpose of next visit |
| **Delivery Details** *(if OB case)* | Delivery type, Baby sex, weight, APGAR, birth time |
| **Doctor's Signature** | Digital stamp with doctor's name — auto-applied at finalization |

### Finalization Process:

1. Doctor completes all required fields in the discharge summary.
2. Doctor clicks **"Finalize & Sign"**.
3. System validates:
   - Is Final Diagnosis filled? ✅
   - Is Condition at Discharge selected? ✅
   - Is Discharge Advice written? ✅
4. If all three are present → Summary is **locked** and signed with doctor's name + timestamp.
5. If any field is missing → System shows error: *"Cannot finalize — missing: [field name]"*
6. Once finalized:
   - The summary becomes **read-only** (no further edits allowed).
   - The **Print** button becomes active.
   - A version number is incremented for audit trail.

### Can a finalized summary be re-opened?

**Yes, but ONLY by Admin**, with a mandatory reason:
- Admin clicks "Unfinalize".
- Admin must type a reason (minimum 5 characters) explaining why.
- The summary returns to Draft state for editing.
- The reason is permanently recorded in the audit trail.

---

## 4.4 CA Revenue Report PDF

**For:** Admin / Clinic Owner / Chartered Accountant

**Contents:**
- Hospital name and period covered
- Summary boxes: Gross Revenue, Discounts, Net Collected, Bill Count
- Payment Mode Breakdown table (Cash, UPI, Card — amount + count)
- Service-wise Revenue Breakdown table
- Pending amounts
- Generated timestamp and "Closed by" attribution

**How to generate:** See Section C3 above (CA Reports).

---



## 4.5 Patient Registration Form (Fillable PDF)

**For:** Patients to fill before their first visit (can be emailed or printed blank).

**Fields included:**
- Personal Details: Full name, DOB, Age, Gender, Blood Group
- Contact: Mobile, WhatsApp, Address
- Identity: Aadhaar Number, ABHA Health ID
- Emergency Contact: Name, Mobile
- Insurance: TPA name, Policy number, Mediclaim type

**How to generate:**
- The system can produce a **blank fillable PDF** (patients can type into it on their phone or computer).
- Staff can also print it blank for patients to fill by hand, then scan it using the OCR feature.

---

## Summary: When to Print What

| Document | When to Issue | Who Prints |
|----------|--------------|-----------|
| Bill / Receipt | After payment is collected | Staff (Billing) |
| Prescription | After every OPD consultation | Staff / Doctor |
| Discharge Summary | At IPD discharge (after finalization) | Doctor / Admin |
| CA Revenue Report | Monthly / Quarterly for accounts | Admin |
| Lab Report | When patient requests a copy | Staff |
| Registration Form (blank) | For new patients to fill | Staff (Reception) |

---

## Important Printing Tips

1. **Always check printer paper and ink** before busy OPD hours.
2. **Never print a discharge summary that says "Draft"** — it must show "Finalized" status.
3. **Bills marked "Pending"** should say "PENDING" clearly — do not hand them as receipts.
4. **All timestamps** on printed documents are in Indian Standard Time (IST).
5. **Currency** is always Indian Rupees (₹) formatted with Indian numbering (lakhs, crores).

---
---

## END OF TRAINING DOCUMENTS

**Questions?** Contact your Admin or Hospital IT coordinator.  
**System issues?** Note the error message and report to the NexMedicon support team.

> *These documents are based on the NexMedicon HMS system as deployed. Features may be updated — check with your Admin for the latest version.*
