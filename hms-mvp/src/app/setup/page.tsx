'use client'
import { useState } from 'react'
import Link from 'next/link'
import AppShell from '@/components/layout/AppShell'
import {
  CheckCircle, Circle, ExternalLink, ChevronRight,
  Database, Settings, Users, Stethoscope, IndianRupee,
  Key, Sparkles, AlertCircle, Copy, Check
} from 'lucide-react'

interface Step {
  id: string
  title: string
  description: string
  icon: any
  action?: string
  actionHref?: string
  actionExternal?: boolean
  code?: string
  warning?: string
  tip?: string
}

const STEPS: Step[] = [
  {
    id: 'supabase',
    title: 'Create Supabase project (free)',
    description: 'Supabase is the database that stores all patient data securely in India (Mumbai region). Free tier is sufficient for the pilot.',
    icon: Database,
    action: 'Open Supabase',
    actionHref: 'https://supabase.com',
    actionExternal: true,
    tip: 'Choose ap-south-1 (Mumbai) as the region for data sovereignty compliance with DPDP Act.',
  },
  {
    id: 'schema',
    title: 'Run database setup SQL',
    description: 'Run each SQL file in order in Supabase → SQL Editor → New Query. This creates all required tables.',
    icon: Database,
    code: `-- Run in this order in Supabase SQL Editor:
1. supabase_setup.sql          (patients, encounters, prescriptions, beds)
2. supabase_add_discharge.sql  (discharge summaries)
3. supabase_add_billing.sql    (billing & payments)
4. supabase_v5_updates.sql     (performance indexes)
5. seed_demo_data.sql          (15 demo patients — optional but recommended for demo)`,
    tip: 'Each file is safe to run multiple times — all use IF NOT EXISTS.',
  },
  {
    id: 'env',
    title: 'Configure .env.local',
    description: 'Add your Supabase and Anthropic keys to the .env.local file in the project root. Then restart the dev server.',
    icon: Key,
    code: `# ── SUPABASE (required) ──────────────────────────────
# Get from: supabase.com → Project → Settings → API
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# ── ANTHROPIC (required for AI features) ─────────────
# Get from: console.anthropic.com → API Keys
# Enables: OCR scanning, AI summaries, voice correction
ANTHROPIC_API_KEY=sk-ant-your-real-key-here

# ── RAZORPAY (optional - for card/UPI payments) ───────
# Get from: dashboard.razorpay.com → Settings → API Keys
NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_test_xxxx   # for checkout widget
RAZORPAY_KEY_ID=rzp_test_xxxx               # for payment links
RAZORPAY_KEY_SECRET=your-secret-here        # for payment links

# ── UPI DEEPLINK (optional - simpler than Razorpay) ──
# Your hospital UPI ID - opens GPay/PhonePe on patient phone
NEXT_PUBLIC_UPI_ID=yourhospital@upibank

# ── HOSPITAL NAME (for WhatsApp messages) ────────────
NEXT_PUBLIC_HOSPITAL_NAME=City Women Hospital

# ── SITE URL ─────────────────────────────────────────
NEXT_PUBLIC_SITE_URL=http://localhost:3000`,
    warning: 'After editing .env.local, you MUST restart the server (Ctrl+C then npm run dev) for changes to take effect.',
  },
  {
    id: 'auth',
    title: 'Create login user',
    description: 'Create a user account for the doctor/receptionist in Supabase Authentication.',
    icon: Users,
    code: `In Supabase:
1. Go to Authentication → Users
2. Click "Add User" → "Create new user"
3. Enter email and password
4. Use these credentials to log in to NexMedicon HMS`,
    tip: 'Create separate accounts for each doctor and receptionist. Each gets their own login.',
  },
  {
    id: 'settings',
    title: 'Configure hospital details',
    description: 'Enter the hospital name, address, doctor name, and qualifications. These appear on printed prescriptions and discharge summaries.',
    icon: Settings,
    action: 'Open Settings',
    actionHref: '/settings',
    tip: 'Settings are saved locally. After setting up, print a test prescription to verify the header looks correct.',
  },
  {
    id: 'beds',
    title: 'Set up bed configuration (optional)',
    description: 'The default setup includes 10 beds across General Ward and Labour Ward. Edit or add beds in Supabase if your hospital has a different layout.',
    icon: Database,
    code: `-- Add beds in Supabase SQL Editor:
INSERT INTO beds (bed_number, ward, status) VALUES
  ('ICU-01', 'ICU', 'available'),
  ('ICU-02', 'ICU', 'available'),
  ('LW-03', 'Labour Ward', 'available');

-- Or update existing bed ward names:
UPDATE beds SET ward = 'Maternity Ward' WHERE ward = 'Labour Ward';`,
    tip: 'Bed numbers should match your physical bed labels for easy identification.',
  },
  {
    id: 'test',
    title: 'Test the system',
    description: 'Register a test patient, start a consultation, generate a prescription, and test the AI summary.',
    icon: Stethoscope,
    action: 'Register Test Patient',
    actionHref: '/patients/new',
    tip: 'Use the seed_demo_data.sql to load 15 realistic patients instantly — perfect for showing the system to the pilot doctor.',
  },
  {
    id: 'payment',
    title: 'Set up Razorpay (optional — for UPI/Card)',
    description: 'Cash payments work immediately. For UPI and card payments, create a free Razorpay account and add your test key.',
    icon: IndianRupee,
    action: 'Open Razorpay',
    actionHref: 'https://dashboard.razorpay.com',
    actionExternal: true,
    code: `1. Create account at dashboard.razorpay.com
2. Go to Settings → API Keys → Generate Test Key
3. Copy the Key ID (starts with rzp_test_)
4. Add to .env.local: NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_test_xxxxx
5. Restart server`,
    tip: 'Test mode payments don\'t charge real money. Use card 4111 1111 1111 1111, any expiry, any CVV for testing.',
  },
]

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="relative mt-3">
      <pre className="bg-gray-900 text-green-400 text-xs rounded-lg p-4 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">
        {code}
      </pre>
      <button onClick={copy}
        className="absolute top-2 right-2 p-1.5 bg-gray-700 hover:bg-gray-600 rounded text-gray-300 hover:text-white transition-colors">
        {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  )
}

