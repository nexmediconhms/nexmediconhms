-- ============================================================
-- NexMedicon HMS — Demo Seed Data
-- Realistic gynecology patients for pilot demo
--
-- HOW TO RUN:
-- 1. Open Supabase → SQL Editor → New Query
-- 2. Paste this entire file and click Run
-- 3. You should see "Demo data seeded successfully ✓"
--
-- SAFE TO RE-RUN: Uses INSERT with ON CONFLICT DO NOTHING
-- WARNING: This inserts ~15 patients + encounters + prescriptions.
--          Run once. Re-running will skip duplicates.
-- ============================================================

-- ── Wrap in a transaction so it's all-or-nothing ──────────────
BEGIN;

-- ── 1. PATIENTS ───────────────────────────────────────────────
-- Using fixed UUIDs so encounters can reference them reliably
INSERT INTO patients (id, full_name, age, date_of_birth, gender, mobile, blood_group, address, abha_id, emergency_contact_name, emergency_contact_phone)
VALUES
  -- ANC / Pregnancy patients
  ('11111111-0001-0001-0001-000000000001', 'Priya Sharma',       26, '1998-03-15', 'Female', '9876543210', 'B+', 'Block A, Satellite, Ahmedabad - 380015', '12345678901234', 'Rahul Sharma',   '9876543299'),
  ('11111111-0002-0002-0002-000000000002', 'Kavita Patel',       29, '1995-07-22', 'Female', '9876543211', 'A+', '14, Navrangpura, Ahmedabad - 380009',   '12345678902345', 'Dinesh Patel',   '9876543298'),
  ('11111111-0003-0003-0003-000000000003', 'Meena Desai',        32, '1992-11-08', 'Female', '9876543212', 'O+', '7, Bopal, Ahmedabad - 380058',          '12345678903456', 'Suresh Desai',   '9876543297'),
  ('11111111-0004-0004-0004-000000000004', 'Rima Shah',          24, '2000-05-30', 'Female', '9876543213', 'AB+','22, Maninagar, Ahmedabad - 380008',     NULL,             'Bharat Shah',    '9876543296'),
  ('11111111-0005-0005-0005-000000000005', 'Sunita Joshi',       35, '1989-09-12', 'Female', '9876543214', 'B-', '5, Gota, Ahmedabad - 382481',           '12345678905678', 'Rajesh Joshi',   '9876543295'),

  -- Gynecology (non-ANC) patients
  ('11111111-0006-0006-0006-000000000006', 'Anita Mehta',        28, '1996-01-20', 'Female', '9876543215', 'A-', '9, Vastrapur, Ahmedabad - 380015',      NULL,             'Kiran Mehta',    '9876543294'),
  ('11111111-0007-0007-0007-000000000007', 'Pooja Trivedi',      22, '2002-04-18', 'Female', '9876543216', 'O-', '3, Chandkheda, Ahmedabad - 382424',     '12345678907890', 'Hitesh Trivedi', '9876543293'),
  ('11111111-0008-0008-0008-000000000008', 'Lalita Verma',       41, '1983-12-05', 'Female', '9876543217', 'B+', '18, Paldi, Ahmedabad - 380007',         '12345678908901', 'Anil Verma',     '9876543292'),
  ('11111111-0009-0009-0009-000000000009', 'Rekha Nair',         33, '1991-06-25', 'Female', '9876543218', 'A+', '6, Thaltej, Ahmedabad - 380054',        '12345678909012', 'Sunil Nair',     '9876543291'),
  ('11111111-0010-0010-0010-000000000010', 'Deepa Agarwal',      27, '1997-08-14', 'Female', '9876543219', 'O+', '11, Naranpura, Ahmedabad - 380013',     NULL,             'Amit Agarwal',   '9876543290'),

  -- Follow-up overdue (for demo of alert)
  ('11111111-0011-0011-0011-000000000011', 'Varsha Solanki',     30, '1994-02-28', 'Female', '9876543220', 'AB-','25, Kudasan, Gandhinagar - 382421',     '12345678911234', 'Paresh Solanki', '9876543289'),
  ('11111111-0012-0012-0012-000000000012', 'Hetal Panchal',      25, '1999-10-07', 'Female', '9876543221', 'B+', '8, Motera, Ahmedabad - 380005',         NULL,             'Nish Panchal',   '9876543288'),

  -- IPD / admitted patients
  ('11111111-0013-0013-0013-000000000013', 'Bhavna Rana',        31, '1993-03-19', 'Female', '9876543222', 'A+', '12, Nikol, Ahmedabad - 382350',         '12345678913456', 'Vikas Rana',     '9876543287'),
  ('11111111-0014-0014-0014-000000000014', 'Sejal Chauhan',      38, '1986-07-01', 'Female', '9876543223', 'O+', '4, Vastral, Ahmedabad - 382418',        '12345678914567', 'Hemant Chauhan', '9876543286'),
  ('11111111-0015-0015-0015-000000000015', 'Nisha Yadav',        23, '2001-11-23', 'Female', '9876543224', 'B+', '16, Isanpur, Ahmedabad - 382443',       NULL,             'Raj Yadav',      '9876543285')
