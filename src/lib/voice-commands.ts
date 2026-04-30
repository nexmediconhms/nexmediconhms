/**
 * src/lib/voice-commands.ts
 *
 * Voice Command Registry — the brain of the voice assistant.
 *
 * Defines every action the voice assistant can perform, grouped by:
 *   - Navigation commands  (go to dashboard, open patients, etc.)
 *   - Page action commands (print prescription, save, add medicine, etc.)
 *   - Section/tab commands (go to gynecology section, switch to vitals, etc.)
 *   - Form commands        (clear form, add row, submit)
 *
 * Each command has:
 *   - trigger phrases (what the user might say)
 *   - intent id (unique action identifier)
 *   - description (shown in the help panel)
 *   - category
 *   - payload (optional extra data)
 *
 * The AI API is used to fuzzy-match the transcript to the closest intent.
 * Offline fallback uses keyword matching for instant response.
 */

export type CommandCategory =
  | 'navigation'
  | 'page_action'
  | 'section'
  | 'form'
  | 'utility'

export interface VoiceCommand {
  intent:      string
  phrases:     string[]       // example triggers (used for AI context + offline matching)
  description: string         // shown in help overlay
  category:    CommandCategory
  payload?:    Record<string, any>
}

// ── All registered commands ────────────────────────────────────

