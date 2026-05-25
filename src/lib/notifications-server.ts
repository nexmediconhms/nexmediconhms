/**
 * src/lib/notifications-server.ts
 *
 * BUG #18 FIX: Notifications Fail Server-Side (Relative URL)
 *
 * PROBLEM: notifications.ts uses fetch('/api/notifications') with a relative
 * URL. This only works in browser context. Server-side API routes and cron
 * jobs have no origin, so the relative URL fails silently.
 *
 * SOLUTION: This module provides a server-safe notification sender that:
 *   1. Inserts directly into the clinic_notifications table via Supabase
 *   2. Does NOT depend on HTTP fetch to /api/notifications
 *   3. Works identically from API routes, cron jobs, and webhooks
 *
 * USAGE (in API routes):
 *   import { notifyServer } from '@/lib/notifications-server'
 *   await notifyServer.billCreated(patientId, patientName, amount, invoiceNumber)
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

function getClient() {
  return createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
}

type NotificationType = 'info' | 'lab_report' | 'discharge' | 'billing' | 'appointment' | 'insurance' | 'system'
type Severity = 'normal' | 'high' | 'critical'

interface NotificationPayload {
  title: string
  message: string
  type?: NotificationType
  severity?: Severity
  source?: string
  entity_type?: string
  entity_id?: string
  patient_id?: string
  patient_name?: string
  mrn?: string
  target_roles?: string[]
  metadata?: Record<string, unknown>
}

/**
 * Send a notification by inserting directly into the database.
 * Works from both server-side and client-side contexts.
 */
async function sendNotificationDirect(payload: NotificationPayload): Promise<void> {
  try {
    const supabase = getClient()
    await supabase.from('clinic_notifications').insert({
      title: payload.title,
      message: payload.message,
      type: payload.type || 'info',
      severity: payload.severity || 'normal',
      source: payload.source || 'system',
      entity_type: payload.entity_type || null,
      entity_id: payload.entity_id || null,
      patient_id: payload.patient_id || null,
      patient_name: payload.patient_name || null,
      mrn: payload.mrn || null,
      target_roles: payload.target_roles || ['admin', 'doctor', 'staff'],
      metadata: payload.metadata ? JSON.stringify(payload.metadata) : null,
      is_read: false,
      created_at: new Date().toISOString(),
    })
  } catch (err) {
    console.warn('[notifications-server] Failed to send:', payload.title, err)
  }
}

export const notifyServer = {
  custom: sendNotificationDirect,

  patientRegistered: (patientId: string, patientName: string, mrn: string) =>
    sendNotificationDirect({
      title: 'New Patient Registered',
      message: `${patientName} (MRN: ${mrn}) has been registered.`,
      type: 'info',
      source: 'patient_registration',
      entity_type: 'patient',
      entity_id: patientId,
      patient_id: patientId,
      patient_name: patientName,
      mrn,
    }),

  appointmentCreated: (patientId: string, patientName: string, date: string, time: string, type?: string) =>
    sendNotificationDirect({
      title: 'New Appointment Scheduled',
      message: `${patientName} — ${type || 'OPD'} on ${date} at ${time}`,
      type: 'appointment',
      source: 'appointments',
      entity_type: 'appointment',
      patient_id: patientId,
      patient_name: patientName,
      metadata: { date, time, apptType: type },
    }),

  billCreated: (patientId: string, patientName: string, amount: number, invoiceNumber?: string) =>
    sendNotificationDirect({
      title: 'New Bill Generated',
      message: `${patientName} — ₹${amount.toLocaleString('en-IN')}${invoiceNumber ? ` (${invoiceNumber})` : ''}`,
      type: 'billing',
      source: 'billing',
      entity_type: 'bill',
      patient_id: patientId,
      patient_name: patientName,
      metadata: { amount, invoiceNumber },
    }),

  paymentReceived: (patientId: string, patientName: string, amount: number, method: string) =>
    sendNotificationDirect({
      title: 'Payment Received',
      message: `₹${amount.toLocaleString('en-IN')} from ${patientName} via ${method}`,
      type: 'billing',
      source: 'billing',
      entity_type: 'bill',
      patient_id: patientId,
      patient_name: patientName,
      metadata: { amount, method },
    }),

  paymentVerificationNeeded: (patientId: string, patientName: string, amount: number, txnId?: string) =>
    sendNotificationDirect({
      title: 'Payment Verification Needed',
      message: `${patientName} claims payment of ₹${amount.toLocaleString('en-IN')}. Txn: ${txnId || 'N/A'}. Verify in bank statement.`,
      type: 'billing',
      severity: 'high',
      source: 'portal_payment',
      entity_type: 'bill',
      patient_id: patientId,
      patient_name: patientName,
      target_roles: ['admin', 'staff'],
      metadata: { amount, txnId },
    }),

  ipdAdmission: (patientId: string, patientName: string, bedNumber: string, ward: string) =>
    sendNotificationDirect({
      title: 'Patient Admitted (IPD)',
      message: `${patientName} admitted to Bed ${bedNumber} (${ward})`,
      type: 'info',
      severity: 'high',
      source: 'ipd',
      entity_type: 'bed',
      patient_id: patientId,
      patient_name: patientName,
      metadata: { bedNumber, ward },
    }),

  discharge: (patientId: string, patientName: string, bedNumber?: string) =>
    sendNotificationDirect({
      title: 'Patient Discharged',
      message: `${patientName} has been discharged${bedNumber ? ` from Bed ${bedNumber}` : ''}.`,
      type: 'discharge',
      source: 'ipd',
      entity_type: 'discharge',
      patient_id: patientId,
      patient_name: patientName,
      metadata: { bedNumber },
    }),

  labReportUploaded: (patientId: string, patientName: string, testName?: string) =>
    sendNotificationDirect({
      title: 'Lab Report Uploaded',
      message: `${patientName}${testName ? ` — ${testName}` : ''} report is ready.`,
      type: 'lab_report',
      source: 'lab_portal',
      entity_type: 'lab_report',
      patient_id: patientId,
      patient_name: patientName,
      metadata: { testName },
    }),

  systemAlert: (title: string, message: string, severity: Severity = 'normal') =>
    sendNotificationDirect({
      title,
      message,
      type: 'system',
      severity,
      source: 'system',
      target_roles: ['admin'],
    }),
}

export default notifyServer