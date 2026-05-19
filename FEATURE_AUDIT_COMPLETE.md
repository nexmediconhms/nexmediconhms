# NexMedicon HMS — Comprehensive Feature Audit

**Document Version:** 1.0  
**Date:** May 19, 2026  
**Application:** NexMedicon Hospital Management System (HMS)  
**Tech Stack:** Next.js 14, React 18, Supabase, Tailwind CSS, Anthropic AI, OpenAI, Tesseract.js, pdf-lib, PWA  

---

## TABLE OF CONTENTS

1. [Executive Summary](#1-executive-summary)
2. [Existing Features — Detailed Breakdown](#2-existing-features--detailed-breakdown)
3. [Additional Features — Must Have](#3-additional-features--must-have)
4. [Additional Features — Good to Have](#4-additional-features--good-to-have)
5. [Feature Priority Matrix](#5-feature-priority-matrix)

---

## 1. EXECUTIVE SUMMARY

NexMedicon HMS is a comprehensive, cloud-based Hospital Management System built for small-to-medium
gynecology/obstetrics clinics in India. It covers the complete patient lifecycle from registration
through billing, with specialized modules for antenatal care, surgery scheduling, and insurance claims.

**Total Features Identified: 47 Major + 85+ Minor features across 25 modules.**

---

## 2. EXISTING FEATURES — DETAILED BREAKDOWN

---

### 2.1 DASHBOARD & HOME

| # | Feature | Type | Description |
|---|---------|------|-------------|
| 1 | Revenue KPI Card | Major | Real-time today's revenue with daily target progress bar, percentage completion |
| 2 | Revenue Pillars | Major | Three-pillar view: Empty Bed Slots, Pending Bills, Weekly Collection |
| 3 | Action Feed | Major | Priority-sorted actionable items: unconfirmed appointments, unbilled encounters, pending bills, follow-ups due |
| 4 | Doctor Alerts | Major | Abnormal lab value notifications with severity (critical/warning), auto-populated from lab reports |
| 5 | Quick Actions Grid | Minor | 6-button grid for common tasks: New Patient, Appointment, New Bill, Admit, Prescription, Analytics |
| 6 | Today Summary | Minor | At-a-glance stats: appointments, patients seen, beds occupied, follow-ups due, unbilled encounters |
| 7 | Auto-Refresh | Minor | Dashboard refreshes every 5 minutes automatically |
| 8 | Greeting Logic | Minor | Time-based greeting (Good morning/afternoon/evening) |



---

### 2.2 PATIENT MANAGEMENT

| # | Feature | Type | Description |
|---|---------|------|-------------|
| 1 | Patient Registration | Major | Full registration form with demographics, contact, Aadhaar, ABHA ID, blood group, insurance details |
| 2 | Auto MRN Generation | Major | Automatic Medical Record Number assignment on registration |
| 3 | Patient Search | Major | Real-time search by name, mobile, MRN with debounced queries (300ms) |
| 4 | Filters | Minor | Gender and blood group filtering |
| 5 | Pagination | Minor | Server-side pagination with 50 records per page |
| 6 | Real-time Updates | Major | Supabase Realtime subscription — new patients appear live across all sessions |
| 7 | Patient Profile | Major | Complete patient detail page with timeline, encounters, prescriptions, lab reports |
| 8 | Patient Timeline | Major | Chronological view of all patient interactions (encounters, labs, prescriptions, bills) |
| 9 | Quick Actions from List | Minor | Start OPD or Admit patient directly from the patient list |
| 10 | Mobile-Responsive Cards | Minor | Separate mobile card layout vs desktop table |
| 11 | ABHA ID Display | Minor | Shows ABHA (Ayushman Bharat Health Account) ID if linked |
| 12 | Error Handling | Minor | Graceful error banners with retry buttons |

---

### 2.3 OPD (OUT-PATIENT DEPARTMENT)

| # | Feature | Type | Description |
|---|---------|------|-------------|
| 1 | Patient Selection | Major | Search or select from recent patients to start consultation |
| 2 | Recent Patients (Live) | Major | Shows last 5 registered patients with real-time Supabase subscription |
| 3 | Encounter Creation | Major | Full OPD encounter form with chief complaint, vitals, examination, diagnosis |
| 4 | Vitals Recording | Major | BP (systolic/diastolic), pulse, temperature, SpO2, weight, respiratory rate |
| 5 | Prescription Writing | Major | Multi-drug prescription with drug name, dose, frequency, duration, route |
| 6 | Drug Database Integration | Major | Built-in drug database for auto-suggestions during prescription |
| 7 | Drug Interaction Checking | Major | Automatic drug-drug interaction alerts before prescribing |
| 8 | Dose Validation | Major | Age/weight-based dose validation for safety |
| 9 | Allergy Alerts | Major | Warns if prescribing a drug the patient is allergic to |
| 10 | Follow-up Scheduling | Minor | Set follow-up date during consultation, auto-creates reminder |
| 11 | Bridge from Patient List | Minor | Direct URL parameter passing from patients page to OPD |
| 12 | Gynecology Templates | Major | Specialized OB/GYN examination templates with LMP, EDD, gravida/para |
| 13 | Prescription PDF | Major | Generate printable PDF prescriptions |
| 14 | Prescription Safety Engine | Major | Comprehensive safety checks before finalizing prescriptions |



---

### 2.4 IPD (IN-PATIENT DEPARTMENT)

| # | Feature | Type | Description |
|---|---------|------|-------------|
| 1 | IPD Admission | Major | Full admission form: patient, bed, doctors, clinical details, relative info |
| 2 | Bed Assignment | Major | Select from available beds with ward information |
| 3 | Multi-Doctor Support | Major | Assign primary admitting doctor + multiple consulting doctors per admission |
| 4 | IPD Census | Major | Live view of all active admissions with days-since-admission tracking |
| 5 | Nursing Chart — Vitals | Major | Record pulse, BP, temperature, SpO2, respiratory rate, weight at intervals |
| 6 | Nursing Chart — I/O | Major | Input/Output charting (IV fluids, oral intake, urine output, drain) |
| 7 | Nursing Chart — Medications | Major | Medication administration record with drug, dose, route, given-by |
| 8 | Nursing Chart — Notes | Minor | Free-text nursing notes with timestamp |
| 9 | Discharge Workflow | Major | Mark patient discharged, auto-frees the bed (sets to 'cleaning') |
| 10 | Diet Type Management | Minor | Normal, Soft, Liquid, NPO, Diabetic, Low salt, High protein |
| 11 | Insurance Details | Minor | Capture insurance/TPA info at admission |
| 12 | Long-Stay Alerts | Minor | Highlights patients admitted >7 days in orange |
| 13 | Attendant Information | Minor | Relative name, contact, relation |
| 14 | Comorbidity Tracking | Minor | DM, HTN, Thyroid etc. at admission |

---

### 2.5 APPOINTMENT MANAGEMENT

| # | Feature | Type | Description |
|---|---------|------|-------------|
| 1 | Appointment Booking | Major | Select patient, date, time slot (15-min intervals 8AM-8PM), visit type |
| 2 | 13 Visit Types | Minor | ANC Follow-up, Follow-up, OPD, Pre-Surgery, Post-op, Lab Report, Infertility, PCOS, USG, Discharge, Contraception, Colposcopy, Other |
| 3 | Status Management | Major | Scheduled → Confirmed → Completed / Cancelled / No-Show |
| 4 | WhatsApp Patient Reminder | Major | Auto-generated WhatsApp message with date, time, arrival time, items to bring |
| 5 | WhatsApp Doctor Brief | Major | Patient summary sent to doctor: last visit, medications, diagnosis |
| 6 | Tab-based Filtering | Minor | Today, Upcoming, Past, All, Custom Date picker |
| 7 | Status & Type Filters | Minor | Filter by appointment status and visit type |
| 8 | Real-time Updates | Major | Supabase Realtime subscription refreshes when appointments change |
| 9 | OT Schedule Display | Minor | Shows upcoming surgeries inline on the appointments page |
| 10 | Reminder Sent Tracking | Minor | Marks appointments where reminder was already sent |
| 11 | One-Click Phone Call | Minor | Direct tel: link to call patient from the reminder view |
| 12 | Appointment Count Stats | Minor | Today/Upcoming/Past counters in header |



---

### 2.6 BILLING & PAYMENTS

| # | Feature | Type | Description |
|---|---------|------|-------------|
| 1 | Multi-Item Bill Creation | Major | Add multiple fee items per bill (OPD, ANC, USG, procedures, etc.) |
| 2 | Fee Presets | Major | 18 configurable fee presets (OPD, ANC, Follow-up, Emergency, USG types, procedures) |
| 3 | Custom Line Items | Minor | Add any custom service with custom amount |
| 4 | Discount Application | Major | Apply flat discount amount before payment |
| 5 | GST Calculation | Major | Configurable GST percentage with auto-calculation (0%, 5%, 12%, 18%) |
| 6 | Cash Payment | Major | Record cash payments directly |
| 7 | Razorpay UPI/Card | Major | Online payment via Razorpay (UPI, GPay, PhonePe, Debit/Credit card) |
| 8 | Duplicate Payment Prevention | Major | Three-layer idempotency: in-memory guard, DB lookup, UNIQUE constraint |
| 9 | Payment Receipt | Major | Detailed receipt view with print functionality |
| 10 | Bill History | Major | List of all bills with status/mode filters, last 30 days default |
| 11 | CA (Chartered Accountant) Report | Major | Period-based revenue reports: gross, discounts, net, payment breakdown, service breakdown |
| 12 | WhatsApp CA Report | Minor | Share revenue report via WhatsApp to CA |
| 13 | Email CA Report | Minor | Send revenue report via email |
| 14 | Admin Bill Modify | Minor | Admin can modify existing bills (restricted permission) |
| 15 | Auto-Fee from Encounter | Minor | Automatically adds consultation fee based on encounter type (OPD/ANC/FollowUp) |
| 16 | Patient Pre-fill from URL | Minor | Deep-linking from consultation to billing with patient pre-selected |

---

### 2.7 PHARMACY & INVENTORY

| # | Feature | Type | Description |
|---|---------|------|-------------|
| 1 | Medicine Catalog | Major | Full medicine database: name, generic, brand, form, strength, category, manufacturer |
| 2 | Add Medicine | Major | Register new medicines with all metadata (12 dosage forms, 18 categories) |
| 3 | Stock Management | Major | Add stock with batch number, expiry date, purchase price, supplier |
| 4 | Stock Level Monitoring | Major | Real-time stock counts with Low Stock and Out of Stock alerts |
| 5 | Min Stock Alerts | Major | Configurable minimum stock threshold per medicine |
| 6 | Batch Tracking | Major | Individual batch records with expiry dates |
| 7 | Stock Log | Major | Audit trail of all stock additions (purchase type) |
| 8 | Search & Filter | Minor | Search by name/generic/brand, filter by All/Low Stock/Out of Stock |
| 9 | Soft Delete | Minor | Deactivate medicines instead of hard delete |
| 10 | Import Database | Minor | Bulk medicine database import feature |
| 11 | MRP & Selling Price | Minor | Track both MRP and actual selling price |



---

### 2.8 LABORATORY MANAGEMENT

| # | Feature | Type | Description |
|---|---------|------|-------------|
| 1 | Lab Report Entry | Major | Record lab results with test name, value, unit, reference range, status (normal/high/low) |
| 2 | 50+ Test Presets | Major | Pre-configured tests across 7 groups: Blood Routine, Sugar, Thyroid, Hormones, Infection, Urine, Iron Studies |
| 3 | Auto Status Detection | Major | Automatically marks values as Normal/High/Low based on reference ranges |
| 4 | OCR Lab Report Scanning | Major | Scan printed lab reports using Tesseract.js — auto-extracts test names and pre-fills form |
| 5 | AI PDF Lab Extraction | Major | Upload PDF lab reports — AI (Anthropic/OpenAI) extracts all values and populates entries |
| 6 | Abnormal Value Alerts | Major | Automatically creates doctor alerts for abnormal lab values |
| 7 | Lab Partner Management | Major | Assign lab partners with revenue sharing percentages (hospital % vs lab %) |
| 8 | Revenue Split Calculation | Major | Auto-calculates hospital amount and lab amount based on partner's share |
| 9 | Payment Mode Tracking | Minor | Track how lab tests were paid (cash/UPI/card) |
| 10 | WhatsApp Report Ready | Minor | Auto-notification when lab report is ready |
| 11 | Audit Logging | Minor | Create/update/delete actions logged for compliance |
| 12 | Encounter Linking | Minor | Link lab reports to specific patient encounters |

---

### 2.9 ANTENATAL CARE (ANC)

| # | Feature | Type | Description |
|---|---------|------|-------------|
| 1 | ANC Registry | Major | Consolidated view of all pregnant patients with key metrics |
| 2 | Gestational Age Calculation | Major | Auto-calculates GA from LMP in weeks+days format |
| 3 | EDD Tracking | Major | Expected Delivery Date calculation and countdown |
| 4 | Clinical Risk Assessment | Major | 10-factor evidence-based risk engine (BP, Hb, prev CS, GDM, twins, post-dates, age, multigravida, FHS, liquor) |
| 5 | Risk Classification | Major | Three-tier risk: Normal / Watch / High Risk with color-coded badges |
| 6 | Obstetric Data | Major | Gravida, Para, FHS, Liquor, Presentation, Fundal Height |
| 7 | High-Risk Filtering | Minor | Filter registry by risk level or "due soon" |
| 8 | WhatsApp ANC Reminders | Minor | Send ANC-specific reminder templates via WhatsApp |
| 9 | 18-Month Lookback | Minor | Performance optimization — only loads recent ANC data |
| 10 | India-Specific Risk Factors | Minor | Anaemia threshold adjusted for Indian population |

---

### 2.10 INSURANCE & CLAIMS

| # | Feature | Type | Description |
|---|---------|------|-------------|
| 1 | Claim Creation | Major | Create insurance claims with policy, TPA, company, amounts |
| 2 | 11-Stage Status Workflow | Major | Pre-auth Pending → Approved → Claim Submitted → Under Review → Query → Approved → Settled |
| 3 | Status Transitions | Major | Defined valid next-states for each status (prevents invalid jumps) |
| 4 | Pre-Authorization | Major | Track pre-auth numbers and approval/rejection |
| 5 | Settlement Tracking | Major | UTR number, settlement date, approved vs claimed amount |
| 6 | Document Sent Tracking | Minor | Mark when documents have been sent to TPA |
| 7 | Claim Search & Filter | Minor | Search by patient, filter by status |
| 8 | Amount Tracking | Minor | Claim amount vs approved amount comparison |



---

### 2.11 VIDEO CONSULTATION (TELEMEDICINE)

| # | Feature | Type | Description |
|---|---------|------|-------------|
| 1 | Slot Creation | Major | Create video consultation time slots with date, time, doctor |
| 2 | Jitsi Integration | Major | Embedded Jitsi Meet iframe — doctor joins call directly in-app |
| 3 | Patient Link Sharing | Major | Generate shareable video call link for patients |
| 4 | WhatsApp Link Sharing | Major | Send video call link to patient via WhatsApp |
| 5 | In-App Call Panel | Major | Side-by-side view of video call + patient information |
| 6 | Slot Status Management | Minor | Open / Booked / Completed / Missed status tracking |
| 7 | Real-time Updates | Minor | Supabase Realtime for slot status changes |
| 8 | Copy Link | Minor | One-click copy of video URL |
| 9 | Mark Complete | Minor | Doctor can mark call as completed |
| 10 | Portal Token Generation | Minor | Auto-generates patient portal access token for video slot |

---

### 2.12 QUEUE MANAGEMENT (OPD TOKEN SYSTEM)

| # | Feature | Type | Description |
|---|---------|------|-------------|
| 1 | Token Generation | Major | Auto-incrementing daily token numbers for OPD queue |
| 2 | Queue Status Tracking | Major | Waiting → In Progress → Done / Cancelled |
| 3 | Priority Levels | Major | Normal / Urgent / Emergency priority for queue entries |
| 4 | Real-time Queue Board | Major | Supabase Realtime — queue updates live across all screens |
| 5 | Patient Linking | Minor | Each queue entry links to patient record and encounter |
| 6 | Audit Logging | Minor | All status changes logged |
| 7 | Date-based Reset | Minor | Token numbers reset each day |

---

### 2.13 REMINDERS & NOTIFICATIONS

| # | Feature | Type | Description |
|---|---------|------|-------------|
| 1 | Multi-Type Reminders | Major | Appointment, Follow-up, ANC, Post-Delivery, Vaccination, Pending Bill, High-Risk ANC, OT Surgery |
| 2 | Priority Classification | Major | Urgent / Today / Tomorrow / Upcoming — color-coded |
| 3 | WhatsApp Reminder Templates | Major | Pre-built, contextual WhatsApp messages for each reminder type |
| 4 | Reminder Sent Tracking | Major | Records when reminder was sent, prevents duplicates |
| 5 | Contextual Information | Minor | Each reminder includes relevant patient context (LMP, EDD, diagnosis, bill amount) |
| 6 | Automation Engine | Major | Background automation for generating reminders from appointments, prescriptions, ANC data |
| 7 | Bulk Send Capability | Minor | Process multiple reminders in one session |

---

### 2.14 ANALYTICS & REPORTING

| # | Feature | Type | Description |
|---|---------|------|-------------|
| 1 | Revenue Trend Chart | Major | Bar chart showing daily/weekly/monthly revenue over 30/90/365 days |
| 2 | Top 10 Diagnoses | Major | Horizontal bar chart of most common diagnoses |
| 3 | Peak OPD Hours | Major | Hourly traffic distribution chart (7AM-10PM) |
| 4 | Patient Retention | Major | Donut chart with retention rate, returning vs new patients |
| 5 | Visit Type Breakdown | Major | Stacked bar of encounter types (OPD, ANC, FollowUp, IPD, Emergency) |
| 6 | KPI Cards | Major | Revenue, Retention Rate, Peak Hour, New Patients this month |
| 7 | Period Comparison | Minor | Compare current period vs previous period with trend arrows |
| 8 | Quick Insights | Minor | AI-generated textual insights (avg daily revenue, growth %, suggestions) |
| 9 | Multi-Period Selection | Minor | Toggle between 30/90/365 day views |



---

### 2.15 REVENUE FORECASTING

| # | Feature | Type | Description |
|---|---------|------|-------------|
| 1 | Monthly Revenue Prediction | Major | Linear regression on 6 months of data to predict current month's revenue |
| 2 | Busiest Days Analysis | Major | Identifies which days of the week generate the most revenue |
| 3 | Peak Revenue Hours | Major | Identifies highest-earning hours |
| 4 | Growth Rate Calculation | Major | Monthly growth trend with percentage |
| 5 | Confidence Level | Minor | High/Medium/Low confidence based on data volume |
| 6 | Projected Remaining | Minor | How much more is expected to be earned this month |
| 7 | Patient Volume Prediction | Minor | Expected patient count based on trends |

---

### 2.16 OT (OPERATION THEATRE) SCHEDULE

| # | Feature | Type | Description |
|---|---------|------|-------------|
| 1 | Surgery Scheduling | Major | Schedule surgeries with patient, surgery name, date, time, surgeon, anesthetist, OT room |
| 2 | Priority Levels | Major | Elective / Urgent / Emergency |
| 3 | Status Workflow | Major | Scheduled → In Progress → Completed / Cancelled / Postponed |
| 4 | Pre-Op Checklist | Major | Consent taken, blood arranged, fasting confirmed |
| 5 | Delivery Date Suggestions | Major | AI-suggests patients nearing EDD for C-section scheduling |
| 6 | OT Room Assignment | Minor | Multiple OT rooms supported |
| 7 | Duration Estimation | Minor | Estimated surgery duration in minutes |
| 8 | Pre/Post-Op Notes | Minor | Free-text notes for before and after surgery |
| 9 | Anesthesia Type | Minor | Track type of anesthesia used |
| 10 | WhatsApp Surgery Reminder | Minor | Send surgery details to patient via WhatsApp |

---

### 2.17 PATIENT PORTAL

| # | Feature | Type | Description |
|---|---------|------|-------------|
| 1 | OTP-Based Login | Major | Patients log in with mobile number + OTP (no password needed) |
| 2 | Legacy Magic Link Support | Minor | Backward compatibility with token-based URL access |
| 3 | Patient Dashboard | Major | Patients can view their appointments, prescriptions, lab reports |
| 4 | Session Management | Minor | Portal sessions stored in localStorage with server validation |
| 5 | Secure Data Access | Minor | Patients can only see their own records |

---

### 2.18 BED MANAGEMENT

| # | Feature | Type | Description |
|---|---------|------|-------------|
| 1 | Bed Census | Major | Visual display of all beds with status (Available/Occupied/Cleaning/Maintenance) |
| 2 | Ward Organization | Major | Beds organized by ward |
| 3 | Auto-Status Updates | Major | Beds auto-transition: Available → Occupied (on admission) → Cleaning (on discharge) |
| 4 | Bed Assignment | Minor | Select bed during IPD admission |
| 5 | Patient Information | Minor | Shows patient name and admission date for occupied beds |

---

### 2.19 SEARCH (GLOBAL)

| # | Feature | Type | Description |
|---|---------|------|-------------|
| 1 | Cross-Entity Search | Major | Single search box queries patients, encounters (by diagnosis/complaint), prescriptions |
| 2 | Categorized Results | Minor | Results grouped by type (Patient/Encounter/Prescription) with icons |
| 3 | Deep Linking | Minor | Each result links directly to the relevant detail page |
| 4 | Real-time Search | Minor | Debounced search with loading indicator |



---

### 2.20 AUTHENTICATION & SECURITY

| # | Feature | Type | Description |
|---|---------|------|-------------|
| 1 | Role-Based Access Control | Major | Three roles: Admin, Doctor, Staff — each with specific permissions |
| 2 | 30+ Granular Permissions | Major | Fine-grained permissions: patients.view, encounters.create, billing.view, reports.financial, etc. |
| 3 | MFA / TOTP Support | Major | Multi-Factor Authentication using TOTP (Google Authenticator, Authy) |
| 4 | Supabase Auth Integration | Major | Email/password authentication with Supabase Auth |
| 5 | User Management | Major | Admin can create/edit/deactivate clinic users |
| 6 | Password Reset | Minor | Self-service password reset flow |
| 7 | Session Management | Minor | Automatic session handling via Supabase |
| 8 | PHI Encryption | Major | Client-side encryption for Protected Health Information |
| 9 | Row-Level Security (RLS) | Major | Supabase RLS policies ensure data isolation |
| 10 | Rate Limiting | Minor | API rate limiting to prevent abuse |

---

### 2.21 AI & AUTOMATION

| # | Feature | Type | Description |
|---|---------|------|-------------|
| 1 | AI Lab Value Extraction | Major | Upload PDF lab reports → AI extracts all test values automatically |
| 2 | AI Discharge Summary | Major | AI-generated discharge summaries from encounter data |
| 3 | AI Patient Summary | Major | AI-generated patient history summaries |
| 4 | Voice Commands | Major | Voice-controlled navigation and page actions (60+ registered commands) |
| 5 | Smart Microphone | Major | Always-available mic component for voice input |
| 6 | OCR Form Scanning | Major | Scan handwritten/printed forms using Tesseract.js |
| 7 | Doctor Note Camera | Minor | Capture and OCR doctor's handwritten notes |
| 8 | AI Voice Correction | Minor | AI corrects voice-to-text transcription errors |
| 9 | Automation Engine | Major | Background rules engine for auto-generating reminders, alerts, follow-ups |

---

### 2.22 ABDM & FHIR INTEGRATION

| # | Feature | Type | Description |
|---|---------|------|-------------|
| 1 | ABHA Verification | Major | Verify patient's ABHA (Ayushman Bharat Health Account) number |
| 2 | ABHA Creation | Major | Create new ABHA address with Aadhaar-based OTP verification |
| 3 | Health ID Linking | Major | Link patient records to their ABHA ID |
| 4 | FHIR R4 Mapping | Major | Convert HMS data to HL7 FHIR R4 resources (Patient, Encounter, Observation, MedicationRequest, Condition, Bundle) |
| 5 | FHIR Export | Major | Export patient records as FHIR-compliant bundles |
| 6 | Sandbox/Production Toggle | Minor | Switch between ABDM sandbox and production environments |

---

### 2.23 SETTINGS & CONFIGURATION

| # | Feature | Type | Description |
|---|---------|------|-------------|
| 1 | Hospital Profile | Major | Hospital name, address, phone, logo, GSTIN |
| 2 | Doctor Profile | Major | Doctor name, specialization, registration number |
| 3 | Fee Configuration | Major | Configurable OPD, ANC, Follow-up, Emergency, IPD fees |
| 4 | CA Settings | Minor | Chartered Accountant name, WhatsApp, email for reports |
| 5 | Auto-Save | Major | Settings auto-save to cloud after 2 seconds of inactivity |
| 6 | User Management | Major | Create/edit/deactivate staff accounts with role assignment |
| 7 | Lab Partner Configuration | Minor | Manage lab partners with revenue sharing percentages |
| 8 | Daily Revenue Target | Minor | Set daily target shown on dashboard |
| 9 | Data Export/Import | Minor | Export/import settings and configurations |

---

### 2.24 OFFLINE & PWA

| # | Feature | Type | Description |
|---|---------|------|-------------|
| 1 | Progressive Web App | Major | Installable on mobile/tablet with app-like experience |
| 2 | Offline Data Cache | Major | IndexedDB-based caching of patient data for offline search |
| 3 | Sync Queue | Major | Queues changes made offline for sync when connection restores |
| 4 | Network Status Detection | Minor | Detects online/offline state with useNetworkStatus hook |
| 5 | Prescription Draft Storage | Minor | Save prescription drafts locally |
| 6 | Service Worker | Minor | Background caching of static assets |

---

### 2.25 OTHER FEATURES

| # | Feature | Type | Description |
|---|---------|------|-------------|
| 1 | Audit Log | Major | Complete action trail: who did what, when (admin-only, searchable, filterable) |
| 2 | QR Code Generation | Minor | Generate QR codes for patient portal links, prescription links |
| 3 | PDF Generation | Major | Generate PDFs for prescriptions, bills, discharge summaries, reports |
| 4 | WhatsApp Notification Templates | Major | Pre-built message templates for all communication types |
| 5 | Data Retention Policies | Minor | Configurable data retention rules |
| 6 | Keyboard Shortcuts | Minor | Power-user keyboard shortcuts for navigation |
| 7 | Auto-Save Indicator | Minor | Visual indicator showing save status |
| 8 | Error Boundary | Minor | Graceful error handling preventing full-page crashes |
| 9 | Skeleton Loading | Minor | Proper loading states with skeleton placeholders |
| 10 | Accessibility Helpers | Minor | Screen reader support and accessibility improvements |
| 11 | Google Review Link | Minor | Generate Google review request for satisfied patients |
| 12 | Value Report | Minor | Patient value/outcome reports |
| 13 | Fund Management | Minor | Track hospital fund/cash flow |
| 14 | Forms (Printable) | Minor | Pre-designed printable HTML forms: Registration, Vitals, Consultation, Gynecology Exam |
| 15 | Discharge Summary | Major | AI-assisted discharge summary generation with FHIR export |



---

## 3. ADDITIONAL FEATURES — MUST HAVE

These are critical features that any production-ready HMS should implement:

---

### 3.1 MUST-HAVE (Critical for Production)

| # | Feature | Priority | Reason |
|---|---------|----------|--------|
| 1 | **Automated Backup & Disaster Recovery** | P0 | Patient data is irreplaceable. Need automated daily backups with point-in-time recovery and tested restore procedures |
| 2 | **Comprehensive E2E Test Suite** | P0 | Critical workflows (billing, prescriptions, admissions) must have automated tests to prevent regressions |
| 3 | **Consent Management System** | P0 | Legal requirement in India. Digital consent forms with patient signatures for procedures, data sharing, telemedicine |
| 4 | **Complete Discharge Summary Module** | P0 | Full discharge summary with diagnosis, procedures, medications at discharge, follow-up instructions, printed PDF |
| 5 | **Medicine Dispensing from Pharmacy** | P0 | Currently pharmacy is inventory-only. Need: link prescriptions → auto-deduct stock on dispense → generate medicine bill |
| 6 | **IPD Billing (Consolidated)** | P0 | IPD patients need consolidated bills: room charges × days + procedures + medicines + lab tests + doctor visits |
| 7 | **Email Notifications** | P1 | Not all patients use WhatsApp. Email appointment confirmations, lab reports, bills/receipts |
| 8 | **Proper Error Logging & Monitoring** | P1 | Need Sentry/equivalent for production error tracking, performance monitoring, uptime alerts |
| 9 | **Data Encryption at Rest** | P1 | PHI encryption exists but needs end-to-end audit. Ensure all sensitive fields are encrypted in the database |
| 10 | **Terms of Service & Privacy Policy** | P1 | Legal compliance — especially for patient portal and data handling |
| 11 | **HIPAA/Indian DPDP Act Compliance** | P1 | India's Digital Personal Data Protection Act 2023 compliance: data processing notices, consent, erasure rights |
| 12 | **Staff Activity Dashboard** | P1 | Admin needs visibility: which staff member did what, login times, actions per day |
| 13 | **Referral Letter Generation** | P1 | Generate referral letters to specialists with patient history summary |
| 14 | **Medical Certificate Generation** | P1 | Fitness certificates, sick leave certificates, medical certificates for patients |
| 15 | **Lab Report PDF Download for Patient** | P1 | Patients should download their lab reports as formatted PDFs from the portal |

---

### 3.2 MUST-HAVE (Operational Necessity)

| # | Feature | Priority | Reason |
|---|---------|----------|--------|
| 16 | **Inventory Expiry Alerts** | P1 | Pharmacy batches have expiry dates but no alerting system for nearing-expiry medicines |
| 17 | **Appointment Slot Conflict Detection** | P1 | Currently no check for double-booking same time slot — critical for single-doctor clinics |
| 18 | **Patient Merge/Deduplication** | P1 | Real clinics inevitably create duplicate patients — need merge tool |
| 19 | **Receipt Number / Invoice Numbering** | P1 | Sequential bill/receipt numbers required for tax compliance |
| 20 | **Vaccination Schedule Tracking** | P1 | For ANC module: track immunization (TT, COVID, Flu) with due dates |
| 21 | **Lab Report Templates for Common Panels** | P1 | One-click add entire panel (CBC panel = 5 tests, Thyroid panel = 4 tests, ANC panel = 10 tests) |
| 22 | **Prescription Refill Tracking** | P1 | Track how many refills prescribed vs dispensed |
| 23 | **Staff Shift/Duty Roster** | P1 | Nurse/staff scheduling for IPD coverage |



---

## 4. ADDITIONAL FEATURES — GOOD TO HAVE

These features significantly enhance the user experience and competitive positioning:

---

### 4.1 PATIENT ENGAGEMENT

| # | Feature | Priority | Reason |
|---|---------|----------|--------|
| 1 | **Patient Mobile App (React Native)** | P2 | Dedicated patient app for appointments, prescriptions, lab results, bill payments |
| 2 | **Appointment Self-Booking** | P2 | Patients book their own appointments from the portal (with doctor approval) |
| 3 | **Patient Feedback/Rating** | P2 | Post-visit feedback collection with NPS scoring |
| 4 | **Birthday/Anniversary Wishes** | P3 | Automated birthday greetings via WhatsApp — improves patient loyalty |
| 5 | **Patient Education Content** | P3 | Share educational material (diet charts, exercise guides) relevant to diagnosis |
| 6 | **Online Payment from Portal** | P2 | Patients pay pending bills online from the patient portal |
| 7 | **Prescription Reminder (Patient)** | P2 | Daily medicine reminders sent to patient via WhatsApp/SMS |

---

### 4.2 CLINICAL ENHANCEMENTS

| # | Feature | Priority | Reason |
|---|---------|----------|--------|
| 8 | **Clinical Decision Support (CDS)** | P2 | AI-powered diagnosis suggestions based on symptoms, vitals, and lab values |
| 9 | **ICD-10 Coding** | P2 | International Classification of Diseases coding for diagnoses — needed for insurance and reporting |
| 10 | **SNOMED CT Integration** | P3 | Standardized clinical terminology for interoperability |
| 11 | **Growth Chart for Pediatrics** | P3 | If expanding beyond OB/GYN — WHO growth chart tracking |
| 12 | **Photo Documentation** | P2 | Capture and store clinical photos (wound progress, ultrasound images) linked to encounters |
| 13 | **Vitals Trending/Graphing** | P2 | Graph patient vitals over time (BP trend, weight trend during pregnancy) |
| 14 | **Custom Form Builder** | P2 | Admin creates custom intake forms, consent forms, assessment forms |
| 15 | **Surgical Checklist (WHO)** | P2 | WHO Surgical Safety Checklist integration for OT module |
| 16 | **Blood Bank Integration** | P3 | Track blood products: request, issue, return, cross-match |

---

### 4.3 OPERATIONAL EFFICIENCY

| # | Feature | Priority | Reason |
|---|---------|----------|--------|
| 17 | **Multi-Branch Support** | P2 | Support multiple clinic locations under one account |
| 18 | **Inventory Purchase Orders** | P2 | Generate purchase orders to suppliers when stock is low |
| 19 | **Vendor/Supplier Management** | P3 | Maintain supplier database with contact, payment terms |
| 20 | **Asset Management** | P3 | Track hospital equipment: maintenance schedules, AMC, depreciation |
| 21 | **Housekeeping Module** | P3 | Room cleaning schedules, linen management, waste disposal tracking |
| 22 | **Diet Kitchen Integration** | P3 | Link diet orders from IPD to kitchen preparation lists |
| 23 | **SMS Gateway Integration** | P2 | For patients without WhatsApp — critical for rural areas |
| 24 | **Automated Appointment Reminders (Cron)** | P2 | Auto-send reminders 24h and 1h before appointment without manual trigger |
| 25 | **Waiting Time Estimation** | P2 | Show patients estimated wait time based on queue position and avg consultation duration |

---

### 4.4 FINANCIAL & COMPLIANCE

| # | Feature | Priority | Reason |
|---|---------|----------|--------|
| 26 | **Tally/Accounting Software Export** | P2 | Export financial data in Tally-compatible format for CA |
| 27 | **E-Invoice Generation (GST)** | P2 | GST e-invoicing compliance for revenue > threshold |
| 28 | **Payment Due Reminders** | P2 | Automated reminders for patients with pending bills |
| 29 | **EMI/Installment Plans** | P3 | Allow patients to pay in installments for expensive procedures |
| 30 | **Financial Dashboard for Admin** | P2 | Expense tracking, profit/loss, department-wise revenue |
| 31 | **Tax Report Generation** | P2 | Auto-generate quarterly GST returns, annual tax summary |
| 32 | **Insurance Panel Empanelment Tracker** | P3 | Track which insurance companies the hospital is empaneled with |

---

### 4.5 ADVANCED TECHNOLOGY

| # | Feature | Priority | Reason |
|---|---------|----------|--------|
| 33 | **WhatsApp Business API (Official)** | P2 | Replace wa.me links with official WhatsApp Business API for automated messages |
| 34 | **Push Notifications** | P2 | PWA push notifications for staff alerts, appointment reminders |
| 35 | **Barcode/QR on Prescriptions** | P3 | Scannable codes on prescriptions for pharmacy dispensing |
| 36 | **Digital Signature** | P2 | Doctor's digital signature on prescriptions and certificates |
| 37 | **Voice-to-Text Clinical Notes** | P2 | Real-time voice transcription during consultation (enhanced from current) |
| 38 | **AI Treatment Protocol Suggestions** | P3 | AI suggests standard treatment protocols based on diagnosis |
| 39 | **Wearable Device Integration** | P3 | Import vitals from patient's smartwatch/BP monitor |
| 40 | **Dark Mode** | P3 | For doctors doing late-night documentation |
| 41 | **Multi-Language Support (i18n)** | P2 | Hindi, Marathi, other regional languages for patient-facing content |
| 42 | **Report Export (Excel/CSV)** | P2 | Export analytics, patient lists, billing data to Excel/CSV |



---

## 5. FEATURE PRIORITY MATRIX

### Summary Count

| Category | Count |
|----------|-------|
| Existing Major Features | 47 |
| Existing Minor Features | 85+ |
| Must-Have Additional (P0-P1) | 23 |
| Good-to-Have Additional (P2-P3) | 42 |
| **Total Features (Existing + Proposed)** | **197+** |

---

### Implementation Priority Recommendation

#### 🔴 IMMEDIATE (P0) — Before Production Launch
1. Automated Backup & Disaster Recovery
2. Consent Management System
3. Medicine Dispensing from Pharmacy (link Rx → stock deduction)
4. IPD Consolidated Billing
5. Discharge Summary Completion
6. E2E Test Suite for critical paths

#### 🟠 HIGH (P1) — Within 1 Month Post-Launch
7. Error Logging & Monitoring (Sentry)
8. Appointment Slot Conflict Detection
9. Patient Merge/Deduplication
10. Receipt/Invoice Numbering (Tax compliance)
11. Inventory Expiry Alerts
12. DPDP Act Compliance (Privacy Policy, Consent)
13. Email Notifications
14. Referral & Medical Certificate Generation
15. Staff Activity Dashboard

#### 🟡 MEDIUM (P2) — Within 3 Months
16. SMS Gateway Integration
17. Automated Cron-based Reminders
18. Vitals Trending/Graphing
19. ICD-10 Coding
20. Multi-Language Support
21. Report Export (Excel/CSV)
22. Digital Signature
23. Photo Documentation
24. Patient Self-Booking
25. Financial Dashboard

#### 🟢 LOW (P3) — Within 6 Months (Competitive Advantage)
26. Patient Mobile App
27. WhatsApp Business API
28. AI Treatment Suggestions
29. SNOMED CT
30. Multi-Branch Support
31. Dark Mode
32. Wearable Integration
33. Custom Form Builder

---

## APPENDIX A: TECHNOLOGY STACK

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | Next.js 14 (App Router) | Server-side rendering, routing |
| UI | React 18 + Tailwind CSS | Component library, styling |
| Backend/DB | Supabase (PostgreSQL) | Database, Auth, Realtime, Storage, RLS |
| AI | Anthropic Claude + OpenAI | Lab extraction, summaries, voice correction |
| OCR | Tesseract.js | Form scanning, lab report reading |
| PDF | @react-pdf/renderer + pdf-lib | PDF generation and manipulation |
| Payments | Razorpay | Online payments (UPI, Card) |
| Video | Jitsi Meet | Telemedicine video calls |
| PWA | next-pwa | Offline support, installability |
| QR | qrcode library | QR code generation |
| Icons | Lucide React | UI icons |
| Testing | Playwright + Vitest | E2E and unit tests |
| Hosting | Vercel | Deployment and edge functions |

---

## APPENDIX B: DATABASE SCHEMA (Key Tables)

- `patients` — Patient demographics
- `encounters` — OPD/IPD consultations
- `prescriptions` — Medication orders
- `bills` / `bill_payments` — Financial records
- `appointments` — Scheduling
- `lab_reports` — Lab results
- `ipd_admissions` / `ipd_nursing` — In-patient records
- `beds` — Bed status
- `pharmacy_medicines` / `pharmacy_batches` / `pharmacy_stock_log` — Inventory
- `ot_schedules` — Surgery scheduling
- `insurance_claims` — Claims tracking
- `opd_queue` — Token queue
- `doctor_alerts` — Clinical alerts
- `audit_log` — Activity tracking
- `clinic_users` — Staff/doctor accounts
- `clinicsettings` — Hospital configuration
- `lab_partners` — Revenue sharing partners
- `portal_sessions` / `portal_tokens` — Patient portal auth
- `video_slots` — Telemedicine appointments

---

*Document generated by Kiro AI — May 19, 2026*  
*For NexMedicon Hospital Management System v0.2.0*
