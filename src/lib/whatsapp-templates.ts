/**
 * WhatsApp Clinical Message Templates for NexMedicon HMS
 *
 * Generates pre-formatted WhatsApp messages for clinical reminders.
 * All messages are bilingual (English + Gujarati) and include hospital branding.
 *
 * Templates:
 * 1. ANC Visit Reminder
 * 2. Post-Delivery Follow-up
 * 3. Newborn Vaccination Reminder
 * 4. Lab Result Collection
 * 5. Follow-up Appointment
 * 6. Medication Reminder
 * 7. General Health Checkup
 */

import { getHospitalSettings } from './utils'
import { calculateGA } from './utils'

// ─── Types ────────────────────────────────────────────────────

export type TemplateId =
  | 'anc_reminder'
  | 'post_delivery'
  | 'vaccination'
  | 'lab_collection'
  | 'follow_up'
  | 'medication'
  | 'general_checkup'

export interface TemplateParams {
  patientName: string
  mobile: string
  // Optional context
  ga?: string              // gestational age (e.g., "28 weeks 3 days")
  edd?: string             // expected delivery date
  lmp?: string             // last menstrual period
  deliveryDate?: string    // for post-delivery reminders
  babyName?: string        // for vaccination reminders
  labTests?: string        // e.g., "CBC, Blood Sugar, Urine Routine"
  followUpDate?: string    // next appointment date
  medications?: string     // medication list
  diagnosis?: string       // current diagnosis
  doctorName?: string      // treating doctor
  customNote?: string      // any additional note
}

export interface Template {
  id: TemplateId
  label: string
  emoji: string
  description: string
  category: 'obstetric' | 'general' | 'pediatric'
  generate: (params: TemplateParams) => string
}

// ─── Helper ───────────────────────────────────────────────────

function hospitalInfo() {
  const hs = typeof window !== 'undefined' ? getHospitalSettings() : {} as any
  return {
    name: hs.hospitalName || 'NexMedicon Hospital',
    phone: hs.phone || '',
    address: hs.address || '',
    doctor: hs.doctorName || 'Doctor',
  }
}

function formatDateNice(dateStr: string): string {
  if (!dateStr) return ''
  try {
    return new Date(dateStr).toLocaleDateString('en-IN', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    })
  } catch { return dateStr }
}

// ─── Templates ────────────────────────────────────────────────

