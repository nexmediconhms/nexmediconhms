-- ═══════════════════════════════════════════════════════════════════════
-- CONSENT FORMS & TEMPLATES
-- For Indian Gynaecologist IPD
-- ═══════════════════════════════════════════════════════════════════════
-- Run in Supabase SQL Editor. Safe to run multiple times.

-- ── 1. CONSENT TEMPLATES ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.consent_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  code            TEXT UNIQUE,
  category        TEXT,           -- Surgery / Delivery / Procedure / General / Anesthesia
  body_text       TEXT NOT NULL,  -- The consent text with {{placeholders}}
  risks_text      TEXT,           -- Risks and complications section
  is_active       BOOLEAN DEFAULT true,
  sort_order      INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.consent_templates ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'consent_templates' AND policyname = 'consent_templates_auth') THEN
    CREATE POLICY consent_templates_auth ON public.consent_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── 2. CONSENT RECORDS (signed by patient/attendant) ─────────────────

CREATE TABLE IF NOT EXISTS public.consent_records (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id         UUID REFERENCES public.consent_templates(id),
  ipd_admission_id    UUID,
  patient_id          UUID,

  -- Consent details
  consent_type        TEXT NOT NULL,     -- General / Surgical / Anesthesia / Delivery / Blood Transfusion / High Risk
  procedure_name      TEXT,
  consent_language    TEXT DEFAULT 'English',

  -- Rendered text (snapshot at time of signing)
  rendered_body       TEXT,
  rendered_risks      TEXT,

  -- Signatory details
  patient_name        TEXT,
  patient_relation    TEXT,              -- Self / Husband / Father / Mother / Son / Daughter / Other
  signatory_name      TEXT,              -- Person who signed (may be attendant)
  signatory_relation  TEXT,
  signatory_mobile    TEXT,
  signatory_id_proof  TEXT,              -- Aadhar / PAN / Voter ID number

  -- Doctor
  doctor_name         TEXT,
  doctor_explained    BOOLEAN DEFAULT true,
  witness_name        TEXT,

  -- Status
  status              TEXT DEFAULT 'signed',  -- signed / revoked / expired
  signed_at           TIMESTAMPTZ,
  revoked_at          TIMESTAMPTZ,
  revoked_reason      TEXT,

  -- Metadata
  created_by          TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.consent_records ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'consent_records' AND policyname = 'consent_records_auth') THEN
    CREATE POLICY consent_records_auth ON public.consent_records FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_consent_records_admission ON public.consent_records (ipd_admission_id);
CREATE INDEX IF NOT EXISTS idx_consent_records_patient ON public.consent_records (patient_id);

-- ── 3. SEED CONSENT TEMPLATES ────────────────────────────────────────

DELETE FROM public.consent_templates WHERE code IN (
  'CON-GENERAL', 'CON-LSCS', 'CON-HYST', 'CON-LAP', 'CON-DC',
  'CON-DELIVERY', 'CON-ANESTHESIA', 'CON-BLOOD', 'CON-HIGHRISK'
);

INSERT INTO public.consent_templates (name, code, category, body_text, risks_text, sort_order) VALUES

('General Consent for Treatment', 'CON-GENERAL', 'General',
'I, {{signatory_name}} ({{signatory_relation}} of patient {{patient_name}}), hereby give my consent for admission and treatment at {{hospital_name}}.

I understand that the medical team will perform necessary examinations, investigations, and treatment procedures as deemed appropriate for my/the patient''s condition.

I have been informed about the general nature of the treatment, the expected benefits, and the potential risks involved. I have had the opportunity to ask questions, and my questions have been answered to my satisfaction.

I authorize the medical team to administer medications, perform routine investigations (blood tests, urine tests, imaging), and provide nursing care as required during the stay.

I understand that I have the right to revoke this consent at any time.',
'General risks of hospitalization include infection, adverse drug reactions, falls, and complications related to the underlying condition.',
1),