export const VOICE_COMMANDS: VoiceCommand[] = [

  // ══ NAVIGATION ════════════════════════════════════════════════

  { intent: 'nav.dashboard',    category: 'navigation', description: 'Go to Dashboard',
    phrases: ['go to dashboard', 'open dashboard', 'home', 'show dashboard', 'dashboard'] },

  { intent: 'nav.patients',     category: 'navigation', description: 'Go to Patients list',
    phrases: ['open patients', 'go to patients', 'patient list', 'show patients', 'patients'] },

  { intent: 'nav.new_patient',  category: 'navigation', description: 'Register a new patient',
    phrases: ['new patient', 'register patient', 'add patient', 'register new patient', 'create patient'] },

  { intent: 'nav.opd',          category: 'navigation', description: 'Go to OPD Consultation',
    phrases: ['open opd', 'go to opd', 'start consultation', 'opd', 'new consultation'] },

  { intent: 'nav.queue',        category: 'navigation', description: 'Go to OPD Queue',
    phrases: ['open queue', 'go to queue', 'show queue', 'opd queue', 'waiting list'] },

  { intent: 'nav.appointments', category: 'navigation', description: 'Go to Appointments',
    phrases: ['open appointments', 'go to appointments', 'show appointments', 'appointments', 'schedule'] },

  { intent: 'nav.reminders',    category: 'navigation', description: 'Go to Reminders',
    phrases: ['open reminders', 'go to reminders', 'show reminders', 'reminders', 'notifications'] },

  { intent: 'nav.anc',          category: 'navigation', description: 'Go to ANC Registry',
    phrases: ['open anc', 'go to anc', 'anc registry', 'antenatal', 'ante natal', 'anc'] },

  { intent: 'nav.labs',         category: 'navigation', description: 'Go to Lab Results',
    phrases: ['open labs', 'go to labs', 'lab results', 'show labs', 'laboratory', 'lab reports'] },

  { intent: 'nav.beds',         category: 'navigation', description: 'Go to Bed Management',
    phrases: ['open beds', 'go to beds', 'bed management', 'beds', 'wards'] },

  { intent: 'nav.ipd',          category: 'navigation', description: 'Go to IPD Admissions',
    phrases: ['open ipd', 'go to ipd', 'ipd admissions', 'admitted patients', 'inpatient'] },

  { intent: 'nav.billing',      category: 'navigation', description: 'Go to Billing',
    phrases: ['open billing', 'go to billing', 'billing', 'payments', 'invoices', 'collect payment'] },

  { intent: 'nav.reports',      category: 'navigation', description: 'Go to Reports',
    phrases: ['open reports', 'go to reports', 'show reports', 'reports', 'analytics'] },

  { intent: 'nav.settings',     category: 'navigation', description: 'Go to Settings',
    phrases: ['open settings', 'go to settings', 'settings', 'preferences', 'configuration'] },

  { intent: 'nav.video',        category: 'navigation', description: 'Go to Video Consultations',
    phrases: ['open video', 'video consultation', 'telemedicine', 'video consult', 'online consultation'] },

  { intent: 'nav.forms',        category: 'navigation', description: 'Go to Patient Intake Forms',
    phrases: ['open forms', 'patient intake', 'intake forms', 'registration forms', 'forms'] },

  { intent: 'nav.search',       category: 'navigation', description: 'Go to Global Search',
    phrases: ['search', 'global search', 'find patient', 'search patient', 'open search'] },

  { intent: 'nav.audit',        category: 'navigation', description: 'Go to Audit Log',
    phrases: ['open audit', 'audit log', 'show audit', 'activity log', 'audit trail'] },

  { intent: 'nav.back',         category: 'navigation', description: 'Go back to previous page',
    phrases: ['go back', 'back', 'previous page', 'return', 'back to previous'] },

  // ══ SECTION / TAB NAVIGATION ══════════════════════════════════

  { intent: 'section.vitals',   category: 'section', description: 'Switch to Vitals & Complaints tab',
    phrases: ['go to vitals', 'open vitals', 'vitals section', 'vitals tab', 'switch to vitals', 'complaints section'] },

  { intent: 'section.consultation', category: 'section', description: 'Switch to Consultation tab',
    phrases: ['go to consultation', 'consultation section', 'consultation tab', 'switch to consultation', 'clinical notes'] },

  { intent: 'section.obgyn',    category: 'section', description: 'Switch to Gynecology / OB Examination tab',
    phrases: [
      'go to gynecology', 'gynecology section', 'gynaecology', 'go to obgyn', 'obstetric section',
      'go to ob gyn', 'go to ob examination', 'gynecology examination', 'gynaecological examination',
      'go to examination', 'switch to gynecology', 'open gynecology section',
      'per abdomen', 'per vaginum', 'obstetric history',
    ] },

  { intent: 'section.prescription', category: 'section', description: 'Open Prescription page',
    phrases: ['go to prescription', 'open prescription', 'write prescription', 'prescription', 'medicines', 'medications'] },

  { intent: 'section.discharge', category: 'section', description: 'Open Discharge Summary',
    phrases: ['go to discharge', 'discharge summary', 'open discharge', 'discharge patient'] },

  { intent: 'section.labs',     category: 'section', description: 'Go to Lab Results section',
    phrases: ['go to lab', 'lab section', 'investigations', 'test results', 'lab findings'] },

  // ══ PAGE ACTIONS ═══════════════════════════════════════════════

  { intent: 'action.print',     category: 'page_action', description: 'Print current page / prescription',
    phrases: ['print', 'print prescription', 'print this', 'take printout', 'print page', 'print report'] },

  { intent: 'action.save',      category: 'page_action', description: 'Save current form',
    phrases: ['save', 'save now', 'submit', 'save form', 'save consultation', 'save details', 'save patient'] },

  { intent: 'action.new_consultation', category: 'page_action', description: 'Start a new OPD consultation',
    phrases: ['start new consultation', 'new consultation', 'new opd', 'start consultation', 'new encounter'] },

  { intent: 'action.add_medicine', category: 'page_action', description: 'Add a new medicine row in prescription',
    phrases: ['add medicine', 'add drug', 'add medication', 'new medicine', 'new drug', 'add another medicine'] },

  { intent: 'action.remove_medicine', category: 'page_action', description: 'Remove last medicine from prescription',
    phrases: ['remove medicine', 'delete medicine', 'remove last medicine', 'delete drug', 'remove drug'] },

  { intent: 'action.send_whatsapp', category: 'page_action', description: 'Send WhatsApp message to patient',
    phrases: ['send whatsapp', 'whatsapp patient', 'send message', 'send reminder', 'message patient'] },

  { intent: 'action.book_appointment', category: 'page_action', description: 'Book an appointment',
    phrases: ['book appointment', 'new appointment', 'schedule appointment', 'add appointment'] },

  { intent: 'action.discharge',  category: 'page_action', description: 'Discharge the current patient',
    phrases: ['discharge patient', 'discharge now', 'create discharge', 'start discharge summary'] },

  { intent: 'action.generate_report', category: 'page_action', description: 'Generate AI report / summary',
    phrases: ['generate report', 'ai summary', 'generate summary', 'create report', 'summarize'] },

  { intent: 'action.collect_payment', category: 'page_action', description: 'Go to billing / collect payment',
    phrases: ['collect payment', 'billing', 'create bill', 'generate bill', 'payment'] },

  { intent: 'action.scan_form',  category: 'page_action', description: 'Scan a form / upload document',
    phrases: ['scan form', 'upload form', 'scan document', 'upload document', 'ocr', 'scan prescription'] },

  { intent: 'action.join_video', category: 'page_action', description: 'Join video call for current appointment',
    phrases: ['join video', 'join call', 'start video', 'video call', 'join video call'] },

  { intent: 'action.create_video_slot', category: 'page_action', description: 'Create a new video slot',
    phrases: ['create video slot', 'new video slot', 'add video slot', 'create slot', 'new slot'] },

  { intent: 'action.view_patient', category: 'page_action', description: 'Open patient profile',
    phrases: ['view patient', 'open patient', 'patient profile', 'patient details', 'show patient'] },

  { intent: 'action.refresh',   category: 'page_action', description: 'Refresh / reload current page data',
    phrases: ['refresh', 'reload', 'refresh page', 'reload data', 'update'] },

  { intent: 'action.export',    category: 'page_action', description: 'Export data to CSV / PDF',
    phrases: ['export', 'download', 'export data', 'download report', 'export csv'] },

  // ══ FORM COMMANDS ══════════════════════════════════════════════

  { intent: 'form.clear',       category: 'form', description: 'Clear current form',
    phrases: ['clear form', 'reset form', 'clear all', 'start over', 'reset'] },

  { intent: 'form.next_section', category: 'form', description: 'Go to next section',
    phrases: ['next section', 'next tab', 'next', 'go next', 'continue', 'proceed'] },

  { intent: 'form.prev_section', category: 'form', description: 'Go to previous section',
    phrases: ['previous section', 'prev tab', 'previous', 'go back', 'back section'] },

  // ══ UTILITY ═══════════════════════════════════════════════════

  { intent: 'utility.help',     category: 'utility', description: 'Show all voice commands',
    phrases: ['help', 'show commands', 'voice commands', 'what can I say', 'show help', 'commands'] },

  { intent: 'utility.stop',     category: 'utility', description: 'Stop listening',
    phrases: ['stop', 'stop listening', 'cancel', 'dismiss', 'close', 'done'] },

  { intent: 'utility.logout',   category: 'utility', description: 'Sign out',
    phrases: ['logout', 'log out', 'sign out', 'sign me out'] },
]

