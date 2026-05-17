'use client'
/**
 * src/app/marketing/page.tsx
 * 
 * Marketing & Branding Tools — No domain/email needed
 * 
 * Features:
 * 1. QR Code Generator (for reception, posters, cards)
 * 2. WhatsApp Marketing Templates
 * 3. Patient Referral System
 * 4. Google Review Link Generator
 * 5. Social Media Templates
 * 6. Digital Business Card
 */

import { useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import {
  QrCode, MessageCircle, Users, Star,
  Share2, CreditCard, Copy, Check,
  Download, ExternalLink, Smartphone,
  Megaphone, Gift, Heart, ArrowRight,
} from 'lucide-react'

// ═══ TAB SYSTEM ══════════════════════════════════════════════

type Tab = 'qr' | 'whatsapp' | 'referral' | 'review' | 'social' | 'card'

const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: 'qr', label: 'QR Codes', icon: QrCode },
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { id: 'referral', label: 'Referrals', icon: Gift },
  { id: 'review', label: 'Reviews', icon: Star },
  { id: 'social', label: 'Social', icon: Share2 },
  { id: 'card', label: 'Digital Card', icon: CreditCard },
]

export default function MarketingPage() {
  const [activeTab, setActiveTab] = useState<Tab>('qr')

  return (
    <AppShell>
      <div className="p-4 sm:p-6 max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-purple-600" />
            Marketing & Growth Tools
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Grow your clinic without expensive agencies. No domain or email required.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-6 overflow-x-auto">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                activeTab === tab.id
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'qr' && <QRCodesTab />}
        {activeTab === 'whatsapp' && <WhatsAppTab />}
        {activeTab === 'referral' && <ReferralTab />}
        {activeTab === 'review' && <ReviewTab />}
        {activeTab === 'social' && <SocialTab />}
        {activeTab === 'card' && <DigitalCardTab />}
      </div>
    </AppShell>
  )
}



// ═══ QR CODES TAB ════════════════════════════════════════════