ON CONFLICT (id) DO NOTHING;

-- ── 2. ENCOUNTERS ─────────────────────────────────────────────
-- Using current_date minus offsets so dates are always recent
INSERT INTO encounters (id, patient_id, encounter_date, encounter_type, chief_complaint, pulse, bp_systolic, bp_diastolic, temperature, spo2, weight, height, diagnosis, notes, ob_data, doctor_name)
VALUES
  -- Priya Sharma — ANC visits G2P1
  ('22222222-0001-0001-0001-000000000001', '11111111-0001-0001-0001-000000000001',
   CURRENT_DATE - 60, 'OPD', 'Routine ANC visit, mild nausea', 82, 110, 70, 37.0, 99, 58, 158,
   'Normal pregnancy — 20 weeks',
   'Patient comfortable. FHS heard clearly. No complaints except mild morning nausea.',
   '{"lmp":"' || to_char(CURRENT_DATE - 20*7, 'YYYY-MM-DD') || '","edd":"' || to_char(CURRENT_DATE + 20*7, 'YYYY-MM-DD') || '","gestational_age":"20 weeks 0 days","gravida":2,"para":1,"abortion":0,"living":1,"fhs":148,"liquor":"Normal","fundal_height":20,"presentation":"Cephalic","engagement":"Not engaged","uterus_size":"20 wks"}',
   'Dr. Demo'),
  ('22222222-0001-0001-0001-000000000002', '11111111-0001-0001-0001-000000000001',
   CURRENT_DATE - 14, 'OPD', 'Routine ANC — 28 weeks check', 84, 118, 74, 36.8, 98, 60, 158,
   'Normal ANC — 28 weeks',
   'All parameters within normal limits. GDM screening done — fasting 88 mg/dL (normal). Advised iron supplementation.',
   '{"lmp":"' || to_char(CURRENT_DATE - 28*7, 'YYYY-MM-DD') || '","edd":"' || to_char(CURRENT_DATE + 12*7, 'YYYY-MM-DD') || '","gestational_age":"28 weeks 0 days","gravida":2,"para":1,"abortion":0,"living":1,"fhs":152,"liquor":"Normal","fundal_height":28,"presentation":"Cephalic","engagement":"Not engaged","uterus_size":"28 wks"}',
   'Dr. Demo'),

  -- Kavita Patel — ANC high risk (breech + advanced age)
  ('22222222-0002-0002-0002-000000000001', '11111111-0002-0002-0002-000000000002',
   CURRENT_DATE - 21, 'OPD', 'ANC visit — 32 weeks, baby position concern', 88, 124, 80, 37.1, 97, 72, 162,
   'Breech presentation at 32 weeks — watch',
   'USG confirmed breech. Discussed ECV. Advised return in 2 weeks. BP mildly elevated — monitoring.',
   '{"lmp":"' || to_char(CURRENT_DATE - 32*7, 'YYYY-MM-DD') || '","edd":"' || to_char(CURRENT_DATE + 8*7, 'YYYY-MM-DD') || '","gestational_age":"32 weeks 0 days","gravida":1,"para":0,"abortion":0,"living":0,"fhs":138,"liquor":"Normal","fundal_height":32,"presentation":"Breech","engagement":"Not engaged","uterus_size":"32 wks"}',
   'Dr. Demo'),

  -- Meena Desai — ANC high risk (liquor reduced + G5)
  ('22222222-0003-0003-0003-000000000001', '11111111-0003-0003-0003-000000000003',
   CURRENT_DATE - 7, 'OPD', 'ANC visit — 36 weeks, reduced fetal movement', 90, 130, 86, 37.2, 97, 78, 155,
   'Reduced liquor — oligohydramnios at 36 weeks — high risk',
   'USG shows AFI 6 cm (low). CTG done — reactive. Advised hospitalisation for monitoring. G5P4A0L4.',
   '{"lmp":"' || to_char(CURRENT_DATE - 36*7, 'YYYY-MM-DD') || '","edd":"' || to_char(CURRENT_DATE + 4*7, 'YYYY-MM-DD') || '","gestational_age":"36 weeks 0 days","gravida":5,"para":4,"abortion":0,"living":4,"fhs":156,"liquor":"Reduced","fundal_height":34,"presentation":"Cephalic","engagement":"Engaged","uterus_size":"36 wks"}',
   'Dr. Demo'),

  -- Rima Shah — PCOS
  ('22222222-0004-0004-0004-000000000001', '11111111-0004-0004-0004-000000000004',
   CURRENT_DATE - 45, 'OPD', 'Irregular periods, weight gain, facial hair', 76, 112, 72, 37.0, 99, 68, 160,
   'Polycystic Ovarian Syndrome (PCOS)',
   'USG shows bilateral polycystic ovaries. LH:FSH ratio elevated. BMI 26.6. Started on Metformin + lifestyle modification.',
   '{}', 'Dr. Demo'),
  ('22222222-0004-0004-0004-000000000002', '11111111-0004-0004-0004-000000000004',
   CURRENT_DATE - 5, 'OPD', 'PCOS follow-up — periods improving', 74, 110, 70, 36.9, 99, 66, 160,
   'PCOS — responding to treatment',
   'Patient reports more regular cycles. Weight reduced by 2 kg. Continue Metformin.',
   '{}', 'Dr. Demo'),

  -- Sunita Joshi — High risk ANC (age 35 + GDM)
  ('22222222-0005-0005-0005-000000000001', '11111111-0005-0005-0005-000000000005',
   CURRENT_DATE - 30, 'OPD', 'ANC visit — GDM screening positive', 86, 126, 82, 37.0, 98, 74, 157,
   'Gestational Diabetes Mellitus (GDM) — 30 weeks',
   'OGTT positive — fasting 102, post-load 168. Started on dietary modification + Metformin. Referred to diabetologist.',
   '{"lmp":"' || to_char(CURRENT_DATE - 30*7, 'YYYY-MM-DD') || '","edd":"' || to_char(CURRENT_DATE + 10*7, 'YYYY-MM-DD') || '","gestational_age":"30 weeks 0 days","gravida":3,"para":2,"abortion":0,"living":2,"fhs":144,"liquor":"Normal","fundal_height":30,"presentation":"Cephalic","engagement":"Not engaged","uterus_size":"30 wks"}',
   'Dr. Demo'),

  -- Anita Mehta — Fibroid
  ('22222222-0006-0006-0006-000000000001', '11111111-0006-0006-0006-000000000006',
   CURRENT_DATE - 20, 'OPD', 'Heavy menstrual bleeding for 4 months', 80, 108, 68, 36.8, 99, 55, 161,
   'Uterine Fibroids — intramural — multiple',
   'USG shows 3 intramural fibroids, largest 4.2 cm. Hb 9.1 g/dL. Started on Tranexamic acid + Iron. Discussing myomectomy.',
   '{"uterus_size":"10 wks","per_abdomen":"Uterus palpable just above pubic symphysis, firm, irregular"}',
   'Dr. Demo'),

  -- Pooja Trivedi — Dysmenorrhea / Endometriosis query
  ('22222222-0007-0007-0007-000000000001', '11111111-0007-0007-0007-000000000007',
   CURRENT_DATE - 10, 'OPD', 'Severe pain during periods, painful intercourse', 78, 106, 66, 36.7, 100, 52, 163,
   'Suspected Endometriosis — for laparoscopy',
   'Dysmenorrhea NRS 8/10. Restricted uterine mobility. CA-125 elevated. Referred for diagnostic laparoscopy.',
   '{"uterus_size":"Normal","cervix_pv":"Firm","per_vaginum":"Uterosacral nodularity felt, retroverted uterus"}',
   'Dr. Demo'),

  -- Lalita Verma — Menopause
  ('22222222-0008-0008-0008-000000000001', '11111111-0008-0008-0008-000000000008',
   CURRENT_DATE - 35, 'OPD', 'Hot flashes, mood swings, last period 14 months ago', 72, 132, 84, 36.6, 99, 62, 152,
   'Menopause — Vasomotor symptoms',
   'FSH 68 mIU/mL (elevated), Estradiol low. BMD — mild osteopenia. Discussed HRT options. Started on low-dose estrogen.',
   '{}', 'Dr. Demo'),

  -- Rekha Nair — Recurrent pregnancy loss
  ('22222222-0009-0009-0009-000000000001', '11111111-0009-0009-0009-000000000009',
   CURRENT_DATE - 50, 'OPD', 'History of 3 miscarriages, planning pregnancy', 74, 114, 74, 36.9, 99, 57, 159,
   'Recurrent Pregnancy Loss — 3 consecutive miscarriages',
   'Thrombophilia workup: Antiphospholipid antibodies positive. Started on low-dose aspirin + heparin for next pregnancy. Genetic counselling advised.',
   '{}', 'Dr. Demo'),

  -- Deepa Agarwal — Infertility
  ('22222222-0010-0010-0010-000000000001', '11111111-0010-0010-0010-000000000010',
   CURRENT_DATE - 25, 'OPD', 'Not conceiving for 2 years', 76, 110, 70, 36.8, 99, 61, 162,
   'Primary Infertility — PCOS + husband factor',
   'AFC 18 bilateral. Husband SA: low motility 22%. Started on Letrozole stimulation protocol.',
   '{}', 'Dr. Demo'),

  -- Varsha Solanki — Overdue follow-up
  ('22222222-0011-0011-0011-000000000001', '11111111-0011-0011-0011-000000000011',
   CURRENT_DATE - 45, 'OPD', 'Cervical erosion found on PAP smear', 80, 116, 74, 36.9, 99, 58, 158,
   'Cervical Ectropion — for colposcopy',
   'PAP smear: LSIL. Colposcopy scheduled. Patient to return with biopsy report.',
   '{}', 'Dr. Demo'),

  -- Hetal Panchal — Overdue follow-up
  ('22222222-0012-0012-0012-000000000001', '11111111-0012-0012-0012-000000000012',
   CURRENT_DATE - 40, 'OPD', 'White discharge, itching for 2 weeks', 78, 108, 68, 36.7, 100, 53, 160,
   'Vaginal Candidiasis',
   'Discharge: white, curdy. KOH positive for pseudohyphae. Prescribed Fluconazole + clotrimazole cream.',
   '{"cervix_speculum":"Congested","discharge_speculum":"White curdy discharge"}',
   'Dr. Demo'),

  -- Bhavna Rana — Post-op (IPD)
  ('22222222-0013-0013-0013-000000000001', '11111111-0013-0013-0013-000000000013',
   CURRENT_DATE - 5, 'OPD', 'Post LSCS day 3 — wound inspection', 82, 118, 74, 37.2, 98, 65, 160,
   'Post LSCS — Day 3 — wound healthy',
   'Live birth NVD Male 3.2 kg APGAR 8/9. Wound healthy. Bleeding minimal. Uterus well contracted. Advised breastfeeding.',
   '{"lmp":"' || to_char(CURRENT_DATE - 40*7, 'YYYY-MM-DD') || '","edd":"' || to_char(CURRENT_DATE, 'YYYY-MM-DD') || '","gestational_age":"39 weeks 6 days","gravida":2,"para":1,"delivery_type":"LSCS"}',
   'Dr. Demo'),

  -- Sejal Chauhan — IPD fibroid op
  ('22222222-0014-0014-0014-000000000001', '11111111-0014-0014-0014-000000000014',
   CURRENT_DATE - 3, 'OPD', 'Admitted for myomectomy — Day 1 post-op', 84, 122, 78, 37.4, 97, 70, 157,
   'Post Abdominal Myomectomy — Day 1',
   'Surgery uneventful. 2 fibroids removed (4.2 cm + 2.8 cm). Drain in situ. Hb 10.2 post-op. IVF running.',
   '{}', 'Dr. Demo'),

  -- Nisha Yadav — Ectopic risk
  ('22222222-0015-0015-0015-000000000001', '11111111-0015-0015-0015-000000000015',
   CURRENT_DATE - 2, 'OPD', 'Missed period + lower abdominal pain + positive UPT', 96, 98, 60, 37.3, 98, 52, 162,
   'Suspected Ectopic Pregnancy — for USG',
   'β-hCG 2800 mIU/mL. USG: empty uterus, no adnexal mass seen clearly. Repeat USG + β-hCG in 48h. Patient admitted for monitoring.',
   '{}', 'Dr. Demo')

