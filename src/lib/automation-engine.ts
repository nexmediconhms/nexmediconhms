/**
 * src/lib/automation-engine.ts
 *
 * Event-Driven Automation Engine for NexMedicon HMS
 *
 * This module provides a centralized event dispatcher that triggers
 * automated actions (WhatsApp messages, notifications, queue additions)
 * based on clinical events happening across the system.
 *
 * ARCHITECTURE:
 *   Event Source → processAutomation(trigger, context) → Action(s)
 *
 * TRIGGERS:
 *   - appointment_created    → WhatsApp confirmation to patient
 *   - appointment_reminder   → WhatsApp reminder (day before)
 *   - appointment_cancelled  → WhatsApp cancellation notice
 *   - bill_created           → WhatsApp receipt/payment reminder
 *   - bill_paid              → WhatsApp payment confirmation
 *   - discharge_completed    → WhatsApp discharge summary + follow-up
 *   - follow_up_due          → WhatsApp follow-up reminder
 *   - ot_scheduled           → WhatsApp pre-op instructions
 *   - queue_added            → WhatsApp token + estimated wait
 *   - lab_report_ready       → WhatsApp report ready notification
 *   - ipd_admitted           → WhatsApp admission confirmation
 *
 * ACTIONS:
 *   - queue_whatsapp    → Insert into whatsapp_notifications table
 *   - send_notification → Insert into clinic_notifications table
 *   - auto_queue        → Insert into opd_queue table
 *   - create_reminder   → Insert into reminder_log table
 *
 * USAGE:
 *   import { processAutomation } from '@/lib/automation-engine'
 *
 *   // After booking an appointment:
 *   await processAutomation('appointment_created', {
 *     patientId: 'uuid',
 *     patientName: 'John Doe',
 *     mobile: '9876543210',
 *     date: '2026-05-22',
 *     time: '10:00',
 *     type: 'OPD Consultation',
 *   })
 *
 * CONFIGURATION:
 *   Automation rules can be enabled/disabled via the `automation_rules`
 *   table in Supabase. If the table doesn't exist, all rules default to
 *   enabled (backward compatible).
 */

import { supabase } from './supabase'

// ── Types ────────────────────────────────────────────────────────

export type AutomationTrigger =
  | 'appointment_created'
  | 'appointment_reminder'
  | 'appointment_cancelled'
  | 'appointment_confirmed'
  | 'bill_created'
  | 'bill_paid'
  | 'discharge_completed'
  | 'follow_up_due'
  | 'follow_up_overdue'
  | 'ot_scheduled'
  | 'ot_preop_reminder'
  | 'queue_added'
  | 'queue_called'
  | 'lab_report_ready'
  | 'ipd_admitted'
  | 'patient_registered'

export type AutomationAction =
  | 'queue_whatsapp'
  | 'send_notification'
  | 'auto_queue'
  | 'create_reminder'

export interface AutomationContext {
  patientId?: string
  patientName?: string
  mobile?: string
  mrn?: string
  // Event-specific context
  date?: string
  time?: string
  type?: string
  amount?: number
  doctorName?: string
  bedNumber?: string
  ward?: string
  tokenNumber?: number
  testName?: string
  diagnosis?: string
  followUpDate?: string
  surgeryName?: string
  medications?: string
  notes?: string
  // Internal tracking
  sourceTable?: string
  sourceId?: string
}

export interface AutomationRule {
  id: string
  trigger: AutomationTrigger
  action: AutomationAction
  template_key: string
  delay_minutes: number
  enabled: boolean
  conditions?: Record<string, any>
  priority: number
}

export interface AutomationResult {
  trigger: AutomationTrigger
  actionsExecuted: number
  actionsSkipped: number
  errors: string[]
  details: { action: AutomationAction; status: 'success' | 'skipped' | 'error'; detail?: string }[]
}

// ── Default Rules (when DB table doesn't exist) ──────────────────

