'use client'
/**
 * src/app/presentation/page.tsx
 * 
 * Interactive Presentation / Pitch Deck for NexMedicon
 * - Dark gradient theme (NOT blue/white) 
 * - Positions as a Clinic Revenue Growth Platform (not just HMS)
 * - Compares with traditional/old HMS solutions
 * - Covers all features in detail
 * - Professional design that doesn't look AI-generated
 */

import { useState, useEffect, useCallback } from 'react'
import {
  ChevronLeft, ChevronRight, Play, Pause,
  TrendingUp, IndianRupee, Clock, Users,
  Shield, Zap, Brain, BarChart2, Heart,
  Smartphone, Globe, Lock, Star, ArrowRight,
  CheckCircle, XCircle, Sparkles, Target,
  Calendar, FileText, Pill, Baby,
  Stethoscope, BedDouble, PiggyBank, Bell,
} from 'lucide-react'

// ═══ SLIDE DATA ═══════════════════════════════════════════════

interface Slide {
  id: string
  title: string
  subtitle?: string
  type: 'hero' | 'problem' | 'solution' | 'feature' | 'comparison' | 'stats' | 'pricing' | 'cta'
}

const SLIDES: Slide[] = [
  { id: 'hero', title: 'NexMedicon', subtitle: 'The Clinic Revenue Growth Engine', type: 'hero' },
  { id: 'problem', title: 'The Problem', subtitle: 'Why Clinics Lose Money Daily', type: 'problem' },
  { id: 'solution', title: 'Our Solution', subtitle: 'Revenue Intelligence + Clinical Excellence', type: 'solution' },
  { id: 'compare', title: 'Old HMS vs NexMedicon', subtitle: 'A Paradigm Shift', type: 'comparison' },
  { id: 'revenue', title: 'Revenue Features', subtitle: 'Every Click Grows Your Practice', type: 'feature' },
  { id: 'clinical', title: 'Clinical Intelligence', subtitle: 'AI-Powered Patient Safety', type: 'feature' },
  { id: 'operations', title: 'Operations Suite', subtitle: 'Zero Wasted Minutes', type: 'feature' },
  { id: 'patient-exp', title: 'Patient Experience', subtitle: 'Modern Care Delivery', type: 'feature' },
  { id: 'stats', title: 'Impact Numbers', subtitle: 'What Our Users See', type: 'stats' },
  { id: 'security', title: 'Security & Compliance', subtitle: 'Bank-Grade Protection', type: 'feature' },
  { id: 'cta', title: 'Ready to Grow?', subtitle: 'Start Your Revenue Revolution', type: 'cta' },
]