('Consent for LSCS (Caesarean Section)', 'CON-LSCS', 'Surgery',
'I, {{signatory_name}} ({{signatory_relation}} of patient {{patient_name}}), hereby give my informed consent for Lower Segment Caesarean Section (LSCS) to be performed by Dr. {{doctor_name}} and team at {{hospital_name}}.

The indication for surgery has been explained to me as: {{procedure_indication}}.

The nature of the procedure, including the type of incision (abdominal and uterine), the use of anesthesia (spinal/epidural/general), and the expected outcome have been explained to me in a language I understand ({{consent_language}}).

I understand that the surgery involves delivery of the baby through an incision in the abdomen and uterus, and that the surgical team will take all reasonable precautions.

I consent to blood transfusion if deemed necessary during or after surgery.
I consent to any additional procedure that may become necessary during the course of surgery for the safety of the mother and/or baby.',
'Risks and complications of LSCS include but are not limited to:
• Bleeding (hemorrhage) requiring blood transfusion
• Infection of the wound, uterus, or urinary tract
• Injury to adjacent organs (bladder, bowel, ureter)
• Blood clots (DVT/PE)
• Adverse reaction to anesthesia
• Need for hysterectomy in life-threatening bleeding
• Neonatal complications including respiratory distress
• Wound dehiscence or delayed healing
• Adhesion formation affecting future pregnancies
• Risk of uterine rupture in subsequent pregnancies
• Rare risk of maternal mortality',
2),

('Consent for Hysterectomy', 'CON-HYST', 'Surgery',
'I, {{signatory_name}} ({{signatory_relation}} of patient {{patient_name}}), hereby give my informed consent for Hysterectomy (removal of uterus) to be performed by Dr. {{doctor_name}} and team at {{hospital_name}}.

Type of hysterectomy planned: {{procedure_name}}.
Indication: {{procedure_indication}}.

I understand that this procedure involves the surgical removal of the uterus, and that after this procedure I will no longer be able to conceive or bear children, and menstruation will permanently stop.

I have been counselled about alternative treatment options and have chosen to proceed with surgery.

I consent to removal of ovaries and/or fallopian tubes if found diseased during surgery.
I consent to blood transfusion if necessary.',
'Risks and complications include but are not limited to:
• Bleeding requiring blood transfusion
• Infection (wound, pelvic, urinary)
• Injury to bladder, ureter, or bowel
• Blood clots (DVT/PE)
• Vaginal vault prolapse
• Adverse reaction to anesthesia
• Conversion from vaginal/laparoscopic to open surgery
• Fistula formation (vesico-vaginal or recto-vaginal)
• Early menopause (if ovaries removed)
• Rare risk of mortality',
3),

('Consent for Laparoscopic Surgery', 'CON-LAP', 'Surgery',
'I, {{signatory_name}} ({{signatory_relation}} of patient {{patient_name}}), hereby give my informed consent for Laparoscopic Surgery to be performed by Dr. {{doctor_name}} and team.

Planned procedure: {{procedure_name}}.
Indication: {{procedure_indication}}.

I understand that laparoscopy involves insertion of a camera and instruments through small incisions in the abdomen under general anesthesia.

I understand that in some cases, conversion to open surgery (laparotomy) may be necessary for patient safety, and I consent to such conversion if required.',
'Risks include:
• Injury to bowel, bladder, blood vessels, or ureter during trocar insertion
• Gas embolism from CO2 insufflation
• Subcutaneous emphysema, shoulder pain
• Conversion to open surgery
• Port-site hernia or infection
• Bleeding, infection, DVT/PE
• Adverse reaction to general anesthesia',
4),

('Consent for D&C / Evacuation', 'CON-DC', 'Procedure',
'I, {{signatory_name}} ({{signatory_relation}} of patient {{patient_name}}), hereby give my informed consent for Dilatation and Curettage (D&C) / Suction Evacuation to be performed by Dr. {{doctor_name}}.

Indication: {{procedure_indication}}.

I understand that this procedure involves dilating the cervix and removing tissue from the uterus under anesthesia.',
'Risks include:
• Uterine perforation
• Cervical injury or incompetence
• Incomplete evacuation requiring repeat procedure
• Infection (endometritis)
• Bleeding
• Asherman syndrome (intrauterine adhesions)
• Adverse reaction to anesthesia',
5),

