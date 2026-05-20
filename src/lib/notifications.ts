/**
 * src/lib/notifications.ts
 *
 * Centralized Notification Helper
 *
 * Provides a simple API to create notifications from anywhere in the app.
 * All notifications are sent to /api/notifications which inserts into
 * the clinic_notifications table.
 *
 * Usage:
 *   import { notify } from '@/lib/notifications'
 *   await notify.patientRegistered(patientId, patientName, mrn)
 *   await notify.appointmentCreated(patientId, patientName, date, time)
 *   await notify.billCreated(patientId, patientName, amount)
 *   await notify.ipdAdmission(patientId, patientName, bedNumber)
 *   await notify.discharge(patientId, patientName)
 *   await notify.labReportUploaded(patientId, patientName, testName)
 *   await notify.custom({ title, message, type, ... })
 */

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
 * Send a notification to the notification center.
 * Non-blocking — failures are silently logged.
 */
async function sendNotification(payload: NotificationPayload): Promise<void> {
  try {
    await fetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        type: payload.type || 'info',
        severity: payload.severity || 'normal',
        target_roles: payload.target_roles || ['admin', 'doctor', 'staff'],
      }),
    })
  } catch {
    // Non-fatal — notification failure should never block user actions
    console.warn('[Notifications] Failed to send notification:', payload.title)
  }
}

export const notify = {
  /**
   * Send a custom notification with full control over all fields.
   */
  custom: sendNotification,

  /**
   * Patient registered
   */
  patientRegistered: (patientId: string, patientName: string, mrn: string) =>
    sendNotification({
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

  /**
   * Appointment created
   */
  appointmentCreated: (patientId: string, patientName: string, date: string, time: string, type?: string) =>
    sendNotification({
      title: 'New Appointment Scheduled',
      message: `${patientName} — ${type || 'OPD'} on ${date} at ${time}`,
      type: 'appointment',
      source: 'appointments',
      entity_type: 'appointment',
      patient_id: patientId,
      patient_name: patientName,
      metadata: { date, time, apptType: type },
    }),

  /**
   * Appointment cancelled
   */
  appointmentCancelled: (patientId: string, patientName: string, date: string) =>
    sendNotification({
      title: 'Appointment Cancelled',
      message: `${patientName}'s appointment on ${date} has been cancelled.`,
      type: 'appointment',
      severity: 'normal',
      source: 'appointments',
      entity_type: 'appointment',
      patient_id: patientId,
      patient_name: patientName,
    }),

  /**
   * OPD consultation saved
   */
  opdConsultationSaved: (patientId: string, patientName: string, diagnosis?: string) =>
    sendNotification({
      title: 'OPD Consultation Completed',
      message: `${patientName}${diagnosis ? ` — ${diagnosis}` : ''} consultation recorded.`,
      type: 'info',
      source: 'opd',
      entity_type: 'encounter',
      patient_id: patientId,
      patient_name: patientName,
      metadata: { diagnosis },
    }),

  /**
   * Bill created
   */
  billCreated: (patientId: string, patientName: string, amount: number, invoiceNumber?: string) =>
    sendNotification({
      title: 'New Bill Generated',
      message: `${patientName} — ₹${amount.toLocaleString('en-IN')}${invoiceNumber ? ` (${invoiceNumber})` : ''}`,
      type: 'billing',
      source: 'billing',
      entity_type: 'bill',
      patient_id: patientId,
      patient_name: patientName,
      metadata: { amount, invoiceNumber },
    }),

  /**
   * Payment received
   */
  paymentReceived: (patientId: string, patientName: string, amount: number, method: string) =>
    sendNotification({
      title: 'Payment Received',
      message: `₹${amount.toLocaleString('en-IN')} from ${patientName} via ${method}`,
      type: 'billing',
      source: 'billing',
      entity_type: 'bill',
      patient_id: patientId,
      patient_name: patientName,
      metadata: { amount, method },
    }),

  /**
   * IPD admission
   */
  ipdAdmission: (patientId: string, patientName: string, bedNumber: string, ward: string) =>
    sendNotification({
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

  /**
   * Patient discharged
   */
  discharge: (patientId: string, patientName: string, bedNumber?: string) =>
    sendNotification({
      title: 'Patient Discharged',
      message: `${patientName} has been discharged${bedNumber ? ` from Bed ${bedNumber}` : ''}.`,
      type: 'discharge',
      severity: 'normal',
      source: 'ipd',
      entity_type: 'discharge',
      patient_id: patientId,
      patient_name: patientName,
      metadata: { bedNumber },
    }),

  /**
   * Lab report uploaded
   */
  labReportUploaded: (patientId: string, patientName: string, testName?: string) =>
    sendNotification({
      title: 'Lab Report Uploaded',
      message: `${patientName}${testName ? ` — ${testName}` : ''} report is ready.`,
      type: 'lab_report',
      severity: 'normal',
      source: 'lab_portal',
      entity_type: 'lab_report',
      patient_id: patientId,
      patient_name: patientName,
      metadata: { testName },
    }),

  /**
   * Insurance claim status change
   */
  insuranceUpdate: (patientId: string, patientName: string, status: string) =>
    sendNotification({
      title: 'Insurance Claim Update',
      message: `${patientName} — Claim status: ${status}`,
      type: 'insurance',
      source: 'insurance',
      entity_type: 'insurance',
      patient_id: patientId,
      patient_name: patientName,
      target_roles: ['admin', 'staff'],
      metadata: { status },
    }),

  /**
   * OPD Queue update
   */
  queueUpdate: (patientName: string, tokenNumber: number, action: 'added' | 'called' | 'done') =>
    sendNotification({
      title: action === 'added' ? 'Patient Added to Queue'
        : action === 'called' ? 'Patient Called'
        : 'Consultation Done',
      message: `Token #${tokenNumber} — ${patientName}${action === 'called' ? ' is being called' : action === 'done' ? ' consultation completed' : ' added to OPD queue'}`,
      type: 'info',
      source: 'opd_queue',
      entity_type: 'queue',
      patient_name: patientName,
      metadata: { tokenNumber, action },
    }),

  /**
   * System alert (generic)
   */
  systemAlert: (title: string, message: string, severity: Severity = 'normal') =>
    sendNotification({
      title,
      message,
      type: 'system',
      severity,
      source: 'system',
      target_roles: ['admin'],
    }),
}

export default notify