export default function PresentationPage() {
  const [currentSlide, setCurrentSlide] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isAnimating, setIsAnimating] = useState(false)

  const goTo = useCallback((idx: number) => {
    if (idx < 0 || idx >= SLIDES.length || isAnimating) return
    setIsAnimating(true)
    setCurrentSlide(idx)
    setTimeout(() => setIsAnimating(false), 400)
  }, [isAnimating])

  const next = useCallback(() => goTo(currentSlide + 1), [currentSlide, goTo])
  const prev = useCallback(() => goTo(currentSlide - 1), [currentSlide, goTo])

  // Keyboard navigation
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next() }
      if (e.key === 'ArrowLeft') { e.preventDefault(); prev() }
      if (e.key === 'Escape') setIsPlaying(false)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [next, prev])

  // Auto-play
  useEffect(() => {
    if (!isPlaying) return
    const t = setInterval(() => {
      setCurrentSlide(c => c < SLIDES.length - 1 ? c + 1 : (setIsPlaying(false), c))
    }, 6000)
    return () => clearInterval(t)
  }, [isPlaying])

  return (
    <div className="min-h-screen bg-gray-950 text-white overflow-hidden relative select-none">
      {/* Background gradient mesh */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-0 w-[600px] h-[600px] bg-purple-900/20 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-emerald-900/15 rounded-full blur-[100px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-amber-900/10 rounded-full blur-[80px]" />
      </div>

      {/* Slide Content */}
      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Top Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-bold text-white/80">NexMedicon</span>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white/80 transition-colors"
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {isPlaying ? 'Pause' : 'Auto-play'}
            </button>
            <span className="text-xs text-white/30">
              {currentSlide + 1} / {SLIDES.length}
            </span>
          </div>
        </div>

        {/* Main slide area */}
        <div className="flex-1 flex items-center justify-center p-6 sm:p-12">
          <div className="w-full max-w-5xl">
            <SlideContent slide={SLIDES[currentSlide]} index={currentSlide} />
          </div>
        </div>

        {/* Bottom Navigation */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/5">
          <button
            onClick={prev}
            disabled={currentSlide === 0}
            className="flex items-center gap-2 text-sm text-white/50 hover:text-white/80 disabled:opacity-20 transition-all"
          >
            <ChevronLeft className="w-4 h-4" /> Previous
          </button>

          {/* Progress dots */}
          <div className="flex items-center gap-1.5">
            {SLIDES.map((_, i) => (
              <button
                key={i}
                onClick={() => goTo(i)}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === currentSlide
                    ? 'w-6 bg-emerald-400'
                    : i < currentSlide
                    ? 'w-1.5 bg-white/30'
                    : 'w-1.5 bg-white/10'
                }`}
              />
            ))}
          </div>

          <button
            onClick={next}
            disabled={currentSlide === SLIDES.length - 1}
            className="flex items-center gap-2 text-sm text-white/50 hover:text-white/80 disabled:opacity-20 transition-all"
          >
            Next <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

// ═══ SLIDE CONTENT RENDERER ═══════════════════════════════════

function SlideContent({ slide, index }: { slide: Slide; index: number }) {
  switch (slide.id) {
    case 'hero': return <HeroSlide />
    case 'problem': return <ProblemSlide />
    case 'solution': return <SolutionSlide />
    case 'compare': return <ComparisonSlide />
    case 'revenue': return <RevenueFeatureSlide />
    case 'clinical': return <ClinicalSlide />
    case 'operations': return <OperationsSlide />
    case 'patient-exp': return <PatientExperienceSlide />
    case 'stats': return <StatsSlide />
    case 'security': return <SecuritySlide />
    case 'cta': return <CTASlide />
    default: return null
  }
}



// ═══ INDIVIDUAL SLIDES ════════════════════════════════════════

function HeroSlide() {
  return (
    <div className="text-center space-y-8">
      <div className="inline-flex items-center gap-2 bg-emerald-400/10 border border-emerald-400/20 rounded-full px-4 py-1.5">
        <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
        <span className="text-xs font-medium text-emerald-300">Clinic Growth Platform</span>
      </div>
      
      <h1 className="text-5xl sm:text-7xl font-black leading-tight">
        <span className="bg-gradient-to-r from-white via-white to-white/60 bg-clip-text text-transparent">
          Stop Managing.
        </span>
        <br />
        <span className="bg-gradient-to-r from-emerald-300 via-teal-300 to-cyan-300 bg-clip-text text-transparent">
          Start Growing.
        </span>
      </h1>
      
      <p className="text-lg text-white/50 max-w-2xl mx-auto leading-relaxed">
        NexMedicon isn&apos;t another hospital software. It&apos;s a revenue intelligence platform 
        that makes your clinic earn more while you focus on patients.
      </p>

      <div className="flex items-center justify-center gap-6 pt-4">
        {[
          { icon: IndianRupee, label: 'Revenue First', value: '+35%' },
          { icon: Clock, label: 'Time Saved', value: '2hrs/day' },
          { icon: Users, label: 'Patient Retention', value: '92%' },
        ].map(({ icon: Icon, label, value }) => (
          <div key={label} className="text-center">
            <div className="w-12 h-12 mx-auto rounded-xl bg-white/5 border border-white/10 flex items-center justify-center mb-2">
              <Icon className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="text-xl font-bold text-white">{value}</div>
            <div className="text-xs text-white/40">{label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ProblemSlide() {
  const problems = [
    { emoji: '💸', title: 'Revenue Leakage', desc: 'Patients leave without bills. Follow-ups are missed. Empty slots go unfilled.', stat: '₹15-30L/year lost' },
    { emoji: '⏰', title: 'Time Drain', desc: 'Staff spends 3+ hours on paperwork, manual entries, and repeated questions.', stat: '45% of clinic time' },
    { emoji: '📉', title: 'No Visibility', desc: 'Doctors have no idea about daily revenue, pending payments, or growth trends.', stat: 'Zero insights' },
    { emoji: '😤', title: 'Patient Drop-off', desc: 'Long waits, no digital experience, poor follow-up = patients go elsewhere.', stat: '30% never return' },
  ]

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h2 className="text-3xl sm:text-4xl font-black text-white mb-2">
          Why Clinics Bleed Money <span className="text-red-400">Every Single Day</span>
        </h2>
        <p className="text-white/40 text-sm">These aren&apos;t edge cases. This is the reality for 90% of Indian clinics.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {problems.map(p => (
          <div key={p.title} className="bg-white/[0.03] border border-white/10 rounded-2xl p-5 hover:border-red-400/30 transition-all">
            <div className="flex items-start gap-3">
              <span className="text-2xl">{p.emoji}</span>
              <div className="flex-1">
                <h3 className="font-bold text-white text-sm mb-1">{p.title}</h3>
                <p className="text-xs text-white/40 leading-relaxed">{p.desc}</p>
                <div className="mt-2 inline-flex items-center gap-1 bg-red-400/10 border border-red-400/20 rounded-full px-2.5 py-0.5">
                  <span className="text-[10px] font-bold text-red-300">{p.stat}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SolutionSlide() {
  const pillars = [
    { icon: TrendingUp, title: 'Revenue Intelligence', desc: 'Auto-detect missed bills, predict demand, optimize pricing', color: 'from-emerald-400 to-teal-500' },
    { icon: Brain, title: 'Clinical AI', desc: 'Drug safety, smart prescriptions, voice commands, auto-summaries', color: 'from-purple-400 to-violet-500' },
    { icon: Zap, title: 'Zero-Click Operations', desc: 'Auto-billing, smart queues, one-tap workflows, predictive scheduling', color: 'from-amber-400 to-orange-500' },
  ]

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h2 className="text-3xl sm:text-4xl font-black text-white mb-2">
          Three Pillars of <span className="bg-gradient-to-r from-emerald-300 to-teal-300 bg-clip-text text-transparent">Clinic Growth</span>
        </h2>
        <p className="text-white/40 text-sm">Not just software. A growth engine that works 24/7.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        {pillars.map(p => (
          <div key={p.title} className="bg-white/[0.03] border border-white/10 rounded-2xl p-6 text-center hover:border-white/20 transition-all group">
            <div className={`w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br ${p.color} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
              <p.icon className="w-6 h-6 text-white" />
            </div>
            <h3 className="font-bold text-white text-base mb-2">{p.title}</h3>
            <p className="text-xs text-white/40 leading-relaxed">{p.desc}</p>
          </div>
        ))}
      </div>
    </div>
  )
}



function ComparisonSlide() {
  const rows = [
    { feature: 'Revenue Tracking', old: 'End-of-day manual count', us: 'Live dashboard with targets & alerts' },
    { feature: 'Patient Visit Type', old: 'Staff asks patient every time', us: 'Auto-detects new vs follow-up + fee' },
    { feature: 'Billing', old: 'Manual entry, miss half', us: 'Auto-generated, zero leakage' },
    { feature: 'Prescriptions', old: 'Handwritten or basic text', us: 'AI safety checks, drug interactions, voice' },
    { feature: 'Follow-ups', old: 'Written in diary, forgotten', us: 'Auto-reminders via WhatsApp' },
    { feature: 'Appointments', old: 'Phone calls, register book', us: 'QR booking, auto-confirmation' },
    { feature: 'Reports', old: 'CA asks once a year', us: 'Real-time daily/monthly with GST' },
    { feature: 'Marketing', old: 'None or expensive agency', us: 'Built-in WhatsApp, QR, referral system' },
    { feature: 'Patient Records', old: 'Paper files, lost easily', us: 'Cloud + offline + encrypted + ABDM' },
    { feature: 'Staff Workload', old: '3+ hours daily paperwork', us: 'Auto-fills, voice input, templates' },
  ]

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-3xl font-black text-white mb-1">
          Traditional HMS <span className="text-red-400">vs</span> NexMedicon
        </h2>
        <p className="text-white/40 text-xs">Not just digitization. Transformation.</p>
      </div>

      <div className="bg-white/[0.02] border border-white/10 rounded-2xl overflow-hidden">
        <div className="grid grid-cols-[1fr,1fr,1fr] text-xs font-bold border-b border-white/10">
          <div className="px-4 py-3 text-white/60">Feature</div>
          <div className="px-4 py-3 text-red-300 border-l border-white/10">Old HMS / Manual</div>
          <div className="px-4 py-3 text-emerald-300 border-l border-white/10">NexMedicon</div>
        </div>
        {rows.map((r, i) => (
          <div key={r.feature} className={`grid grid-cols-[1fr,1fr,1fr] text-xs ${i % 2 === 0 ? 'bg-white/[0.01]' : ''}`}>
            <div className="px-4 py-2.5 text-white/70 font-medium">{r.feature}</div>
            <div className="px-4 py-2.5 text-white/30 border-l border-white/5 flex items-center gap-1.5">
              <XCircle className="w-3 h-3 text-red-400/60 flex-shrink-0" />
              {r.old}
            </div>
            <div className="px-4 py-2.5 text-white/60 border-l border-white/5 flex items-center gap-1.5">
              <CheckCircle className="w-3 h-3 text-emerald-400 flex-shrink-0" />
              {r.us}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function RevenueFeatureSlide() {
  const features = [
    { icon: Target, title: 'Daily Revenue Target', desc: 'Set targets, track in real-time, get alerts when falling behind' },
    { icon: IndianRupee, title: 'Zero-Leakage Billing', desc: 'Auto-detect unbilled consultations. Never miss a payment again.' },
    { icon: Calendar, title: 'Smart Scheduling', desc: 'Fill empty slots with follow-ups. Maximize chair-time utilization.' },
    { icon: Bell, title: 'Payment Reminders', desc: 'Auto WhatsApp reminders for pending bills and EMI collections.' },
    { icon: BarChart2, title: 'Revenue Analytics', desc: 'Daily/weekly/monthly trends with procedure-wise breakdown.' },
    { icon: PiggyBank, title: 'Package Billing', desc: 'Pre-defined packages (Delivery, ANC, Surgery) for faster billing.' },
  ]

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-3xl font-black text-white mb-1">
          Revenue Features That <span className="bg-gradient-to-r from-emerald-300 to-teal-300 bg-clip-text text-transparent">Print Money</span>
        </h2>
        <p className="text-white/40 text-xs">Every feature is designed to increase your bottom line.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {features.map(f => (
          <div key={f.title} className="bg-white/[0.03] border border-white/10 rounded-xl p-4 hover:border-emerald-400/30 transition-all">
            <f.icon className="w-5 h-5 text-emerald-400 mb-2" />
            <h3 className="font-bold text-white text-xs mb-1">{f.title}</h3>
            <p className="text-[10px] text-white/40 leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function ClinicalSlide() {
  const features = [
    { icon: Pill, title: 'Drug Interaction Alerts', desc: 'Real-time checks across 200+ drugs with severity levels' },
    { icon: Shield, title: 'Allergy Hard Stops', desc: 'Cannot prescribe allergic drugs without documented override' },
    { icon: Brain, title: 'AI Summaries', desc: 'Voice-to-text, auto-diagnosis suggestions, clinical notes' },
    { icon: Heart, title: 'Critical Value Alerts', desc: 'Abnormal vitals trigger instant alerts to the doctor' },
    { icon: Baby, title: 'Gynecology Templates', desc: '20 specialty templates for common gynec conditions' },
    { icon: Stethoscope, title: 'Smart Prescriptions', desc: 'Dose validation, frequency checks, pregnancy safety' },
  ]

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-3xl font-black text-white mb-1">
          Clinical Intelligence <span className="bg-gradient-to-r from-purple-300 to-violet-300 bg-clip-text text-transparent">Built In</span>
        </h2>
        <p className="text-white/40 text-xs">Safety features that would cost lakhs to build separately.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {features.map(f => (
          <div key={f.title} className="bg-white/[0.03] border border-white/10 rounded-xl p-4 hover:border-purple-400/30 transition-all">
            <f.icon className="w-5 h-5 text-purple-400 mb-2" />
            <h3 className="font-bold text-white text-xs mb-1">{f.title}</h3>
            <p className="text-[10px] text-white/40 leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function OperationsSlide() {
  const features = [
    { icon: Clock, title: 'Smart Visit Detection', desc: 'Auto-detect new vs follow-up patient. Auto-set consultation fee.' },
    { icon: Zap, title: 'One-Tap Workflows', desc: 'Register → Queue → Consult → Bill in 4 taps, not 40 clicks.' },
    { icon: Users, title: 'Real-time Queue', desc: 'Live patient queue with priority, wait times, auto-calling.' },
    { icon: BedDouble, title: 'Bed Management', desc: 'Visual ward map with status, auto-discharge alerts.' },
    { icon: FileText, title: 'Auto-Documents', desc: 'Discharge summary, referral letters generated with one click.' },
    { icon: Globe, title: 'Offline Mode', desc: 'Works without internet. Syncs automatically when back online.' },
  ]

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-3xl font-black text-white mb-1">
          Operations That <span className="bg-gradient-to-r from-amber-300 to-orange-300 bg-clip-text text-transparent">Run Themselves</span>
        </h2>
        <p className="text-white/40 text-xs">Reduce staff effort by 60%. Zero training needed.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {features.map(f => (
          <div key={f.title} className="bg-white/[0.03] border border-white/10 rounded-xl p-4 hover:border-amber-400/30 transition-all">
            <f.icon className="w-5 h-5 text-amber-400 mb-2" />
            <h3 className="font-bold text-white text-xs mb-1">{f.title}</h3>
            <p className="text-[10px] text-white/40 leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </div>
    </div>
  )
}



function PatientExperienceSlide() {
  const features = [
    { icon: Smartphone, title: 'Patient Portal', desc: 'Patients view their records, prescriptions, reports via magic link' },
    { icon: Calendar, title: 'QR Booking', desc: 'Scan QR at reception → Book next appointment instantly' },
    { icon: Bell, title: 'WhatsApp Reminders', desc: 'Auto-send appointment confirmations and follow-up reminders' },
    { icon: Star, title: 'Google Review Nudge', desc: 'Happy patients get a Google review link after good visits' },
    { icon: Heart, title: 'Care Continuity', desc: 'Full patient timeline: every visit, every test, every prescription' },
    { icon: Lock, title: 'Privacy First', desc: 'Encrypted data, ABDM compliant, patient consent management' },
  ]

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-3xl font-black text-white mb-1">
          Patient Experience <span className="bg-gradient-to-r from-rose-300 to-pink-300 bg-clip-text text-transparent">Reimagined</span>
        </h2>
        <p className="text-white/40 text-xs">Patients who love your clinic tell 5 friends. Patients who don&apos;t tell 15.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {features.map(f => (
          <div key={f.title} className="bg-white/[0.03] border border-white/10 rounded-xl p-4 hover:border-rose-400/30 transition-all">
            <f.icon className="w-5 h-5 text-rose-400 mb-2" />
            <h3 className="font-bold text-white text-xs mb-1">{f.title}</h3>
            <p className="text-[10px] text-white/40 leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function StatsSlide() {
  const stats = [
    { value: '₹4.2L', label: 'Additional revenue recovered per month (avg clinic)', color: 'text-emerald-400' },
    { value: '2.5hrs', label: 'Daily staff time saved on paperwork', color: 'text-amber-400' },
    { value: '92%', label: 'Patient return rate (vs 65% industry average)', color: 'text-blue-400' },
    { value: '< 3min', label: 'Average patient registration time', color: 'text-purple-400' },
    { value: '0', label: 'Missed critical drug interactions', color: 'text-red-400' },
    { value: '99.9%', label: 'System uptime with offline fallback', color: 'text-cyan-400' },
  ]

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h2 className="text-3xl font-black text-white mb-1">
          Numbers That <span className="bg-gradient-to-r from-emerald-300 to-cyan-300 bg-clip-text text-transparent">Speak</span>
        </h2>
        <p className="text-white/40 text-xs">Real impact measured across clinics using NexMedicon.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {stats.map(s => (
          <div key={s.label} className="bg-white/[0.03] border border-white/10 rounded-2xl p-5 text-center">
            <div className={`text-3xl font-black mb-1 ${s.color}`}>{s.value}</div>
            <div className="text-[11px] text-white/40 leading-snug">{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SecuritySlide() {
  const items = [
    { icon: Lock, title: 'AES-256 Encryption', desc: 'All patient data encrypted at rest and in transit' },
    { icon: Shield, title: 'DPDP Act Compliant', desc: 'Indian Data Protection compliance with consent management' },
    { icon: FileText, title: 'Immutable Audit Log', desc: 'Blockchain-style hash chain. Every action is traceable.' },
    { icon: Users, title: 'Role-Based Access', desc: 'Admin, Doctor, Staff — each sees only what they need' },
    { icon: Globe, title: 'ABDM / FHIR Ready', desc: 'National Health ID integration for data portability' },
    { icon: Zap, title: 'Rate Limiting & MFA', desc: 'Brute-force protection + two-factor authentication' },
  ]

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-3xl font-black text-white mb-1">
          Security <span className="bg-gradient-to-r from-blue-300 to-indigo-300 bg-clip-text text-transparent">Without Compromise</span>
        </h2>
        <p className="text-white/40 text-xs">Bank-grade security that meets healthcare compliance standards.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {items.map(f => (
          <div key={f.title} className="bg-white/[0.03] border border-white/10 rounded-xl p-4 hover:border-blue-400/30 transition-all">
            <f.icon className="w-5 h-5 text-blue-400 mb-2" />
            <h3 className="font-bold text-white text-xs mb-1">{f.title}</h3>
            <p className="text-[10px] text-white/40 leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function CTASlide() {
  return (
    <div className="text-center space-y-8">
      <h2 className="text-4xl sm:text-5xl font-black text-white leading-tight">
        Your Clinic Deserves
        <br />
        <span className="bg-gradient-to-r from-emerald-300 via-teal-300 to-cyan-300 bg-clip-text text-transparent">
          Better Than a Diary
        </span>
      </h2>

      <p className="text-lg text-white/40 max-w-xl mx-auto">
        Join the clinics that stopped losing money and started growing. 
        NexMedicon pays for itself in the first week.
      </p>

      <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
        <div className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold px-8 py-3 rounded-xl text-sm shadow-lg shadow-emerald-500/25">
          Start Free Trial — No Card Needed
        </div>
        <div className="text-white/30 text-sm flex items-center gap-2">
          <ArrowRight className="w-4 h-4" />
          Setup in 10 minutes
        </div>
      </div>

      <div className="pt-8 flex items-center justify-center gap-8 text-white/30 text-xs">
        <span>✓ Free for first 30 days</span>
        <span>✓ No lock-in contract</span>
        <span>✓ Migrate from any system</span>
      </div>
    </div>
  )
}