('Consent for Normal Vaginal Delivery', 'CON-DELIVERY', 'Delivery',
'I, {{signatory_name}} ({{signatory_relation}} of patient {{patient_name}}), hereby give my consent for management of labour and vaginal delivery at {{hospital_name}} under the care of Dr. {{doctor_name}}.

I understand that labour is a natural process but carries certain risks. I consent to:
• Continuous or intermittent fetal monitoring
• Augmentation of labour with oxytocin if indicated
• Episiotomy if necessary for safe delivery
• Instrumental delivery (vacuum/forceps) if indicated
• Emergency caesarean section if natural delivery poses risk to mother or baby
• Administration of medications including pain relief
• Active management of third stage of labour',
'Risks of vaginal delivery include:
• Perineal tears (1st to 4th degree)
• Postpartum hemorrhage
• Shoulder dystocia
• Cord prolapse
• Birth asphyxia / neonatal distress
• Uterine inversion or rupture (rare)
• Retained placenta
• Need for emergency LSCS',
6),

('Consent for Anesthesia', 'CON-ANESTHESIA', 'Anesthesia',
'I, {{signatory_name}} ({{signatory_relation}} of patient {{patient_name}}), hereby give my informed consent for administration of anesthesia by the anesthesiologist for the planned procedure: {{procedure_name}}.

Type of anesthesia planned: {{anesthesia_type}}.

I have disclosed my complete medical history, current medications, allergies, and previous anesthesia experiences to the anesthesiologist. I have followed the fasting (NPO) instructions given to me.

I understand that the type of anesthesia may need to be changed during the procedure based on clinical requirements.',
'Risks of anesthesia include:
• Nausea, vomiting, sore throat (GA)
• Headache (post-spinal/epidural)
• Hypotension, bradycardia
• Allergic/anaphylactic reaction
• Nerve injury (regional anesthesia)
• Failed intubation / aspiration (GA)
• Epidural hematoma or abscess (rare)
• Awareness during surgery (rare)
• Cardiac arrest (extremely rare)',
7),

('Consent for Blood Transfusion', 'CON-BLOOD', 'Procedure',
'I, {{signatory_name}} ({{signatory_relation}} of patient {{patient_name}}), hereby give my informed consent for blood and/or blood product transfusion at {{hospital_name}}.

I understand that blood transfusion may be necessary during or after surgery / delivery / treatment. The blood will be cross-matched and tested as per guidelines.

I have been informed about the risks associated with blood transfusion and the risks of NOT receiving blood when indicated.',
'Risks of blood transfusion include:
• Allergic/febrile transfusion reaction
• Hemolytic reaction (ABO incompatibility)
• Transfusion-related infections (HIV, Hepatitis B/C — risk is extremely low with screening)
• TRALI (Transfusion-Related Acute Lung Injury)
• Volume overload
• Iron overload (with multiple transfusions)',
8),

('Consent for High-Risk Pregnancy Management', 'CON-HIGHRISK', 'Delivery',
'I, {{signatory_name}} ({{signatory_relation}} of patient {{patient_name}}), hereby acknowledge that my/the patient''s pregnancy has been identified as HIGH RISK due to: {{procedure_indication}}.

I understand that high-risk pregnancies carry increased risk of complications for both mother and baby. I consent to:
• Increased monitoring and more frequent hospital visits
• Additional investigations as recommended
• Hospitalization for observation when indicated
• Emergency interventions including caesarean section
• NICU admission for the baby if required
• Blood transfusion if necessary

I have been counselled about the specific risks related to my/the patient''s condition and the planned management approach.',
'Specific risks depend on the high-risk factor and may include:
• Preterm delivery
• Intrauterine growth restriction
• Pre-eclampsia / eclampsia
• Gestational diabetes complications
• Placental abnormalities
• Fetal distress
• Maternal organ dysfunction
• Need for intensive care (mother and/or baby)',
9);
