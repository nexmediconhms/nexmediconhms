/**
 * src/lib/clinical-scores.ts
 *
 * Clinical scoring tools for gynaecological practice:
 * - MRS (Menopause Rating Scale)
 * - Bishop Score (cervical readiness)
 * - Ferriman-Gallwey Score (hirsutism)
 *
 * NON-BREAKING: New file.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ScoreResult {
  scoreType: string;
  scoreName: string;
  totalScore: number;
  maxScore: number;
  severity: string;
  subscores: Record<string, number>;
  interpretation: string;
  recommendations: string[];
}

// ─── MRS (Menopause Rating Scale) ───────────────────────────────────────────
// Validated 11-item scale. Each 0-4 (none to very severe).
// Subscales: Somatic (items 1-3,11), Psychological (4-7), Urogenital (8-10)

export interface MrsItem {
  id: number;
  subscale: 'somatic' | 'psychological' | 'urogenital';
  label_en: string;
  label_hi: string;
  description_en: string;
}

export const MRS_ITEMS: MrsItem[] = [
  { id: 1,  subscale: 'somatic',       label_en: 'Hot flushes / sweating', label_hi: 'गर्मी की लहरें / पसीना', description_en: 'Rising heat, sweating episodes' },
  { id: 2,  subscale: 'somatic',       label_en: 'Heart discomfort', label_hi: 'दिल में बेचैनी', description_en: 'Palpitations, chest tightness, breathlessness' },
  { id: 3,  subscale: 'somatic',       label_en: 'Sleep problems', label_hi: 'नींद की समस्या', description_en: 'Difficulty falling asleep, waking early' },
  { id: 4,  subscale: 'psychological', label_en: 'Depressive mood', label_hi: 'उदास मन', description_en: 'Feeling down, sad, on the verge of tears' },
  { id: 5,  subscale: 'psychological', label_en: 'Irritability', label_hi: 'चिड़चिड़ापन', description_en: 'Nervousness, inner tension, aggression' },
  { id: 6,  subscale: 'psychological', label_en: 'Anxiety', label_hi: 'चिंता', description_en: 'Inner restlessness, panic feelings' },
  { id: 7,  subscale: 'psychological', label_en: 'Physical and mental exhaustion', label_hi: 'शारीरिक और मानसिक थकान', description_en: 'Decreased performance, poor concentration, forgetfulness' },
  { id: 8,  subscale: 'urogenital',    label_en: 'Sexual problems', label_hi: 'यौन समस्याएं', description_en: 'Change in desire, activity, satisfaction' },
  { id: 9,  subscale: 'urogenital',    label_en: 'Bladder problems', label_hi: 'मूत्राशय की समस्या', description_en: 'Urgency, frequency, incontinence' },
  { id: 10, subscale: 'urogenital',    label_en: 'Vaginal dryness', label_hi: 'योनि में सूखापन', description_en: 'Sensation of dryness, burning, difficulty with intercourse' },
  { id: 11, subscale: 'somatic',       label_en: 'Joint and muscular pain', label_hi: 'जोड़ और मांसपेशियों में दर्द', description_en: 'Joint pain, rheumatic complaints' },
];

export const MRS_SEVERITY_LABELS = [
  { value: 0, label: 'None', label_hi: 'कोई नहीं' },
  { value: 1, label: 'Mild', label_hi: 'हल्का' },
  { value: 2, label: 'Moderate', label_hi: 'मध्यम' },
  { value: 3, label: 'Severe', label_hi: 'गंभीर' },
  { value: 4, label: 'Very Severe', label_hi: 'बहुत गंभीर' },
];

export function calculateMRS(scores: Record<number, number>): ScoreResult {
  let somatic = 0, psychological = 0, urogenital = 0;

  for (const item of MRS_ITEMS) {
    const val = scores[item.id] || 0;
    switch (item.subscale) {
      case 'somatic': somatic += val; break;
      case 'psychological': psychological += val; break;
      case 'urogenital': urogenital += val; break;
    }
  }

  const total = somatic + psychological + urogenital;

  // Severity interpretation
  let severity: string;
  let interpretation: string;
  const recommendations: string[] = [];

  if (total <= 4) {
    severity = 'none_minimal';
    interpretation = 'No or minimal menopausal symptoms. No treatment needed.';
  } else if (total <= 8) {
    severity = 'mild';
    interpretation = 'Mild menopausal symptoms. Lifestyle modifications recommended.';
    recommendations.push('Regular exercise (30 min daily)', 'Balanced diet rich in calcium', 'Stress management / yoga');
  } else if (total <= 16) {
    severity = 'moderate';
    interpretation = 'Moderate menopausal symptoms. Consider treatment if affecting quality of life.';
    recommendations.push('Lifestyle modifications', 'Consider phytoestrogens or HRT', 'Calcium + Vitamin D supplementation', 'Regular bone density monitoring');
  } else {
    severity = 'severe';
    interpretation = 'Severe menopausal symptoms significantly impacting quality of life. Treatment recommended.';
    recommendations.push('Discuss HRT options (risks vs benefits)', 'Specialist referral if needed', 'Psychological support if mood symptoms predominant', 'Bone density assessment (DEXA)', 'Annual cardiovascular risk assessment');
  }

  // Subscale-specific recommendations
  if (urogenital >= 6) {
    recommendations.push('Consider vaginal estrogen therapy for urogenital symptoms');
  }
  if (psychological >= 8) {
    recommendations.push('Consider psychological counseling or antidepressant if MRS psychological subscale high');
  }

  return {
    scoreType: 'mrs',
    scoreName: 'Menopause Rating Scale (MRS)',
    totalScore: total,
    maxScore: 44,
    severity,
    subscores: { somatic, psychological, urogenital },
    interpretation,
    recommendations,
  };
}


// ─── Bishop Score (Cervical Readiness) ──────────────────────────────────────

export interface BishopItem {
  parameter: string;
  options: Array<{ value: number; label: string }>;
}

export const BISHOP_ITEMS: BishopItem[] = [
  {
    parameter: 'Cervical Dilation',
    options: [
      { value: 0, label: 'Closed' },
      { value: 1, label: '1-2 cm' },
      { value: 2, label: '3-4 cm' },
      { value: 3, label: '≥ 5 cm' },
    ],
  },
  {
    parameter: 'Cervical Effacement',
    options: [
      { value: 0, label: '0-30%' },
      { value: 1, label: '40-50%' },
      { value: 2, label: '60-70%' },
      { value: 3, label: '≥ 80%' },
    ],
  },
  {
    parameter: 'Fetal Station',
    options: [
      { value: 0, label: '-3' },
      { value: 1, label: '-2' },
      { value: 2, label: '-1 / 0' },
      { value: 3, label: '+1 / +2' },
    ],
  },
  {
    parameter: 'Cervical Consistency',
    options: [
      { value: 0, label: 'Firm' },
      { value: 1, label: 'Medium' },
      { value: 2, label: 'Soft' },
    ],
  },
  {
    parameter: 'Cervical Position',
    options: [
      { value: 0, label: 'Posterior' },
      { value: 1, label: 'Mid' },
      { value: 2, label: 'Anterior' },
    ],
  },
];

export function calculateBishopScore(scores: Record<string, number>): ScoreResult {
  const total = Object.values(scores).reduce((sum, v) => sum + v, 0);

  let severity: string;
  let interpretation: string;
  const recommendations: string[] = [];

  if (total <= 5) {
    severity = 'unfavorable';
    interpretation = 'Cervix unfavorable for induction. Consider cervical ripening.';
    recommendations.push('Consider prostaglandin (PGE2) for cervical ripening', 'Mechanical methods (Foley catheter) may be used', 'Reassess after ripening');
  } else if (total <= 7) {
    severity = 'intermediate';
    interpretation = 'Cervix moderately favorable. Induction may succeed.';
    recommendations.push('Oxytocin induction may be attempted', 'Amniotomy if membranes intact and head engaged');
  } else {
    severity = 'favorable';
    interpretation = 'Cervix favorable for induction. High likelihood of successful vaginal delivery.';
    recommendations.push('Proceed with induction (oxytocin/amniotomy)', 'Expected to progress well');
  }

  return {
    scoreType: 'bishop',
    scoreName: 'Bishop Score (Cervical Readiness)',
    totalScore: total,
    maxScore: 13,
    severity,
    subscores: scores,
    interpretation,
    recommendations,
  };
}


// ─── Ferriman-Gallwey Score (Hirsutism) ─────────────────────────────────────

export const FG_BODY_AREAS = [
  'Upper lip', 'Chin', 'Chest', 'Upper back', 'Lower back',
  'Upper abdomen', 'Lower abdomen', 'Upper arm', 'Thigh',
];

export function calculateFGScore(scores: Record<string, number>): ScoreResult {
  const total = Object.values(scores).reduce((sum, v) => sum + v, 0);

  let severity: string;
  let interpretation: string;
  const recommendations: string[] = [];

  if (total < 8) {
    severity = 'normal';
    interpretation = 'Normal hair growth pattern.';
  } else if (total <= 15) {
    severity = 'mild';
    interpretation = 'Mild hirsutism. May be associated with PCOS.';
    recommendations.push('Screen for PCOS (hormones, ultrasound)', 'Lifestyle modifications', 'Cosmetic measures (waxing, threading)');
  } else if (total <= 25) {
    severity = 'moderate';
    interpretation = 'Moderate hirsutism. Evaluate for hormonal cause.';
    recommendations.push('Hormonal evaluation (testosterone, DHEAS)', 'PCOS workup', 'Consider anti-androgen therapy', 'OCP may help regulate and reduce androgens');
  } else {
    severity = 'severe';
    interpretation = 'Severe hirsutism. Investigate for adrenal or ovarian cause.';
    recommendations.push('Complete androgen panel', 'Rule out adrenal pathology', 'Consider specialist referral', 'Pharmacological treatment recommended');
  }

  return {
    scoreType: 'ferriman_gallwey',
    scoreName: 'Ferriman-Gallwey Score (Hirsutism)',
    totalScore: total,
    maxScore: 36,
    severity,
    subscores: scores,
    interpretation,
    recommendations,
  };
}


// ─── Save Score to DB ───────────────────────────────────────────────────────

export async function saveScore(
  supabase: SupabaseClient,
  patientId: string,
  result: ScoreResult,
  encounterId?: string,
  scoredBy?: string
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase
      .from('clinical_scores')
      .insert({
        patient_id: patientId,
        encounter_id: encounterId,
        score_type: result.scoreType,
        score_name: result.scoreName,
        total_score: result.totalScore,
        max_score: result.maxScore,
        severity: result.severity,
        subscores: result.subscores,
        interpretation: result.interpretation,
        recommendations: result.recommendations,
        scored_by: scoredBy,
      });

    return { error: error?.message || null };
  } catch (err) {
    return { error: String(err) };
  }
}

export async function getPatientScores(
  supabase: SupabaseClient,
  patientId: string,
  scoreType?: string
): Promise<{ data: unknown[]; error: string | null }> {
  try {
    let query = supabase
      .from('clinical_scores')
      .select('*')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false });

    if (scoreType) query = query.eq('score_type', scoreType);

    const { data, error } = await query;
    if (error) return { data: [], error: error.message };
    return { data: data || [], error: null };
  } catch (err) {
    return { data: [], error: String(err) };
  }
}