ON CONFLICT (id) DO NOTHING;

-- ── 3. PRESCRIPTIONS ─────────────────────────────────────────
INSERT INTO prescriptions (id, encounter_id, patient_id, medications, advice, dietary_advice, reports_needed, follow_up_date)
VALUES
  -- Priya Sharma — ANC meds (latest visit)
  ('33333333-0001-0001-0001-000000000001',
   '22222222-0001-0001-0001-000000000002',
   '11111111-0001-0001-0001-000000000001',
   '[{"drug":"Folic Acid 5mg","dose":"5mg","route":"Oral","frequency":"Once daily","duration":"Till delivery","instructions":"Take with food"},{"drug":"Iron + Folic Acid","dose":"1 tablet","route":"Oral","frequency":"Once daily","duration":"Till delivery","instructions":"Take after meals"},{"drug":"Calcium 500mg","dose":"500mg","route":"Oral","frequency":"Twice daily","duration":"Till delivery","instructions":"Avoid with iron tablets"}]',
   'Rest adequately. Avoid heavy lifting. Report immediately if reduced fetal movement, bleeding, or headache.',
   'High protein diet. Include leafy vegetables, dals, eggs. Avoid raw papaya and pineapple.',
   'CBC, Blood sugar fasting, USG for fetal growth at 32 weeks',
   CURRENT_DATE + 14),

  -- Rima Shah — PCOS latest
  ('33333333-0004-0004-0004-000000000001',
   '22222222-0004-0004-0004-000000000002',
   '11111111-0004-0004-0004-000000000004',
   '[{"drug":"Metformin 500mg","dose":"500mg","route":"Oral","frequency":"Twice daily","duration":"3 months","instructions":"Take after meals"},{"drug":"Vitamin D3 60000 IU","dose":"1 sachet","route":"Oral","frequency":"Once weekly","duration":"8 weeks","instructions":"Take with milk"}]',
   'Exercise 30 minutes daily. Weight loss target 5% of body weight. Reduce refined carbohydrates.',
   'Low glycaemic index diet. Avoid sugar, maida, processed foods. Increase protein intake.',
   'Fasting insulin, Testosterone, LH/FSH ratio after 3 months',
   CURRENT_DATE + 30),

  -- Varsha Solanki — OVERDUE follow-up (set in past)
  ('33333333-0011-0011-0011-000000000001',
   '22222222-0011-0011-0011-000000000001',
   '11111111-0011-0011-0011-000000000011',
   '[{"drug":"Folic Acid 5mg","dose":"5mg","route":"Oral","frequency":"Once daily","duration":"1 month","instructions":"Take with food"}]',
   'Get colposcopy done. Do not delay. Avoid intercourse till review.',
   'Regular meals. No specific restriction.',
   'Colposcopy + cervical biopsy report',
   CURRENT_DATE - 20),   -- OVERDUE by 20 days

  -- Hetal Panchal — OVERDUE follow-up
  ('33333333-0012-0012-0012-000000000001',
   '22222222-0012-0012-0012-000000000001',
   '11111111-0012-0012-0012-000000000012',
   '[{"drug":"Fluconazole 150mg","dose":"150mg","route":"Oral","frequency":"Once","duration":"Single dose","instructions":"Take after food"},{"drug":"Clotrimazole 1% cream","dose":"Apply BD","route":"Topical","frequency":"Twice daily","duration":"7 days","instructions":"Apply externally"}]',
   'Maintain hygiene. Wear cotton undergarments. Avoid synthetic clothing.',
   'Avoid sugar-rich foods. Increase probiotics (curd).',
   'Repeat HVS culture if not resolved',
   CURRENT_DATE - 10),   -- OVERDUE by 10 days

  -- Anita Mehta — Fibroid
  ('33333333-0006-0006-0006-000000000001',
   '22222222-0006-0006-0006-000000000001',
   '11111111-0006-0006-0006-000000000006',
   '[{"drug":"Tranexamic acid 500mg","dose":"500mg","route":"Oral","frequency":"Thrice daily","duration":"5 days (during periods)","instructions":"Take during heavy flow only"},{"drug":"Iron + Folic Acid","dose":"1 tablet","route":"Oral","frequency":"Once daily","duration":"3 months","instructions":"Take after meals to build Hb"}]',
   'Track menstrual cycle and bleeding days. Consult if soaking more than 1 pad/hour.',
   'Iron-rich diet: spinach, beetroot, jaggery, meat. Vitamin C with meals to enhance iron absorption.',
   'Repeat USG pelvis after 3 months. CBC for Hb check.',
   CURRENT_DATE + 45),

  -- Nisha Yadav — Ectopic
  ('33333333-0015-0015-0015-000000000001',
   '22222222-0015-0015-0015-000000000001',
   '11111111-0015-0015-0015-000000000015',
   '[{"drug":"Paracetamol 500mg","dose":"500mg","route":"Oral","frequency":"SOS / As needed","duration":"As needed","instructions":"Take only if pain is severe"}]',
   'Complete bed rest. No strenuous activity. Report IMMEDIATELY if severe abdominal pain, shoulder pain, or fainting.',
   'Light diet. Stay hydrated.',
   'Repeat β-hCG in 48 hours. Repeat USG pelvis',
   CURRENT_DATE + 2)