// ── Keyword-based offline matcher ─────────────────────────────
// Used as instant fallback when AI is not available

export function matchCommandOffline(transcript: string): VoiceCommand | null {
  const lower = transcript.toLowerCase().trim()

  let bestMatch: VoiceCommand | null = null
  let bestScore = 0

  for (const cmd of VOICE_COMMANDS) {
    for (const phrase of cmd.phrases) {
      // Exact match
      if (lower === phrase) return cmd

      // Contains match — score by how many words match
      const phraseWords = phrase.toLowerCase().split(' ')
      const matchedWords = phraseWords.filter(w => lower.includes(w))
      const score = matchedWords.length / phraseWords.length

      if (score > bestScore && score >= 0.6) {
        bestScore = score
        bestMatch = cmd
      }
    }
  }

  return bestMatch
}

// ── Intent to route mapping ───────────────────────────────────
export const INTENT_ROUTES: Record<string, string> = {
  'nav.dashboard':    '/dashboard',
  'nav.patients':     '/patients',
  'nav.new_patient':  '/patients/new',
  'nav.opd':          '/opd',
  'nav.queue':        '/queue',
  'nav.appointments': '/appointments',
  'nav.reminders':    '/reminders',
  'nav.anc':          '/anc',
  'nav.labs':         '/labs',
  'nav.beds':         '/beds',
  'nav.ipd':          '/ipd',
  'nav.billing':      '/billing',
  'nav.reports':      '/reports',
  'nav.settings':     '/settings',
  'nav.video':        '/video',
  'nav.forms':        '/forms',
  'nav.search':       '/search',
  'nav.audit':        '/audit-log',
}

// ── Section/tab intent mapping ───────────────────────────────
export const INTENT_TABS: Record<string, string> = {
  'section.vitals':       'vitals',
  'section.consultation': 'consultation',
  'section.obgyn':        'obgyn',
}

// ── Get commands grouped by category for help display ─────────
//
// Returns an array of [category, commands] pairs rather than a Record so
// that TypeScript never widens the value type to `unknown` via Object.entries().
// This avoids the "Property 'length' does not exist on type 'unknown'" error
// that occurs when callers do Object.entries(getCommandsByCategory()).
//
export function getCommandsByCategory(): Array<[CommandCategory, VoiceCommand[]]> {
  const grouped: Record<CommandCategory, VoiceCommand[]> = {
    navigation:  [],
    page_action: [],
    section:     [],
    form:        [],
    utility:     [],
  }
  for (const cmd of VOICE_COMMANDS) {
    grouped[cmd.category].push(cmd)
  }
  // Return as a typed array of tuples — no Object.entries() widening issue
  const categories: CommandCategory[] = [
    'navigation',
    'page_action',
    'section',
    'form',
    'utility',
  ]
  return categories.map(cat => [cat, grouped[cat]] as [CommandCategory, VoiceCommand[]])
}