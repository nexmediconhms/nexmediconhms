/**
 * src/lib/patient-education.ts
 *
 * Patient education handout templates for common gynaecological conditions.
 * Bilingual (English / Hindi). Print-ready HTML generation.
 *
 * NON-BREAKING: New file.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface EducationHandout {
  code: string;
  category: string;
  title_en: string;
  title_hi: string;
  content_en: string;
  content_hi: string;
  icon: string;
}

// ─── Handout Catalog ────────────────────────────────────────────────────────

export const EDUCATION_HANDOUTS: EducationHandout[] = [
  {
    code: 'EDU-ANC-DIET',
    category: 'Pregnancy',
    icon: '🤰',
    title_en: 'Diet & Nutrition During Pregnancy',
    title_hi: 'गर्भावस्था में आहार और पोषण',
    content_en: `DIET & NUTRITION DURING PREGNANCY

FOODS TO EAT DAILY:
• Green leafy vegetables (spinach, methi, palak) — for iron and folic acid
• Milk & dairy products (curd, paneer) — 500ml milk daily for calcium
• Dals & pulses — for protein
• Seasonal fruits — banana, apple, pomegranate, guava
• Whole grains — roti, rice, oats
• Eggs, fish (if non-vegetarian) — for protein and omega-3
• Dry fruits — almonds, walnuts (handful daily)
• Plenty of water — 8-10 glasses daily

FOODS TO AVOID:
• Raw or undercooked meat, fish, eggs
• Unpasteurized milk and soft cheese
• Papaya (raw/unripe) and pineapple in first trimester
• Excessive caffeine (limit to 1 cup tea/coffee)
• Alcohol — strictly avoid
• Junk food, excess salt, excess sugar
• Raw sprouts (risk of infection)

SUPPLEMENTS:
• Folic acid — as prescribed (esp. first 3 months)
• Iron tablets — take with vitamin C (lemon water), NOT with milk/tea
• Calcium — as prescribed (usually after 12 weeks)

TIPS:
• Eat small, frequent meals (5-6 times/day)
• Don't skip breakfast
• If nausea: dry crackers/biscuits before getting up
• Weight gain: 10-12 kg total is normal`,
    content_hi: `गर्भावस्था में आहार और पोषण

प्रतिदिन खाएं:
• हरी पत्तेदार सब्जियां (पालक, मेथी) — आयरन और फोलिक एसिड के लिए
• दूध और दुग्ध उत्पाद (दही, पनीर) — कैल्शियम के लिए प्रतिदिन 500ml दूध
• दालें — प्रोटीन के लिए
• मौसमी फल — केला, सेब, अनार, अमरूद
• साबुत अनाज — रोटी, चावल
• अंडे, मछली (मांसाहारी हों तो)
• सूखे मेवे — बादाम, अखरोट (मुट्ठी भर)
• भरपूर पानी — 8-10 गिलास

परहेज करें:
• कच्चा या अधपका मांस, मछली, अंडा
• कच्चा पपीता और अनानास (पहली तिमाही में)
• अधिक चाय/कॉफी
• शराब — बिल्कुल नहीं
• जंक फूड, अधिक नमक, अधिक चीनी`,
  },
  {
    code: 'EDU-ANC-WARNING',
    category: 'Pregnancy',
    icon: '⚠️',
    title_en: 'Danger Signs in Pregnancy — When to Rush to Hospital',
    title_hi: 'गर्भावस्था में खतरे के संकेत — कब तुरंत अस्पताल जाएं',
    content_en: `DANGER SIGNS IN PREGNANCY — GO TO HOSPITAL IMMEDIATELY

RUSH TO HOSPITAL IF YOU NOTICE:

1. BLEEDING from vagina — any amount, any trimester
2. SEVERE HEADACHE that doesn't go away with rest
3. BLURRED VISION or seeing spots/flashes
4. SWELLING of face and hands (sudden)
5. SEVERE ABDOMINAL PAIN
6. HIGH FEVER (> 101°F / 38.5°C)
7. WATER LEAKING from vagina (membrane rupture)
8. BABY NOT MOVING for 12+ hours (after 28 weeks)
9. FITS / CONVULSIONS
10. VOMITING that won't stop (can't keep food/water down)

ALSO INFORM YOUR DOCTOR IF:
• Burning while urinating
• Foul-smelling discharge
• Persistent itching
• Leg pain or swelling on one side
• Rapid weight gain (> 1 kg per week)

KEEP READY:
• Hospital emergency number: ___________
• Doctor's number: ___________
• Blood group: ___________
• Transport arrangement for emergency`,
    content_hi: `गर्भावस्था में खतरे के संकेत — तुरंत अस्पताल जाएं

इनमें से कोई भी लक्षण दिखे तो तुरंत अस्पताल जाएं:

1. योनि से खून आना — कितना भी हो
2. तेज सिरदर्द जो आराम से ठीक न हो
3. धुंधला दिखना या आंखों के सामने चमक
4. चेहरे और हाथों में अचानक सूजन
5. पेट में तेज दर्द
6. तेज बुखार
7. योनि से पानी जैसा बहना
8. बच्चे की हलचल 12 घंटे से बंद
9. दौरे / बेहोशी
10. लगातार उल्टी`,
  },
  {
    code: 'EDU-PCOS',
    category: 'Hormonal',
    icon: '🔄',
    title_en: 'Understanding PCOS (Polycystic Ovarian Syndrome)',
    title_hi: 'PCOS (पॉलीसिस्टिक ओवेरियन सिंड्रोम) को समझें',
    content_en: `UNDERSTANDING PCOS

WHAT IS PCOS?
PCOS is a common hormonal condition affecting 1 in 5 women. Your ovaries produce excess male hormones (androgens), which can affect your periods, fertility, and overall health.

SYMPTOMS:
• Irregular or absent periods
• Excess facial/body hair (hirsutism)
• Acne, oily skin
• Weight gain (especially around the belly)
• Difficulty getting pregnant
• Hair thinning on the scalp
• Dark patches on skin (neck, underarms)

LIFESTYLE IS THE BEST TREATMENT:

DIET:
• Reduce refined carbs (maida, white rice, sugar, sweets)
• Eat more fiber (vegetables, whole grains, salads)
• Include protein in every meal
• Limit dairy if acne is severe
• Avoid sugary drinks and juices

EXERCISE:
• Walk 30-45 minutes daily — non-negotiable
• Any exercise you enjoy: yoga, swimming, cycling
• Weight training helps reduce insulin resistance
• Aim for at least 150 minutes/week

WEIGHT:
• Even 5-10% weight loss can restore periods
• Focus on consistency, not crash diets

MEDICATIONS (as prescribed):
• Metformin — improves insulin resistance
• OCP (birth control pills) — regulates periods
• Anti-androgens — for hair/acne
• Fertility medications — when trying to conceive

REGULAR MONITORING:
• Blood sugar check every 6 months
• Thyroid check annually
• Lipid profile annually`,
    content_hi: `PCOS को समझें

PCOS क्या है?
PCOS एक आम हार्मोनल स्थिति है जो हर 5 में से 1 महिला को प्रभावित करती है।

लक्षण:
• अनियमित या न आने वाले पीरियड्स
• चेहरे/शरीर पर अधिक बाल
• मुंहासे
• वजन बढ़ना (विशेषकर पेट के आसपास)
• गर्भधारण में कठिनाई

जीवनशैली में बदलाव सबसे अच्छा इलाज है:

आहार: मैदा, चीनी, मिठाई कम करें। सब्जियां, साबुत अनाज बढ़ाएं।
व्यायाम: रोज 30-45 मिनट चलें। सप्ताह में 150 मिनट व्यायाम।
वजन: 5-10% वजन कम करने से पीरियड्स नियमित हो सकते हैं।`,
  },
  {
    code: 'EDU-UTI',
    category: 'Infection',
    icon: '💧',
    title_en: 'Urinary Tract Infection (UTI) — Prevention & Care',
    title_hi: 'मूत्र मार्ग संक्रमण (UTI) — बचाव और देखभाल',
    content_en: `URINARY TRACT INFECTION (UTI) — PREVENTION & CARE

SYMPTOMS:
• Burning while urinating
• Frequent urge to urinate
• Cloudy or strong-smelling urine
• Lower abdominal pain
• Blood in urine (sometimes)
• Fever (if infection spreads to kidneys)

PREVENTION TIPS:
1. Drink 8-10 glasses of water daily
2. Don't hold urine — go when you feel the urge
3. Always wipe front to back after using toilet
4. Urinate after sexual intercourse
5. Wear cotton undergarments
6. Avoid tight-fitting clothes
7. Maintain hygiene during periods
8. Avoid douching or scented products in genital area

TREATMENT:
• Complete the FULL course of antibiotics as prescribed
• Even if you feel better after 2-3 days, don't stop medicines
• Drink extra water during treatment
• Cranberry juice may help (but is not a substitute for medicines)

WHEN TO CALL THE DOCTOR:
• Fever with chills
• Back pain
• Blood in urine
• Symptoms not improving after 3 days of antibiotics
• Recurrent UTIs (3+ per year)

DURING PREGNANCY:
• UTI is more common and more serious
• Must be treated promptly
• Regular urine tests as advised`,
    content_hi: `मूत्र मार्ग संक्रमण (UTI) — बचाव और देखभाल

लक्षण:
• पेशाब करते समय जलन
• बार-बार पेशाब आना
• पेट के निचले हिस्से में दर्द

बचाव:
1. रोजाना 8-10 गिलास पानी पिएं
2. पेशाब रोकें नहीं
3. शौचालय के बाद आगे से पीछे पोंछें
4. सूती अंडरगार्मेंट्स पहनें

इलाज:
• पूरी दवाई का कोर्स लें — बीच में न छोड़ें
• ज्यादा पानी पिएं`,
  },
  {
    code: 'EDU-MENOPAUSE',
    category: 'Menopause',
    icon: '🌸',
    title_en: 'Managing Menopause — What to Expect',
    title_hi: 'रजोनिवृत्ति का प्रबंधन — क्या उम्मीद करें',
    content_en: `MANAGING MENOPAUSE

WHAT IS MENOPAUSE?
Menopause means your periods have stopped permanently (no period for 12 months). It usually happens between ages 45-55. It is a NORMAL part of aging, not a disease.

COMMON SYMPTOMS:
• Hot flashes and night sweats
• Irregular periods (before menopause)
• Sleep problems
• Mood changes, irritability
• Vaginal dryness
• Joint pains
• Reduced bone density
• Weight gain

MANAGING SYMPTOMS:

HOT FLASHES:
• Wear light, layered clothing
• Keep room cool
• Avoid triggers: spicy food, hot drinks, alcohol
• Deep breathing when a flash starts

BONE HEALTH:
• Calcium-rich foods: milk, curd, ragi, sesame seeds
• Vitamin D: 15 mins morning sunlight daily
• Weight-bearing exercise: walking, stairs
• Calcium + Vitamin D supplements as prescribed
• DEXA scan for bone density if advised

HEART HEALTH:
• Regular walking/exercise
• Reduce salt, oil, and sugar
• Check BP and cholesterol annually
• Maintain healthy weight

VAGINAL HEALTH:
• Vaginal moisturizers (available OTC)
• Vaginal estrogen cream if prescribed
• Stay sexually active (with lubrication if needed)

MENTAL HEALTH:
• Stay socially active
• Yoga and meditation help
• Talk about your feelings
• Seek help if depression symptoms persist

REGULAR CHECK-UPS:
• Annual PAP smear until advised to stop
• Mammography as advised
• Blood sugar, thyroid, lipid profile annually
• Bone density scan every 2-3 years`,
    content_hi: `रजोनिवृत्ति का प्रबंधन

रजोनिवृत्ति क्या है?
रजोनिवृत्ति का अर्थ है कि आपके पीरियड्स स्थायी रूप से बंद हो गए हैं। यह 45-55 वर्ष की आयु में होती है। यह उम्र बढ़ने का सामान्य हिस्सा है।

सामान्य लक्षण:
• गर्मी की लहरें और रात को पसीना
• नींद की समस्या
• मूड में बदलाव
• योनि में सूखापन
• जोड़ों में दर्द
• हड्डियों की कमजोरी

हड्डियों की सेहत:
• कैल्शियम युक्त भोजन: दूध, दही, रागी
• विटामिन D: रोज 15 मिनट सुबह की धूप
• सैर, सीढ़ियां चढ़ना`,
  },
  {
    code: 'EDU-IUD-CARE',
    category: 'Contraception',
    icon: '🛡️',
    title_en: 'After IUD Insertion — Care Instructions',
    title_hi: 'IUD लगाने के बाद — देखभाल निर्देश',
    content_en: `AFTER IUD INSERTION — CARE INSTRUCTIONS

WHAT TO EXPECT:
• Mild cramping for 1-2 days (like period pain)
• Light spotting for a few days
• These are NORMAL and will settle

DO:
• Take prescribed pain medicine if needed
• Use sanitary pad for spotting (not tampon for first 48 hours)
• Check for IUD strings after each period (your doctor will show you how)
• Come for follow-up in 4-6 weeks

DON'T:
• No sexual intercourse for 48 hours
• No tampons for 48 hours
• No heavy lifting for 24 hours

WHEN TO CALL YOUR DOCTOR:
• Heavy bleeding (soaking a pad in 1 hour)
• Severe abdominal pain
• Fever or chills
• Foul-smelling discharge
• You can feel the hard plastic of the IUD (not just strings)
• IUD comes out
• You think you might be pregnant
• Strings feel longer or shorter than before

REMEMBER:
• Copper IUD: effective for 5-10 years
• Hormonal IUD (Mirena/LNG-IUS): 3-5 years
• You CAN get pregnant once it's removed
• It does NOT protect against STIs — use condoms if needed`,
    content_hi: `IUD लगाने के बाद — देखभाल

क्या उम्मीद करें:
• 1-2 दिन हल्का दर्द (पीरियड जैसा)
• कुछ दिन हल्का खून आना — यह सामान्य है

करें:
• दर्द की दवा लें (दी गई हो तो)
• हर पीरियड के बाद IUD के धागे चेक करें
• 4-6 हफ्ते बाद फॉलो-अप आएं

न करें:
• 48 घंटे संभोग नहीं
• 48 घंटे टैम्पोन नहीं

डॉक्टर को बुलाएं अगर:
• बहुत ज्यादा खून
• तेज पेट दर्द
• बुखार
• बदबूदार स्राव`,
  },
  {
    code: 'EDU-BREAST-SELF',
    category: 'Screening',
    icon: '🎀',
    title_en: 'Breast Self-Examination — Monthly Guide',
    title_hi: 'स्तन स्व-परीक्षण — मासिक गाइड',
    content_en: `BREAST SELF-EXAMINATION — DO IT MONTHLY

WHEN: 7-10 days after your period starts (when breasts are least tender)
After menopause: pick any fixed date each month

HOW TO EXAMINE (3 STEPS):

STEP 1 — LOOK IN THE MIRROR:
Stand with arms at sides, then raise them overhead.
Look for: change in size/shape, dimpling, puckering, redness, rash, nipple changes, skin changes (orange peel texture)

STEP 2 — FEEL WHILE STANDING:
Use your right hand to examine left breast and vice versa.
Use flat pads of 3 middle fingers (not fingertips).
Press in small circles: light pressure → medium → firm.
Cover entire breast: from collarbone to below bra line, from armpit to center of chest.
Don't forget the armpit area.

STEP 3 — FEEL WHILE LYING DOWN:
Lie down with a pillow under right shoulder.
Examine right breast with left hand.
Use same circular motion as Step 2.
Repeat on other side.

CHECK FOR:
• Any new lump or thickening
• Any change from your normal
• Nipple discharge (especially bloody)
• Skin changes

IF YOU FIND SOMETHING:
• Don't panic — 80% of lumps are NOT cancer
• See your doctor within 1-2 weeks
• Doctor will advise further tests if needed

SCREENING SCHEDULE:
• Self-exam: monthly from age 20
• Clinical exam by doctor: every 1-3 years (age 20-39)
• Mammography: as advised by doctor (usually from age 40)`,
    content_hi: `स्तन स्व-परीक्षण — हर महीने करें

कब: पीरियड शुरू होने के 7-10 दिन बाद

कैसे करें:
1. आईने में देखें — दोनों हाथ ऊपर उठाकर
2. खड़े होकर जांचें — 3 उंगलियों से गोल-गोल दबाएं
3. लेटकर जांचें — तकिया कंधे के नीचे रखें

ध्यान दें:
• कोई नई गांठ
• त्वचा में बदलाव
• निपल से स्राव

कुछ मिले तो:
• घबराएं नहीं — 80% गांठें कैंसर नहीं होतीं
• 1-2 हफ्ते में डॉक्टर को दिखाएं`,
  },
];

// ─── Generate Printable HTML ────────────────────────────────────────────────

export function generateHandoutHtml(
  handout: EducationHandout,
  language: 'en' | 'hi',
  clinicName?: string,
  doctorName?: string
): string {
  const title = language === 'hi' ? handout.title_hi : handout.title_en;
  const content = language === 'hi' ? handout.content_hi : handout.content_en;
  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });

  return `<!DOCTYPE html>
<html lang="${language}">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; max-width: 700px; margin: 0 auto; padding: 20px; font-size: 14px; line-height: 1.7; color: #222; }
  .header { text-align: center; border-bottom: 2px solid #4f46e5; padding-bottom: 10px; margin-bottom: 15px; }
  .header h1 { margin: 0; font-size: 13px; color: #4f46e5; }
  .title { text-align: center; font-size: 20px; font-weight: bold; margin: 15px 0; color: #1e293b; }
  .icon { font-size: 40px; text-align: center; margin: 10px 0; }
  .content { white-space: pre-line; }
  .footer { margin-top: 30px; border-top: 1px solid #ddd; padding-top: 10px; font-size: 11px; color: #888; text-align: center; }
  @media print { body { padding: 10mm; } }
</style>
</head>
<body>
  <div class="header">
    <h1>${clinicName || 'Your Clinic'} ${doctorName ? '— ' + doctorName : ''}</h1>
  </div>
  <div class="icon">${handout.icon}</div>
  <div class="title">${title}</div>
  <div class="content">${content}</div>
  <div class="footer">
    Patient Education Material — ${today}<br/>
    This information is for general guidance. Always follow your doctor's specific advice.
  </div>
</body>
</html>`;
}

// ─── Log Education Given ────────────────────────────────────────────────────

export async function logEducationGiven(
  supabase: SupabaseClient,
  data: {
    patient_id: string;
    encounter_id?: string;
    handout_code: string;
    handout_title: string;
    language?: string;
    delivery_method?: string;
    given_by?: string;
  }
): Promise<{ error: string | null }> {
  try {
    const { error } = await supabase
      .from('patient_education_logs')
      .insert(data);
    return { error: error?.message || null };
  } catch (err) {
    return { error: String(err) };
  }
}

/**
 * Get handout by code.
 */
export function getHandout(code: string): EducationHandout | undefined {
  return EDUCATION_HANDOUTS.find(h => h.code === code);
}

/**
 * Get handouts by category.
 */
export function getHandoutsByCategory(category: string): EducationHandout[] {
  return EDUCATION_HANDOUTS.filter(h => h.category === category);
}