const DEFAULT_RULES: Omit<AutomationRule, 'id'>[] = [
  {
    trigger: 'appointment_created',
    action: 'queue_whatsapp',
    template_key: 'appointment_confirmation',
    delay_minutes: 0,
    enabled: true,
    priority: 1,
  },
  {
    trigger: 'appointment_created',
    action: 'send_notification',
    template_key: 'appointment_staff_notify',
    delay_minutes: 0,
    enabled: true,
    priority: 2,
  },
  {
    trigger: 'bill_paid',
    action: 'queue_whatsapp',
    template_key: 'payment_receipt',
    delay_minutes: 0,
    enabled: true,
    priority: 1,
  },
  {
    trigger: 'discharge_completed',
    action: 'queue_whatsapp',
    template_key: 'discharge_summary',
    delay_minutes: 0,
    enabled: true,
    priority: 1,
  },
  {
    trigger: 'ot_scheduled',
    action: 'queue_whatsapp',
    template_key: 'ot_preop_instructions',
    delay_minutes: 0,
    enabled: true,
    priority: 1,
  },
  {
    trigger: 'queue_added',
    action: 'queue_whatsapp',
    template_key: 'queue_token_notification',
    delay_minutes: 0,
    enabled: true,
    priority: 1,
  },
  {
    trigger: 'lab_report_ready',
    action: 'queue_whatsapp',
    template_key: 'lab_report_ready',
    delay_minutes: 0,
    enabled: true,
    priority: 1,
  },
  {
    trigger: 'lab_report_ready',
    action: 'send_notification',
    template_key: 'lab_report_staff_alert',
    delay_minutes: 0,
    enabled: true,
    priority: 2,
  },
  {
    trigger: 'ipd_admitted',
    action: 'queue_whatsapp',
    template_key: 'ipd_admission_confirmation',
    delay_minutes: 0,
    enabled: true,
    priority: 1,
  },
  {
    trigger: 'follow_up_overdue',
    action: 'queue_whatsapp',
    template_key: 'follow_up_overdue_reminder',
    delay_minutes: 0,
    enabled: true,
    priority: 1,
  },
  {
    trigger: 'patient_registered',
    action: 'send_notification',
    template_key: 'patient_registered_notify',
    delay_minutes: 0,
    enabled: true,
    priority: 1,
  },
]

// ── Message Template Generator ───────────────────────────────────

function generateMessage(templateKey: string, ctx: AutomationContext): string {
  const name = ctx.patientName || 'Patient'

  switch (templateKey) {
    case 'appointment_confirmation':
      return `Namaste ${name} ji! Your appointment is confirmed for ${ctx.date || 'scheduled date'} at ${ctx.time || 'scheduled time'}. Visit type: ${ctx.type || 'Consultation'}. Please arrive 10 minutes early. Thank you!`

    case 'payment_receipt':
      return `Thank you ${name}! Payment of ₹${(ctx.amount || 0).toLocaleString('en-IN')} received successfully. Visit us for any queries.`

    case 'discharge_summary':
      return `${name}, you have been discharged. ${ctx.followUpDate ? `Follow-up on ${ctx.followUpDate}.` : ''} ${ctx.notes ? `Advice: ${ctx.notes.slice(0, 100)}` : ''} Take care!`

    case 'ot_preop_instructions':
      return `${name}, your surgery "${ctx.surgeryName || 'procedure'}" is scheduled for ${ctx.date || 'soon'}. Pre-op: Nothing to eat/drink after midnight. Bring all reports. Arrive 2 hours early.`

    case 'queue_token_notification':
      return `${name}, your OPD token is #${ctx.tokenNumber || '—'}. Estimated wait: ${ctx.tokenNumber ? Math.max(5, (ctx.tokenNumber - 1) * 8) : 15} minutes. Please wait in the waiting area.`

    case 'lab_report_ready':
      return `${name}, your lab report${ctx.testName ? ` (${ctx.testName})` : ''} is ready. Please collect from the lab counter or visit your doctor for discussion.`

    case 'ipd_admission_confirmation':
      return `${name} has been admitted to ${ctx.ward || 'ward'} (Bed ${ctx.bedNumber || '—'}). Doctor: ${ctx.doctorName || 'assigned'}. Visiting hours: 10AM-12PM, 4PM-6PM.`

    case 'follow_up_overdue_reminder':
      return `${name}, your follow-up visit is overdue. ${ctx.diagnosis ? `For: ${ctx.diagnosis}. ` : ''}Please visit at the earliest for continued care.`

    default:
      return `Hello ${name}, this is an update from your healthcare provider regarding your ${ctx.type || 'visit'}.`
  }
}

// ── Load Rules ───────────────────────────────────────────────────

async function loadRules(trigger: AutomationTrigger): Promise<AutomationRule[]> {
  try {
    const { data, error } = await supabase
      .from('automation_rules')
      .select('*')
      .eq('trigger', trigger)
      .eq('enabled', true)
      .order('priority', { ascending: true })

    if (error || !data || data.length === 0) {
      // Fallback to default rules
      return DEFAULT_RULES
        .filter(r => r.trigger === trigger && r.enabled)
        .map((r, i) => ({ ...r, id: `default-${i}` }))
    }

    return data as AutomationRule[]
  } catch {
    // Table doesn't exist — use defaults
    return DEFAULT_RULES
      .filter(r => r.trigger === trigger && r.enabled)
      .map((r, i) => ({ ...r, id: `default-${i}` }))
  }
}