ON CONFLICT (id) DO NOTHING;

-- ── 4. BEDS — admit some patients ────────────────────────────
-- Admit Bhavna Rana (post-LSCS) to LW-01
UPDATE beds SET
  status             = 'occupied',
  patient_id         = '11111111-0013-0013-0013-000000000013',
  patient_name       = 'Bhavna Rana',
  admission_date     = CURRENT_DATE - 5,
  expected_discharge = CURRENT_DATE + 2,
  updated_at         = NOW()
WHERE bed_number = 'LW-01' AND status = 'available';

-- Admit Sejal Chauhan (post-myomectomy) to LW-02
UPDATE beds SET
  status             = 'occupied',
  patient_id         = '11111111-0014-0014-0014-000000000014',
  patient_name       = 'Sejal Chauhan',
  admission_date     = CURRENT_DATE - 3,
  expected_discharge = CURRENT_DATE + 4,
  updated_at         = NOW()
WHERE bed_number = 'LW-02' AND status = 'available';

-- Admit Nisha Yadav (ectopic monitoring) to GW-01
UPDATE beds SET
  status             = 'occupied',
  patient_id         = '11111111-0015-0015-0015-000000000015',
  patient_name       = 'Nisha Yadav',
  admission_date     = CURRENT_DATE - 2,
  expected_discharge = CURRENT_DATE + 3,
  updated_at         = NOW()
WHERE bed_number = 'GW-01' AND status = 'available';

-- Mark one bed as cleaning, one as reserved (for realistic board view)
UPDATE beds SET status = 'cleaning', updated_at = NOW()  WHERE bed_number = 'GW-03' AND status = 'available';
UPDATE beds SET status = 'reserved', updated_at = NOW()  WHERE bed_number = 'GW-04' AND status = 'available';

COMMIT;

SELECT 'Demo data seeded successfully ✓' AS result,
  (SELECT count(*) FROM patients) AS total_patients,
  (SELECT count(*) FROM encounters) AS total_encounters,
  (SELECT count(*) FROM prescriptions) AS total_prescriptions,
  (SELECT count(*) FROM beds WHERE status = 'occupied') AS occupied_beds;