export default function SetupPage() {
  const [done, setDone] = useState<Set<string>>(new Set())

  function toggle(id: string) {
    setDone(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  const progress = Math.round((done.size / STEPS.length) * 100)

  return (
    <AppShell>
      <div className="p-6 max-w-3xl mx-auto">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-1 flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-blue-600" />
            NexMedicon HMS — Setup Guide
          </h1>
          <p className="text-gray-500 text-sm">
            Follow these steps to get the system fully operational for your pilot hospital.
          </p>

          {/* Progress bar */}
          <div className="mt-4 bg-gray-100 rounded-full h-2.5 overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}/>
          </div>
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>{done.size} of {STEPS.length} steps completed</span>
            <span>{progress}%</span>
          </div>
        </div>

        {/* Steps */}
        <div className="space-y-4">
          {STEPS.map((step, idx) => {
            const isDone = done.has(step.id)
            const Icon = step.icon
            return (
              <div key={step.id}
                className={`card p-5 border transition-all ${isDone ? 'border-green-200 bg-green-50/30' : 'border-gray-100'}`}>
                <div className="flex items-start gap-4">
                  {/* Step number / done toggle */}
                  <button onClick={() => toggle(step.id)}
                    className="flex-shrink-0 mt-0.5 transition-colors">
                    {isDone
                      ? <CheckCircle className="w-6 h-6 text-green-500" />
                      : <Circle className="w-6 h-6 text-gray-300 hover:text-blue-400" />}
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                        Step {idx + 1}
                      </span>
                      {isDone && (
                        <span className="text-xs font-semibold text-green-600 bg-green-100 px-2 py-0.5 rounded-full">
                          ✓ Done
                        </span>
                      )}
                    </div>
                    <h3 className={`font-semibold text-base mb-1 ${isDone ? 'text-green-800' : 'text-gray-900'}`}>
                      {step.title}
                    </h3>
                    <p className="text-sm text-gray-600 mb-2">{step.description}</p>

                    {step.warning && (
                      <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2 text-xs text-amber-800">
                        <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                        {step.warning}
                      </div>
                    )}

                    {step.code && <CodeBlock code={step.code} />}

                    {step.tip && (
                      <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 mt-2 text-xs text-blue-700">
                        <span className="flex-shrink-0">💡</span>
                        {step.tip}
                      </div>
                    )}

                    {step.action && (
                      <div className="mt-3">
                        {step.actionExternal ? (
                          <a href={step.actionHref} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors">
                            {step.action}
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        ) : (
                          <Link href={step.actionHref!}
                            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors">
                            {step.action}
                            <ChevronRight className="w-3.5 h-3.5" />
                          </Link>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* All done */}
        {done.size === STEPS.length && (
          <div className="mt-6 card p-6 bg-green-50 border-green-200 text-center">
            <CheckCircle className="w-10 h-10 text-green-500 mx-auto mb-3" />
            <h3 className="font-bold text-green-800 text-lg mb-1">System is ready! 🎉</h3>
            <p className="text-green-700 text-sm mb-4">
              NexMedicon HMS is fully configured and ready for your pilot hospital.
            </p>
            <Link href="/dashboard" className="btn-primary inline-flex items-center gap-2">
              Go to Dashboard <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        )}
      </div>
    </AppShell>
  )
}