// ── Action Executors ─────────────────────────────────────────────

async function executeQueueWhatsApp(
  rule: AutomationRule,
  ctx: AutomationContext
): Promise<{ success: boolean; detail?: string }> {
  if (!ctx.mobile || !ctx.patientId) {
    return { success: false, detail: 'Missing mobile or patientId' }
  }

  const message = generateMessage(rule.template_key, ctx)
  const scheduledFor = rule.delay_minutes > 0
    ? new Date(Date.now() + rule.delay_minutes * 60 * 1000).toISOString()
    : new Date().toISOString()

  const { error } = await supabase.from('whatsapp_notifications').insert({
    patient_id: ctx.patientId,
    patient_name: ctx.patientName || '',
    mobile: ctx.mobile,
    notification_type: rule.trigger,
    message_preview: message.slice(0, 300),
    recipient_type: 'patient',
    status: rule.delay_minutes > 0 ? 'scheduled' : 'queued',
    scheduled_for: scheduledFor,
    metadata: JSON.stringify({
      automation_rule: rule.id,
      template_key: rule.template_key,
      trigger: rule.trigger,
      source_table: ctx.sourceTable || null,
      source_id: ctx.sourceId || null,
    }),
  })

  if (error) {
    return { success: false, detail: error.message }
  }

  return { success: true, detail: `WhatsApp queued: ${rule.template_key}` }
}

async function executeSendNotification(
  rule: AutomationRule,
  ctx: AutomationContext
): Promise<{ success: boolean; detail?: string }> {
  const message = generateMessage(rule.template_key, ctx)

  const titleMap: Record<string, string> = {
    appointment_staff_notify: 'New Appointment',
    lab_report_staff_alert: 'Lab Report Ready',
    patient_registered_notify: 'New Patient Registered',
  }

  const { error } = await supabase.from('clinic_notifications').insert({
    title: titleMap[rule.template_key] || 'Automation Alert',
    message: message.slice(0, 300),
    type: 'info',
    severity: 'normal',
    source: 'automation',
    entity_type: ctx.sourceTable || 'automation',
    entity_id: ctx.sourceId || null,
    patient_id: ctx.patientId || null,
    patient_name: ctx.patientName || null,
    mrn: ctx.mrn || null,
    target_roles: ['admin', 'doctor', 'staff'],
    metadata: JSON.stringify({
      automation_rule: rule.id,
      trigger: rule.trigger,
    }),
  })

  if (error) {
    return { success: false, detail: error.message }
  }

  return { success: true, detail: `Notification sent: ${rule.template_key}` }
}

async function executeCreateReminder(
  rule: AutomationRule,
  ctx: AutomationContext
): Promise<{ success: boolean; detail?: string }> {
  if (!ctx.patientId || !ctx.mobile) {
    return { success: false, detail: 'Missing patientId or mobile' }
  }

  const message = generateMessage(rule.template_key, ctx)

  const { error } = await supabase.from('reminder_log').insert({
    patient_id: ctx.patientId,
    patient_name: ctx.patientName || '',
    mobile: ctx.mobile,
    reminder_type: rule.trigger,
    source_table: ctx.sourceTable || null,
    source_id: ctx.sourceId || null,
    message_preview: message.slice(0, 200),
    channel: 'whatsapp',
    status: 'pending',
    sent_by: 'automation',
    batch_id: `auto-${new Date().toISOString().split('T')[0]}`,
  })

  if (error) {
    return { success: false, detail: error.message }
  }

  return { success: true, detail: `Reminder created: ${rule.template_key}` }
}

// ── Main Dispatcher ──────────────────────────────────────────────

/**
 * Process an automation trigger.
 *
 * Call this from anywhere in the app when a clinical event occurs.
 * It will:
 *   1. Load matching rules for the trigger
 *   2. Execute each rule's action
 *   3. Return a result summary
 *
 * This function is NON-BLOCKING and NON-FATAL:
 * - Errors in one rule don't prevent others from executing
 * - The caller should not await this if the main flow shouldn't be blocked
 *
 * @param trigger - The event type that occurred
 * @param context - Event data (patient info, dates, amounts, etc.)
 */
