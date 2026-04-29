# NexMedicon HMS — BAA & Data Compliance Documentation

## Business Associate Agreement (BAA) with Supabase

### What is a BAA?

A Business Associate Agreement is a legal contract between a healthcare provider (you) and a service provider (Supabase) that handles Protected Health Information (PHI). It ensures the service provider:

1. Safeguards PHI appropriately
2. Reports any data breaches
3. Limits use of PHI to contracted purposes
4. Returns or destroys PHI when the contract ends

### Supabase BAA Status

**Supabase offers BAA signing for Pro and Enterprise plans.**

#### How to Request a BAA from Supabase:

1. **Upgrade to Supabase Pro Plan** ($25/month per project)
   - Go to: https://supabase.com/dashboard → Project Settings → Billing
   - Select "Pro" plan

2. **Request BAA Signing**
   - Email: support@supabase.io
   - Subject: "BAA Request for Healthcare Application"
   - Include:
     - Your organization name
     - Project reference ID (found in Project Settings)
     - Contact person and email
     - Brief description: "Hospital Management System handling patient PHI"

3. **Supabase will provide:**
   - Standard BAA document
   - Data Processing Agreement (DPA)
   - Sub-processor list

4. **Review and sign** — have your legal counsel review before signing

### Supabase Security Features (Already Enabled)

| Feature | Status | Details |
|---------|--------|---------|
| Encryption at rest | ✅ Enabled | AES-256 encryption on all data |
| Encryption in transit | ✅ Enabled | TLS 1.2+ for all connections |
| Row Level Security (RLS) | ✅ Enabled | All tables have RLS policies |
| Auth with MFA | ✅ Enabled | TOTP-based MFA available |
| Audit logging | ✅ Enabled | All data access logged |
| Automatic backups | ✅ Enabled | Daily backups by Supabase (Pro plan) |
| Point-in-time recovery | ✅ Available | Pro plan: 7-day PITR |
| SOC 2 Type II | ✅ Certified | Supabase is SOC 2 compliant |
| HIPAA compliance | ✅ Available | With signed BAA on Pro/Enterprise |

---

## Indian DPDP Act 2023 Compliance

The Digital Personal Data Protection Act, 2023 (India) applies to NexMedicon HMS.

### Compliance Checklist

| # | Requirement | Implementation | Status |
|---|------------|----------------|--------|
| 1 | **Consent** — Obtain patient consent before processing data | Patient registration form includes consent checkbox | ✅ |
| 2 | **Purpose limitation** — Use data only for stated purpose | Data used only for clinical care and billing | ✅ |
| 3 | **Data minimization** — Collect only necessary data | Registration collects only clinically relevant fields | ✅ |
| 4 | **Accuracy** — Keep data accurate and up-to-date | Edit functionality available for all patient records | ✅ |
| 5 | **Storage limitation** — Don't retain data beyond necessity | Data retention policies with legal minimums enforced | ✅ |
| 6 | **Security** — Implement appropriate security measures | Encryption, RLS, MFA, audit logging | ✅ |
| 7 | **Breach notification** — Notify within 72 hours | Incident response plan documented below | ✅ |
| 8 | **Data portability** — Allow data export | Full JSON/CSV export available for admin | ✅ |
| 9 | **Right to erasure** — Delete data on request | Admin can delete patient records (with audit trail) | ✅ |
| 10 | **Data Protection Officer** — Appoint if required | Clinic admin serves as DPO for small clinics | ✅ |

### Indian Medical Council Requirements

| Requirement | Retention Period | Implementation |
|------------|-----------------|----------------|
| Patient medical records | **Minimum 7 years** | 10-year retention policy set |
| Financial/billing records | **Minimum 8 years** (Income Tax Act) | 8-year retention policy set |
| Audit trail | **Minimum 7 years** | 10-year retention, immutable |
| Prescription records | **Minimum 7 years** | 10-year retention policy set |
| Lab reports | **Minimum 7 years** | 10-year retention policy set |

---

## Data Processing Agreement Template

### Between:
- **Data Controller:** [Clinic Name] ("the Clinic")
- **Data Processor:** Supabase Inc. ("the Processor")

### Purpose:
Storage and processing of patient health information for the NexMedicon Hospital Management System.

### Data Categories Processed:
1. Patient demographics (name, age, gender, contact)
2. Medical records (diagnoses, prescriptions, lab results)
3. Billing information
4. Appointment records
5. Audit logs

### Security Measures:
1. All data encrypted at rest (AES-256)
2. All data encrypted in transit (TLS 1.2+)
3. Row-level security on all database tables
4. Multi-factor authentication for all users
5. Immutable audit log with hash chain verification
6. Automated daily backups with 30-day retention
7. Role-based access control (Admin/Doctor/Staff)

### Breach Response Plan:
1. **Detection** — Automated monitoring via system health checks
2. **Containment** — Immediate access revocation if breach detected
3. **Assessment** — Determine scope and affected records
4. **Notification** — Notify affected patients within 72 hours
5. **Remediation** — Fix vulnerability and restore from backup
6. **Documentation** — Full incident report in audit log

---

## Verification Steps for Clinic Admin

### Before Going Live:

- [ ] Supabase Pro plan activated
- [ ] BAA signed with Supabase
- [ ] All SQL migrations run (v1 through v15)
- [ ] RLS enabled on all tables (verify in Supabase dashboard)
- [ ] MFA enabled for all admin accounts
- [ ] Backup cron configured and tested
- [ ] Data retention policies reviewed and confirmed
- [ ] Staff trained on data handling procedures
- [ ] Patient consent form includes data processing notice
- [ ] Emergency contact for data breach response documented

### Monthly Compliance Checks:

- [ ] Review audit log for unauthorized access attempts
- [ ] Verify backup completion (Settings → Backup History)
- [ ] Check data retention report (Settings → Data Retention)
- [ ] Review user access list (Settings → Manage Users)
- [ ] Test data export functionality
- [ ] Verify MFA is active for all users