function QRCodesTab() {
  const [copied, setCopied] = useState('')
  const [clinicPhone, setClinicPhone] = useState('')
  const [clinicName, setClinicName] = useState('')
  const [upiId, setUpiId] = useState('')

  const qrTypes = [
    {
      id: 'appointment',
      title: 'Appointment Booking QR',
      desc: 'Patients scan to book appointments via WhatsApp',
      template: `https://wa.me/${clinicPhone || '919876543210'}?text=Hi%2C%20I%20want%20to%20book%20an%20appointment%20at%20${encodeURIComponent(clinicName || 'the clinic')}`,
    },
    {
      id: 'feedback',
      title: 'Feedback QR',
      desc: 'Post-visit feedback collection',
      template: `https://wa.me/${clinicPhone || '919876543210'}?text=Feedback%20for%20my%20visit%20today%3A%20`,
    },
    {
      id: 'payment',
      title: 'UPI Payment QR',
      desc: 'For reception desk payment',
      template: `upi://pay?pa=${upiId || 'clinic@upi'}&pn=${encodeURIComponent(clinicName || 'Clinic')}&cu=INR`,
    },
    {
      id: 'review',
      title: 'Google Review QR',
      desc: 'Happy patients scan to leave a review',
      template: 'https://g.page/r/YOUR_PLACE_ID/review',
    },
  ]

  async function generateQR(text: string) {
    try {
      const res = await fetch('/api/generate-qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      if (res.ok) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'clinic-qr.png'
        a.click()
      }
    } catch {
      // Fallback: copy URL
      navigator.clipboard.writeText(text)
      setCopied('url')
      setTimeout(() => setCopied(''), 2000)
    }
  }

  return (
    <div className="space-y-6">
      {/* Configuration */}
      <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
        <h3 className="text-sm font-bold text-purple-800 mb-3">Quick Setup (one-time)</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-[10px] font-bold text-purple-600 uppercase">Clinic Name</label>
            <input
              type="text"
              value={clinicName}
              onChange={e => setClinicName(e.target.value)}
              placeholder="Your Clinic Name"
              className="input mt-1"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-purple-600 uppercase">WhatsApp Number</label>
            <input
              type="text"
              value={clinicPhone}
              onChange={e => setClinicPhone(e.target.value)}
              placeholder="919876543210"
              className="input mt-1"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-purple-600 uppercase">UPI ID</label>
            <input
              type="text"
              value={upiId}
              onChange={e => setUpiId(e.target.value)}
              placeholder="clinic@upi"
              className="input mt-1"
            />
          </div>
        </div>
      </div>

      {/* QR Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {qrTypes.map(qr => (
          <div key={qr.id} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h4 className="text-sm font-bold text-gray-900">{qr.title}</h4>
                <p className="text-xs text-gray-500">{qr.desc}</p>
              </div>
              <QrCode className="w-8 h-8 text-gray-200" />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => generateQR(qr.template)}
                className="flex-1 flex items-center justify-center gap-1.5 bg-gray-900 text-white text-xs font-bold py-2 rounded-lg hover:bg-gray-800"
              >
                <Download className="w-3 h-3" /> Generate QR
              </button>
              <button
                onClick={() => { navigator.clipboard.writeText(qr.template); setCopied(qr.id); setTimeout(() => setCopied(''), 2000) }}
                className="flex items-center justify-center gap-1 bg-gray-100 text-gray-700 text-xs font-bold px-3 py-2 rounded-lg hover:bg-gray-200"
              >
                {copied === qr.id ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Print Instructions */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
        <h3 className="text-sm font-bold text-gray-700 mb-2">Where to Place QR Codes</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-gray-600">
          <div className="flex items-center gap-1.5"><Check className="w-3 h-3 text-green-500" /> Reception desk</div>
          <div className="flex items-center gap-1.5"><Check className="w-3 h-3 text-green-500" /> Waiting area wall</div>
          <div className="flex items-center gap-1.5"><Check className="w-3 h-3 text-green-500" /> Prescription printout</div>
          <div className="flex items-center gap-1.5"><Check className="w-3 h-3 text-green-500" /> Visiting card</div>
        </div>
      </div>
    </div>
  )
}



// ═══ WHATSAPP MARKETING TAB ══════════════════════════════════

function WhatsAppTab() {
  const [copied, setCopied] = useState('')

  const templates = [
    {
      id: 'appointment-confirm',
      title: 'Appointment Confirmation',
      category: 'Transactional',
      message: `🏥 *Appointment Confirmed*\n\nDear {patient_name},\nYour appointment is confirmed:\n📅 Date: {date}\n⏰ Time: {time}\n👨‍⚕️ Doctor: {doctor_name}\n\nPlease arrive 10 minutes early.\nBring previous prescriptions if any.\n\nFor reschedule, reply to this message.`,
    },
    {
      id: 'follow-up-reminder',
      title: 'Follow-up Reminder',
      category: 'Re-engagement',
      message: `Hi {patient_name} 👋\n\nThis is a reminder that your follow-up visit is due.\n\n📅 Scheduled: {follow_up_date}\n👨‍⚕️ Doctor: {doctor_name}\n\nWould you like to:\n1️⃣ Confirm this date\n2️⃣ Reschedule\n3️⃣ Cancel\n\nReply with the number.\n\n_Your health is our priority_ 💚`,
    },
    {
      id: 'birthday-wish',
      title: 'Birthday Wishes',
      category: 'Engagement',
      message: `🎂 *Happy Birthday, {patient_name}!*\n\nWishing you a year of good health and happiness! 🌟\n\nAs a birthday gift from us, enjoy *10% off* on your next consultation this month.\n\nBook now: {booking_link}\n\n_With love, {clinic_name}_ 💝`,
    },
    {
      id: 'health-tip',
      title: 'Weekly Health Tip',
      category: 'Engagement',
      message: `💡 *Health Tip of the Week*\n\n{tip_content}\n\n👨‍⚕️ _Recommended by {doctor_name}_\n\nFor personalized advice, book a consultation:\n📱 {clinic_phone}\n\n_Stay healthy!_ 🌿`,
    },
    {
      id: 'new-service',
      title: 'New Service Announcement',
      category: 'Marketing',
      message: `🆕 *New at {clinic_name}!*\n\n{service_description}\n\n✅ Benefits:\n• {benefit_1}\n• {benefit_2}\n• {benefit_3}\n\n📅 Available from: {start_date}\n💰 Introductory price: ₹{price}\n\nBook now: {booking_link}\n\n_Limited slots available!_`,
    },
    {
      id: 'payment-reminder',
      title: 'Payment Reminder',
      category: 'Collections',
      message: `Hi {patient_name},\n\nThis is a gentle reminder about your pending payment:\n\n💳 Amount: ₹{amount}\n📋 Bill #: {bill_number}\n📅 Date: {bill_date}\n\nPay now via UPI: {upi_link}\n\nIf already paid, please ignore this message.\n\n_Thank you! {clinic_name}_`,
    },
  ]

  function copyTemplate(msg: string, id: string) {
    navigator.clipboard.writeText(msg)
    setCopied(id)
    setTimeout(() => setCopied(''), 2000)
  }

  return (
    <div className="space-y-4">
      <div className="bg-green-50 border border-green-200 rounded-xl p-4">
        <h3 className="text-sm font-bold text-green-800 mb-1">WhatsApp Marketing — No API Needed</h3>
        <p className="text-xs text-green-600">
          Copy templates, personalize, and send via WhatsApp Business. 
          No Twilio, no API costs. Works from your phone directly.
        </p>
      </div>

      <div className="space-y-3">
        {templates.map(t => (
          <div key={t.id} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h4 className="text-sm font-bold text-gray-900">{t.title}</h4>
                <span className="text-[10px] font-medium bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                  {t.category}
                </span>
              </div>
              <button
                onClick={() => copyTemplate(t.message, t.id)}
                className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${
                  copied === t.id
                    ? 'bg-green-100 text-green-700'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {copied === t.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copied === t.id ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <pre className="text-xs text-gray-600 bg-gray-50 border border-gray-100 rounded-lg p-3 whitespace-pre-wrap font-sans overflow-x-auto max-h-32">
              {t.message}
            </pre>
          </div>
        ))}
      </div>
    </div>
  )
}

// ═══ REFERRAL SYSTEM TAB ═════════════════════════════════════

function ReferralTab() {
  const [referralCode] = useState(() => 'REF-' + Math.random().toString(36).substring(2, 8).toUpperCase())

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-br from-purple-600 to-indigo-700 rounded-2xl p-6 text-white">
        <h3 className="text-lg font-bold mb-2">Patient Referral Program</h3>
        <p className="text-sm text-purple-200 mb-4">
          Turn happy patients into your best marketing channel.
          Every referred patient = ₹100 discount for both.
        </p>
        <div className="bg-white/10 rounded-xl p-4">
          <div className="text-xs text-purple-200 mb-1">Your Clinic Referral Code</div>
          <div className="text-2xl font-mono font-bold">{referralCode}</div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="text-sm font-bold text-gray-900 mb-4">How It Works</h3>
        <div className="space-y-4">
          {[
            { step: '1', title: 'Patient Completes Visit', desc: 'After a successful consultation, staff gives referral card' },
            { step: '2', title: 'Patient Refers Friend', desc: 'Friend mentions referral code at reception during registration' },
            { step: '3', title: 'Both Get Reward', desc: 'Original patient gets ₹100 off next visit. New patient gets ₹50 off' },
            { step: '4', title: 'Track & Grow', desc: 'System tracks all referrals. Top referrers get bonus rewards' },
          ].map(s => (
            <div key={s.step} className="flex gap-3">
              <div className="w-7 h-7 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                {s.step}
              </div>
              <div>
                <div className="text-sm font-bold text-gray-900">{s.title}</div>
                <div className="text-xs text-gray-500">{s.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
        <h3 className="text-sm font-bold text-amber-800 mb-2">Referral Card Message (for printing)</h3>
        <pre className="text-xs text-amber-700 bg-white/50 rounded-lg p-3 whitespace-pre-wrap">
{`🏥 I trust ${'{clinic_name}'} for my health!

Mention code: ${referralCode}
Get ₹50 off your first visit!

📱 Book: ${'{clinic_phone}'}
📍 ${'{clinic_address}'}`}
        </pre>
      </div>
    </div>
  )
}



// ═══ GOOGLE REVIEW TAB ═══════════════════════════════════════

function ReviewTab() {
  const [placeId, setPlaceId] = useState('')
  const [copied, setCopied] = useState(false)

  const reviewLink = placeId
    ? `https://search.google.com/local/writereview?placeid=${placeId}`
    : 'https://g.page/r/YOUR_PLACE_ID/review'

  return (
    <div className="space-y-6">
      <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
        <h3 className="text-sm font-bold text-yellow-800 mb-1">Google Reviews = Free Marketing</h3>
        <p className="text-xs text-yellow-600">
          Every 5-star review increases your clinic visibility on Google Maps by 15%.
          More reviews = More patients finding you organically.
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="text-sm font-bold text-gray-900 mb-3">Setup Your Review Link</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-bold text-gray-600">Google Place ID</label>
            <input
              type="text"
              value={placeId}
              onChange={e => setPlaceId(e.target.value)}
              placeholder="e.g., ChIJ..."
              className="input mt-1"
            />
            <p className="text-[10px] text-gray-400 mt-1">
              Find your Place ID at: developers.google.com/maps/documentation/places/web-service/place-id
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { navigator.clipboard.writeText(reviewLink); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
              className="btn-primary flex items-center gap-1.5"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied!' : 'Copy Review Link'}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="text-sm font-bold text-gray-900 mb-3">When to Ask for Reviews</h3>
        <div className="space-y-2 text-xs text-gray-600">
          {[
            '✅ After a successful delivery (highest satisfaction moment)',
            '✅ After patient completes full treatment course',
            '✅ When patient specifically thanks the doctor',
            '✅ After 3+ visits (loyal patients review more)',
            '❌ Never during the visit itself (feels pressured)',
            '❌ Never when patient had a complaint or issue',
          ].map((item, i) => (
            <div key={i} className="flex items-center gap-2">{item}</div>
          ))}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="text-sm font-bold text-gray-900 mb-2">WhatsApp Review Request</h3>
        <pre className="text-xs text-gray-600 bg-gray-50 rounded-lg p-3 whitespace-pre-wrap">
{`Hi {patient_name} 🙏

Thank you for trusting us with your care!

If you had a good experience, would you mind leaving a quick review? It helps other patients find us.

⭐ Leave review: ${reviewLink}

It takes just 30 seconds and means the world to our team!

_Thank you, {clinic_name}_ 💚`}
        </pre>
      </div>
    </div>
  )
}

// ═══ SOCIAL MEDIA TAB ════════════════════════════════════════

function SocialTab() {
  const [copied, setCopied] = useState('')

  const posts = [
    {
      id: 'health-awareness',
      title: 'Health Awareness Post',
      platform: 'Instagram / Facebook',
      caption: `🏥 Did you know?\n\n{health_fact}\n\nRegular check-ups can prevent 70% of serious health issues.\n\n📅 Book your health screening today!\n📱 Call: {clinic_phone}\n\n#HealthFirst #PreventiveCare #WomensHealth #{clinic_city}Doctor`,
    },
    {
      id: 'milestone',
      title: 'Clinic Milestone',
      platform: 'All platforms',
      caption: `🎉 Celebrating {number}+ happy patients!\n\nThank you for trusting us with your health journey. Every patient is family to us. 💝\n\n⭐ {star_count} Google reviews\n👶 {delivery_count}+ safe deliveries\n🏥 {years} years of service\n\n#Milestone #Grateful #Healthcare #{clinic_city}`,
    },
    {
      id: 'doctor-intro',
      title: 'Doctor Introduction',
      platform: 'Instagram / LinkedIn',
      caption: `Meet Dr. {doctor_name} 👨‍⚕️\n\n🎓 {qualifications}\n📋 {experience} years of experience\n🏥 Specializes in: {specialty}\n\n"My mission is to provide compassionate, evidence-based care to every patient."\n\n📅 Book consultation: {booking_link}\n\n#MeetOurDoctor #Healthcare #{specialty}`,
    },
    {
      id: 'patient-edu',
      title: 'Patient Education',
      platform: 'Instagram Stories',
      caption: `📚 *{topic}*\n\nSlide 1: The Problem\n{problem_statement}\n\nSlide 2: Warning Signs\n⚠️ {sign_1}\n⚠️ {sign_2}\n⚠️ {sign_3}\n\nSlide 3: What To Do\n✅ {action}\n\nSlide 4: Book a Consultation\n📱 {clinic_phone}\n\n#HealthEducation #Awareness`,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
        <h3 className="text-sm font-bold text-indigo-800 mb-1">Social Media Templates</h3>
        <p className="text-xs text-indigo-600">
          Ready-to-use captions for Instagram, Facebook, and LinkedIn.
          Replace {'{variables}'} with your details and post!
        </p>
      </div>

      {posts.map(post => (
        <div key={post.id} className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h4 className="text-sm font-bold text-gray-900">{post.title}</h4>
              <span className="text-[10px] font-medium bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">
                {post.platform}
              </span>
            </div>
            <button
              onClick={() => { navigator.clipboard.writeText(post.caption); setCopied(post.id); setTimeout(() => setCopied(''), 2000) }}
              className={`flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-lg ${
                copied === post.id ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {copied === post.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied === post.id ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <pre className="text-xs text-gray-600 bg-gray-50 border border-gray-100 rounded-lg p-3 whitespace-pre-wrap font-sans max-h-28 overflow-y-auto">
            {post.caption}
          </pre>
        </div>
      ))}
    </div>
  )
}

// ═══ DIGITAL BUSINESS CARD TAB ═══════════════════════════════

function DigitalCardTab() {
  const [cardData, setCardData] = useState({
    doctorName: '',
    qualification: '',
    specialty: '',
    clinicName: '',
    phone: '',
    address: '',
    timing: '',
  })

  return (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="text-sm font-bold text-gray-900 mb-4">Create Digital Business Card</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-bold text-gray-500 uppercase">Doctor Name</label>
            <input type="text" className="input mt-1" placeholder="Dr. Priya Sharma"
              value={cardData.doctorName} onChange={e => setCardData(d => ({ ...d, doctorName: e.target.value }))} />
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-500 uppercase">Qualification</label>
            <input type="text" className="input mt-1" placeholder="MBBS, MD (OBG)"
              value={cardData.qualification} onChange={e => setCardData(d => ({ ...d, qualification: e.target.value }))} />
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-500 uppercase">Specialty</label>
            <input type="text" className="input mt-1" placeholder="Gynecology & Obstetrics"
              value={cardData.specialty} onChange={e => setCardData(d => ({ ...d, specialty: e.target.value }))} />
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-500 uppercase">Clinic Name</label>
            <input type="text" className="input mt-1" placeholder="NexMedicon Clinic"
              value={cardData.clinicName} onChange={e => setCardData(d => ({ ...d, clinicName: e.target.value }))} />
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-500 uppercase">Phone</label>
            <input type="text" className="input mt-1" placeholder="+91 98765 43210"
              value={cardData.phone} onChange={e => setCardData(d => ({ ...d, phone: e.target.value }))} />
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-500 uppercase">Timing</label>
            <input type="text" className="input mt-1" placeholder="Mon-Sat, 10 AM - 7 PM"
              value={cardData.timing} onChange={e => setCardData(d => ({ ...d, timing: e.target.value }))} />
          </div>
          <div className="sm:col-span-2">
            <label className="text-[10px] font-bold text-gray-500 uppercase">Address</label>
            <input type="text" className="input mt-1" placeholder="123 Hospital Road, City"
              value={cardData.address} onChange={e => setCardData(d => ({ ...d, address: e.target.value }))} />
          </div>
        </div>
      </div>

      {/* Card Preview */}
      <div className="bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 rounded-2xl p-6 text-white shadow-2xl max-w-sm mx-auto">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold">{cardData.doctorName || 'Dr. Name'}</h3>
            <p className="text-xs text-gray-400">{cardData.qualification || 'Qualification'}</p>
            <p className="text-xs text-emerald-400 font-medium mt-1">{cardData.specialty || 'Specialty'}</p>
          </div>
          <div className="w-10 h-10 bg-emerald-500 rounded-full flex items-center justify-center">
            <Heart className="w-5 h-5 text-white" />
          </div>
        </div>
        <div className="border-t border-gray-700 pt-3 space-y-1.5">
          <p className="text-xs text-gray-300">{cardData.clinicName || 'Clinic Name'}</p>
          <p className="text-xs text-gray-400">{cardData.address || 'Address'}</p>
          <p className="text-xs text-gray-400">📱 {cardData.phone || 'Phone'}</p>
          <p className="text-xs text-gray-400">🕐 {cardData.timing || 'Timing'}</p>
        </div>
      </div>

      <div className="text-center">
        <p className="text-xs text-gray-500">
          Share this card as a screenshot on WhatsApp, or generate a QR code that opens it.
        </p>
      </div>
    </div>
  )
}