export const TEMPLATES: Template[] = [
  {
    id: 'anc_reminder',
    label: 'ANC Visit Reminder',
    emoji: '🤰',
    description: 'Remind pregnant patient about next ANC visit with GA info',
    category: 'obstetric',
    generate: (p) => {
      const h = hospitalInfo()
      const gaText = p.ga || (p.lmp ? calculateGA(p.lmp) : '')
      const eddText = p.edd ? formatDateNice(p.edd) : ''
      return `*${h.name}*\n\nNamaste ${p.patientName} ji 🙏\n\nThis is a reminder for your *ANC (Antenatal) check-up*.\n\n🤰 *Gestational Age:* ${gaText || 'Please visit for assessment'}\n${eddText ? `📅 *Expected Delivery:* ${eddText}\n` : ''}🏥 *Hospital:* ${h.name}\n📍 *Address:* ${h.address}\n\nPlease bring:\n✅ Previous reports & USG\n✅ ANC card\n✅ Urine sample (morning)\n\n${p.customNote ? `📝 *Note:* ${p.customNote}\n\n` : ''}For queries: ${h.phone}\n\n---\nકૃપા કરીને તમારી ANC (પ્રસૂતિ પૂર્વ) તપાસ માટે આવો. તમારા અગાઉના રિપોર્ટ્સ અને ANC કાર્ડ સાથે લાવો.\n\n_${h.name} — Caring for you & your baby_ 👶`
    },
  },
  {
    id: 'post_delivery',
    label: 'Post-Delivery Follow-up',
    emoji: '👶',
    description: '6-week post-delivery review reminder',
    category: 'obstetric',
    generate: (p) => {
      const h = hospitalInfo()
      const dateText = p.followUpDate ? formatDateNice(p.followUpDate) : '6 weeks after delivery'
      return `*${h.name}*\n\nNamaste ${p.patientName} ji 🙏\n\nCongratulations on your delivery! 🎉\n\nThis is a reminder for your *post-delivery follow-up visit*.\n\n📅 *Due Date:* ${dateText}\n👩‍⚕️ *Doctor:* ${p.doctorName || h.doctor}\n🏥 *Hospital:* ${h.name}\n\nThis visit is important for:\n✅ Your recovery check\n✅ Wound/stitch examination\n✅ Blood pressure & weight check\n✅ Breastfeeding guidance\n✅ Family planning counselling\n✅ Baby's health check\n\nPlease bring:\n📋 Discharge summary\n📋 Baby's vaccination card\n\n${p.customNote ? `📝 *Note:* ${p.customNote}\n\n` : ''}For queries: ${h.phone}\n\n---\nકૃપા કરીને તમારી ડિલિવરી પછીની તપાસ માટે આવો. તમારું ડિસ્ચાર્જ સમરી અને બાળકનું રસીકરણ કાર્ડ સાથે લાવો.\n\n_${h.name} — Caring for mother & baby_ 👶`
    },
  },
  {
    id: 'vaccination',
    label: 'Newborn Vaccination',
    emoji: '💉',
    description: 'Vaccination reminder for newborn baby',
    category: 'pediatric',
    generate: (p) => {
      const h = hospitalInfo()
      const dateText = p.followUpDate ? formatDateNice(p.followUpDate) : 'as per schedule'
      return `*${h.name}*\n\nNamaste ${p.patientName} ji 🙏\n\nThis is a reminder for your baby's *vaccination*.\n\n💉 *Vaccination Due:* ${dateText}\n${p.babyName ? `👶 *Baby:* ${p.babyName}\n` : ''}🏥 *Hospital:* ${h.name}\n📍 *Address:* ${h.address}\n\nPlease bring:\n✅ Baby's vaccination card\n✅ Previous vaccination records\n\n⚠️ *Important:* Do not skip vaccinations. They protect your baby from serious diseases.\n\n${p.customNote ? `📝 *Note:* ${p.customNote}\n\n` : ''}For queries: ${h.phone}\n\n---\nકૃપા કરીને તમારા બાળકના રસીકરણ માટે આવો. રસીકરણ કાર્ડ સાથે લાવો.\n\n_${h.name} — Protecting your little one_ 💉`
    },
  },
  {
    id: 'lab_collection',
    label: 'Lab Report Collection',
    emoji: '🔬',
    description: 'Remind patient to collect lab results',
    category: 'general',
    generate: (p) => {
      const h = hospitalInfo()
      return `*${h.name}*\n\nNamaste ${p.patientName} ji 🙏\n\nYour *lab reports are ready* for collection.\n\n🔬 *Tests:* ${p.labTests || 'As prescribed'}\n🏥 *Collect from:* ${h.name}\n📍 *Address:* ${h.address}\n⏰ *Timing:* 9 AM – 5 PM\n\nPlease collect your reports and bring them to your next consultation.\n\n${p.customNote ? `📝 *Note:* ${p.customNote}\n\n` : ''}For queries: ${h.phone}\n\n---\nતમારા લેબ રિપોર્ટ્સ તૈયાર છે. કૃપા કરીને એકત્ર કરો.\n\n_${h.name}_`
    },
  },
  {
    id: 'follow_up',
    label: 'Follow-up Appointment',
    emoji: '📅',
    description: 'General follow-up visit reminder',
    category: 'general',
    generate: (p) => {
      const h = hospitalInfo()
      const dateText = p.followUpDate ? formatDateNice(p.followUpDate) : 'as advised'
      return `*${h.name}*\n\nNamaste ${p.patientName} ji 🙏\n\nThis is a reminder for your *follow-up visit*.\n\n📅 *Date:* ${dateText}\n👩‍⚕️ *Doctor:* ${p.doctorName || h.doctor}\n${p.diagnosis ? `🩺 *For:* ${p.diagnosis}\n` : ''}🏥 *Hospital:* ${h.name}\n📍 *Address:* ${h.address}\n\nPlease bring:\n✅ Previous prescription\n✅ Any new reports\n✅ List of current medications\n\nPlease arrive 10 minutes early.\n\n${p.customNote ? `📝 *Note:* ${p.customNote}\n\n` : ''}For queries: ${h.phone}\n\n---\nકૃપા કરીને તમારી ફોલો-અપ મુલાકાત માટે આવો. અગાઉનું પ્રિસ્ક્રિપ્શન અને રિપોર્ટ્સ સાથે લાવો.\n\n_${h.name} — Caring for you_`
    },
  },
  {
    id: 'medication',
    label: 'Medication Reminder',
    emoji: '💊',
    description: 'Remind patient about ongoing medications',
    category: 'general',
    generate: (p) => {
      const h = hospitalInfo()
      return `*${h.name}*\n\nNamaste ${p.patientName} ji 🙏\n\nThis is a reminder about your *medications*.\n\n💊 *Current Medications:*\n${p.medications || 'As prescribed by your doctor'}\n\n⚠️ *Important:*\n• Take medicines regularly as prescribed\n• Do not skip doses\n• Complete the full course\n• Report any side effects immediately\n\n${p.customNote ? `📝 *Note:* ${p.customNote}\n\n` : ''}For queries: ${h.phone}\n\n---\nકૃપા કરીને તમારી દવાઓ નિયમિત લો. ડોઝ ન છોડો.\n\n_${h.name}_`
    },
  },
  {
    id: 'general_checkup',
    label: 'General Health Checkup',
    emoji: '🩺',
    description: 'Annual/periodic health checkup reminder',
    category: 'general',
    generate: (p) => {
      const h = hospitalInfo()
      const dateText = p.followUpDate ? formatDateNice(p.followUpDate) : ''
      return `*${h.name}*\n\nNamaste ${p.patientName} ji 🙏\n\nIt's time for your *routine health check-up*.\n\n${dateText ? `📅 *Suggested Date:* ${dateText}\n` : ''}🏥 *Hospital:* ${h.name}\n📍 *Address:* ${h.address}\n\nRegular check-ups help detect health issues early.\n\nPlease come *fasting* (empty stomach) for accurate blood test results.\n\n${p.customNote ? `📝 *Note:* ${p.customNote}\n\n` : ''}For appointment: ${h.phone}\n\n---\nતમારી નિયમિત આરોગ્ય તપાસનો સમય થયો છે. કૃપા કરીને ખાલી પેટે આવો.\n\n_${h.name} — Prevention is better than cure_`
    },
  },
]

// ─── Helper Functions ─────────────────────────────────────────

/**
 * Get a template by ID
 */
export function getTemplate(id: TemplateId): Template | undefined {
  return TEMPLATES.find(t => t.id === id)
}

/**
 * Generate a WhatsApp URL with pre-filled message
 */
export function whatsAppUrl(mobile: string, message: string): string {
  const num = mobile?.replace(/\D/g, '') || ''
  const full = num.length === 10 ? '91' + num : num
  return `https://wa.me/${full}?text=${encodeURIComponent(message)}`
}

/**
 * Get templates filtered by category
 */
export function getTemplatesByCategory(category: 'obstetric' | 'general' | 'pediatric'): Template[] {
  return TEMPLATES.filter(t => t.category === category)
}
