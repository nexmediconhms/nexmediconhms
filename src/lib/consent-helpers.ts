/**
 * src/lib/consent-helpers.ts
 *
 * Consent management for OPD and IPD.
 * Includes templates for Indian gynaecological practice,
 * digital signature handling, and CRUD operations.
 *
 * NON-BREAKING: New file. Does not affect existing IPD consent page.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ConsentInput {
  patient_id: string;
  encounter_id?: string;
  admission_id?: string;
  consent_type: string;
  consent_title: string;
  consent_body: string;
  consent_template_id?: string;
  language?: string;
  patient_signature?: string;      // base64 data URL
  guardian_name?: string;
  guardian_relation?: string;
  guardian_signature?: string;     // base64 data URL
  witness_name?: string;
  witness_signature?: string;     // base64 data URL
  doctor_id?: string;
  doctor_name?: string;
  created_by?: string;
  metadata?: Record<string, unknown>;
}

export interface Consent extends ConsentInput {
  id: string;
  status: string;
  signed_at: string | null;
  revoked_at: string | null;
  revocation_reason: string | null;
  ip_address: string | null;
  pdf_path: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Consent Type Constants ─────────────────────────────────────────────────

export const CONSENT_TYPES = {
  GENERAL_EXAMINATION: 'general_examination',
  PROCEDURE_EXAMINATION: 'procedure_examination',
  PROCEDURE_BIOPSY: 'procedure_biopsy',
  PROCEDURE_CONTRACEPTION: 'procedure_contraception',
  PROCEDURE_TREATMENT: 'procedure_treatment',
  PROCEDURE_SURGERY: 'procedure_surgery',
  PROCEDURE_INVASIVE: 'procedure_invasive',
  ANESTHESIA: 'anesthesia',
  SURGERY_MAJOR: 'surgery_major',
  BLOOD_TRANSFUSION: 'blood_transfusion',
  HIV_TESTING: 'hiv_testing',
  PHOTOGRAPHY: 'photography',
  RESEARCH: 'research',
  DISCHARGE_LAMA: 'discharge_lama',
  HIGH_RISK_PREGNANCY: 'high_risk_pregnancy',
} as const;

// ─── Consent Templates ─────────────────────────────────────────────────────
// Pre-built templates for common gynaecological consents in India.

export interface ConsentTemplate {
  id: string;
  type: string;
  title_en: string;
  title_hi: string;
  body_en: string;
  body_hi: string;
  requiresGuardian: boolean;
  requiresWitness: boolean;
}

export const CONSENT_TEMPLATES: ConsentTemplate[] = [
  {
    id: 'tmpl-general-exam',
    type: CONSENT_TYPES.GENERAL_EXAMINATION,
    title_en: 'Consent for General & Gynaecological Examination',
    title_hi: 'सामान्य एवं स्त्री रोग परीक्षा के लिए सहमति',
    body_en: `I, the undersigned patient, hereby give my consent to undergo a general physical examination and gynaecological examination (including per speculum and per vaginal examination) by the treating doctor and their authorized team.

I understand that:
• The examination is necessary for diagnosis and treatment planning
• A female attendant will be present during the examination
• I may ask questions or withdraw consent at any point
• All findings will be kept confidential as per medical ethics

I have been informed about the nature and purpose of the examination in a language I understand.`,
    body_hi: `मैं, अधोहस्ताक्षरी रोगी, इसके द्वारा उपचार करने वाले डॉक्टर और उनकी अधिकृत टीम द्वारा सामान्य शारीरिक परीक्षा और स्त्री रोग संबंधी परीक्षा (पर स्पेकुलम और पर वेजाइनल परीक्षा सहित) से गुजरने की अपनी सहमति देती हूं।

मैं समझती हूं कि:
• निदान और उपचार योजना के लिए यह परीक्षा आवश्यक है
• परीक्षा के दौरान एक महिला परिचारक उपस्थित रहेगी
• मैं किसी भी समय प्रश्न पूछ सकती हूं या सहमति वापस ले सकती हूं
• सभी निष्कर्ष चिकित्सा नैतिकता के अनुसार गोपनीय रखे जाएंगे`,
    requiresGuardian: false,
    requiresWitness: true,
  },
  {
    id: 'tmpl-iud',
    type: CONSENT_TYPES.PROCEDURE_CONTRACEPTION,
    title_en: 'Consent for Intrauterine Device (IUD) Insertion / Removal',
    title_hi: 'अंतर्गर्भाशयी उपकरण (IUD) लगाने / निकालने के लिए सहमति',
    body_en: `I, the undersigned, hereby give informed consent for insertion / removal of an Intrauterine Device (IUD).

I have been informed about:
1. The nature and purpose of the procedure
2. Alternative contraceptive methods available
3. Expected benefits and effectiveness rate
4. Possible risks and complications including:
   - Pain or cramping during and after insertion
   - Irregular bleeding or spotting
   - Perforation of the uterus (rare)
   - Expulsion of the device
   - Infection (pelvic inflammatory disease)
   - Ectopic pregnancy (rare)
   - Failure of contraception (< 1%)
5. The need for follow-up visits
6. That I can have the device removed at any time

I confirm that I am not pregnant and have disclosed my complete medical history. I have had the opportunity to ask questions and all my doubts have been clarified.`,
    body_hi: `मैं, अधोहस्ताक्षरी, अंतर्गर्भाशयी उपकरण (IUD) लगाने / निकालने के लिए सूचित सहमति देती हूं।

मुझे निम्नलिखित के बारे में सूचित किया गया है:
1. प्रक्रिया की प्रकृति और उद्देश्य
2. उपलब्ध वैकल्पिक गर्भनिरोधक विधियां
3. अपेक्षित लाभ और प्रभावशीलता दर
4. संभावित जोखिम और जटिलताएं`,
    requiresGuardian: false,
    requiresWitness: true,
  },
  {
    id: 'tmpl-biopsy',
    type: CONSENT_TYPES.PROCEDURE_BIOPSY,
    title_en: 'Consent for Biopsy Procedure',
    title_hi: 'बायोप्सी प्रक्रिया के लिए सहमति',
    body_en: `I, the undersigned, hereby give informed consent for the biopsy procedure as explained to me by the treating doctor.

Procedure: ___________________

I have been informed about:
1. The reason for the biopsy and its diagnostic importance
2. The nature of the procedure and how it will be performed
3. Type of anesthesia to be used (if any)
4. Possible risks including:
   - Pain, bleeding, and discomfort
   - Infection at the biopsy site
   - Need for further procedures based on results
5. That the tissue sample will be sent for histopathological examination
6. Expected time for results
7. That alternative diagnostic methods were discussed

I consent to the collection and examination of tissue specimens. I understand the results will guide further treatment decisions.`,
    body_hi: `मैं, अधोहस्ताक्षरी, उपचार करने वाले डॉक्टर द्वारा मुझे समझाई गई बायोप्सी प्रक्रिया के लिए सूचित सहमति देती हूं।`,
    requiresGuardian: false,
    requiresWitness: true,
  },
  {
    id: 'tmpl-high-risk',
    type: CONSENT_TYPES.HIGH_RISK_PREGNANCY,
    title_en: 'High Risk Pregnancy - Informed Consent & Acknowledgement',
    title_hi: 'उच्च जोखिम गर्भावस्था - सूचित सहमति और स्वीकृति',
    body_en: `I, the undersigned, acknowledge that my pregnancy has been classified as HIGH RISK due to:
___________________

I have been informed about:
1. The specific risks associated with my condition
2. The need for more frequent monitoring and visits
3. Possible complications for myself and the baby
4. The possibility of early delivery or emergency intervention
5. The need for delivery at a facility with NICU support
6. Warning signs that require immediate medical attention
7. Recommended diet, activity restrictions, and medications

I understand that despite best medical care, complications may arise. I agree to comply with the advised follow-up schedule and medical recommendations. I will contact the hospital immediately if I experience any warning signs.

Risk Factors: ___________________
Monitoring Plan: ___________________`,
    body_hi: `मैं, अधोहस्ताक्षरी, स्वीकार करती हूं कि मेरी गर्भावस्था को उच्च जोखिम के रूप में वर्गीकृत किया गया है।`,
    requiresGuardian: true,
    requiresWitness: true,
  },
  {
    id: 'tmpl-surgery-minor',
    type: CONSENT_TYPES.PROCEDURE_SURGERY,
    title_en: 'Consent for Minor Surgical Procedure',
    title_hi: 'लघु शल्य प्रक्रिया के लिए सहमति',
    body_en: `I, the undersigned, hereby give informed consent for the following minor surgical procedure:

Procedure: ___________________
Surgeon: Dr. ___________________

I have been informed about:
1. The diagnosis and indication for the procedure
2. The nature and extent of the procedure
3. Type of anesthesia to be administered
4. Expected benefits and outcome
5. Potential risks and complications including:
   - Bleeding, pain, infection
   - Damage to adjacent structures
   - Need for further surgery
   - Scarring
6. Alternative treatment options
7. Consequences of not undergoing the procedure

I confirm I have disclosed my complete medical history, allergies, and current medications. I have had adequate time to consider and ask questions. I consent to the procedure and any additional measures deemed necessary during the procedure.`,
    body_hi: `मैं, अधोहस्ताक्षरी, निम्नलिखित लघु शल्य प्रक्रिया के लिए सूचित सहमति देती हूं।`,
    requiresGuardian: false,
    requiresWitness: true,
  },
];

// ─── CRUD Functions ─────────────────────────────────────────────────────────

export async function createConsent(
  supabase: SupabaseClient,
  input: ConsentInput
): Promise<{ data: Consent | null; error: string | null }> {
  try {
    const isSigned = !!input.patient_signature || !!input.guardian_signature;

    const { data, error } = await supabase
      .from('consents')
      .insert({
        ...input,
        status: isSigned ? 'signed' : 'pending',
        signed_at: isSigned ? new Date().toISOString() : null,
        metadata: input.metadata || {},
      })
      .select('*')
      .single();

    if (error) return { data: null, error: error.message };
    return { data: data as Consent, error: null };
  } catch (err) {
    return { data: null, error: String(err) };
  }
}

export async function signConsent(
  supabase: SupabaseClient,
  consentId: string,
  signatures: {
    patient_signature?: string;
    guardian_name?: string;
    guardian_relation?: string;
    guardian_signature?: string;
    witness_name?: string;
    witness_signature?: string;
  }
): Promise<{ data: Consent | null; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('consents')
      .update({
        ...signatures,
        status: 'signed',
        signed_at: new Date().toISOString(),
      })
      .eq('id', consentId)
      .select('*')
      .single();

    if (error) return { data: null, error: error.message };
    return { data: data as Consent, error: null };
  } catch (err) {
    return { data: null, error: String(err) };
  }
}

export async function revokeConsent(
  supabase: SupabaseClient,
  consentId: string,
  reason: string
): Promise<{ data: Consent | null; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('consents')
      .update({
        status: 'revoked',
        revoked_at: new Date().toISOString(),
        revocation_reason: reason,
      })
      .eq('id', consentId)
      .select('*')
      .single();

    if (error) return { data: null, error: error.message };
    return { data: data as Consent, error: null };
  } catch (err) {
    return { data: null, error: String(err) };
  }
}

export async function getEncounterConsents(
  supabase: SupabaseClient,
  encounterId: string
): Promise<{ data: Consent[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('consents')
      .select('*')
      .eq('encounter_id', encounterId)
      .order('created_at', { ascending: false });

    if (error) return { data: [], error: error.message };
    return { data: (data || []) as Consent[], error: null };
  } catch (err) {
    return { data: [], error: String(err) };
  }
}

export async function getPatientConsents(
  supabase: SupabaseClient,
  patientId: string,
  limit = 50
): Promise<{ data: Consent[]; error: string | null }> {
  try {
    const { data, error } = await supabase
      .from('consents')
      .select('*')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) return { data: [], error: error.message };
    return { data: (data || []) as Consent[], error: null };
  } catch (err) {
    return { data: [], error: String(err) };
  }
}

/**
 * Get template by id or type.
 */
export function getConsentTemplate(
  idOrType: string,
  language: 'en' | 'hi' = 'en'
): { title: string; body: string; template: ConsentTemplate } | null {
  const tmpl = CONSENT_TEMPLATES.find(
    t => t.id === idOrType || t.type === idOrType
  );
  if (!tmpl) return null;

  return {
    title: language === 'hi' ? tmpl.title_hi : tmpl.title_en,
    body: language === 'hi' ? tmpl.body_hi : tmpl.body_en,
    template: tmpl,
  };
}