export async function processAutomation(
  trigger: AutomationTrigger,
  context: AutomationContext
): Promise<AutomationResult> {
  const result: AutomationResult = {
    trigger,
    actionsExecuted: 0,
    actionsSkipped: 0,
    errors: [],
    details: [],
  }

  try {
    const rules = await loadRules(trigger)

    if (rules.length === 0) {
      return result
    }

    for (const rule of rules) {
      try {
        // Check conditions (if any)
        if (rule.conditions) {
          const conditionsMet = evaluateConditions(rule.conditions, context)
          if (!conditionsMet) {
            result.actionsSkipped++
            result.details.push({
              action: rule.action,
              status: 'skipped',
              detail: 'Conditions not met',
            })
            continue
          }
        }

        // Execute the action
        let actionResult: { success: boolean; detail?: string }

        switch (rule.action) {
          case 'queue_whatsapp':
            actionResult = await executeQueueWhatsApp(rule, context)
            break
          case 'send_notification':
            actionResult = await executeSendNotification(rule, context)
            break
          case 'create_reminder':
            actionResult = await executeCreateReminder(rule, context)
            break
          case 'auto_queue':
            // Auto-queue is handled by the queue page itself
            actionResult = { success: true, detail: 'Auto-queue delegated' }
            break
          default:
            actionResult = { success: false, detail: `Unknown action: ${rule.action}` }
        }

        if (actionResult.success) {
          result.actionsExecuted++
          result.details.push({
            action: rule.action,
            status: 'success',
            detail: actionResult.detail,
          })
        } else {
          result.errors.push(actionResult.detail || 'Unknown error')
          result.details.push({
            action: rule.action,
            status: 'error',
            detail: actionResult.detail,
          })
        }
      } catch (ruleErr: any) {
        result.errors.push(`Rule ${rule.id}: ${ruleErr.message}`)
        result.details.push({
          action: rule.action,
          status: 'error',
          detail: ruleErr.message,
        })
      }
    }
  } catch (err: any) {
    result.errors.push(`Engine error: ${err.message}`)
  }

  return result
}

// ── Condition Evaluator ──────────────────────────────────────────

/**
 * Evaluate rule conditions against the current context.
 * Supports simple key-value matching and basic operators.
 *
 * Example conditions:
 *   { "type": "ANC Follow-up" }           → only trigger for ANC appointments
 *   { "amount_gt": 1000 }                 → only for bills > ₹1000
 *   { "ward": "ICU" }                     → only for ICU admissions
 */
function evaluateConditions(
  conditions: Record<string, any>,
  context: AutomationContext
): boolean {
  for (const [key, expected] of Object.entries(conditions)) {
    // Operator-based conditions
    if (key.endsWith('_gt')) {
      const field = key.replace('_gt', '') as keyof AutomationContext
      const actual = Number(context[field] || 0)
      if (actual <= Number(expected)) return false
      continue
    }
    if (key.endsWith('_lt')) {
      const field = key.replace('_lt', '') as keyof AutomationContext
      const actual = Number(context[field] || 0)
      if (actual >= Number(expected)) return false
      continue
    }
    if (key.endsWith('_in')) {
      const field = key.replace('_in', '') as keyof AutomationContext
      const actual = String(context[field] || '')
      if (!Array.isArray(expected) || !expected.includes(actual)) return false
      continue
    }

    // Direct equality check
    const actual = (context as Record<string, any>)[key]
    if (actual !== expected) return false
  }

  return true
}

// ── Convenience Helpers ──────────────────────────────────────────

/**
 * Fire-and-forget automation (non-blocking).
 * Use this when you don't need the result.
 */
export function fireAutomation(trigger: AutomationTrigger, context: AutomationContext): void {
  processAutomation(trigger, context).catch(err => {
    console.warn(`[automation-engine] Fire-and-forget error for ${trigger}:`, err?.message)
  })
}

/**
 * Check if automation is configured for a specific trigger.
 * Useful for UI indicators (e.g., "WhatsApp will be sent automatically").
 */
export async function isAutomationEnabled(trigger: AutomationTrigger): Promise<boolean> {
  const rules = await loadRules(trigger)
  return rules.length > 0
}

/**
 * Get all configured automation rules (for settings display).
 */
export async function getAllRules(): Promise<AutomationRule[]> {
  try {
    const { data, error } = await supabase
      .from('automation_rules')
      .select('*')
      .order('trigger')
      .order('priority', { ascending: true })

    if (error || !data) {
      return DEFAULT_RULES.map((r, i) => ({ ...r, id: `default-${i}` }))
    }

    return data as AutomationRule[]
  } catch {
    return DEFAULT_RULES.map((r, i) => ({ ...r, id: `default-${i}` }))
  }
}
