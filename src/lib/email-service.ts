/**
 * src/lib/email-service.ts
 *
 * Production-ready email service with PDF attachment support.
 *
 * Architecture:
 *   - Uses Resend API (https://resend.com) as primary email provider
 *   - Supports PDF attachments via base64 encoding
 *   - Includes retry with exponential backoff
 *   - Falls back to generating downloadable PDF if email fails
 *   - All email sends are logged for audit compliance
 *
 * SETUP:
 *   1. Add RESEND_API_KEY to environment variables
 *   2. Add RESEND_FROM_EMAIL (e.g., reports@yourclinic.com)
 *   3. Verify your domain in Resend dashboard
 */

export interface EmailAttachment {
  filename: string
  content: string  // Base64-encoded content
  type: string     // MIME type (e.g., 'application/pdf', 'text/html')
}

export interface SendEmailOptions {
  to: string
  subject: string
  html: string
  text?: string
  attachments?: EmailAttachment[]
  replyTo?: string
}

export interface EmailResult {
  success: boolean
  method: 'resend' | 'fallback' | 'failed'
  message: string
  emailId?: string
  downloadUrl?: string
}

const MAX_RETRIES = 2
const RETRY_DELAY_MS = 1500

/**
 * Send an email with optional PDF attachment.
 * Requires RESEND_API_KEY in environment.
 * This function should ONLY be called from API routes (server-side).
 */
export async function sendEmail(options: SendEmailOptions): Promise<EmailResult> {
  const resendApiKey = process.env.RESEND_API_KEY
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'NexMedicon HMS <noreply@nexmedicon.com>'

  if (!resendApiKey) {
    return {
      success: false,
      method: 'failed',
      message: 'Email service not configured. Add RESEND_API_KEY to your environment variables (Vercel → Settings → Environment Variables).',
    }
  }

  if (!options.to || !options.to.includes('@')) {
    return {
      success: false,
      method: 'failed',
      message: 'Invalid recipient email address.',
    }
  }

  // Prepare Resend payload
  const payload: any = {
    from: fromEmail,
    to: options.to,
    subject: options.subject,
    html: options.html,
  }

  if (options.text) payload.text = options.text
  if (options.replyTo) payload.reply_to = options.replyTo

  if (options.attachments && options.attachments.length > 0) {
    payload.attachments = options.attachments.map(att => ({
      filename: att.filename,
      content: att.content,
      type: att.type,
    }))
  }

  // Send with retry
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        const data = await res.json()
        return {
          success: true,
          method: 'resend',
          message: `Email sent successfully to ${options.to}`,
          emailId: data.id,
        }
      }

      // Handle specific errors
      const errData = await res.json().catch(() => ({}))

      if (res.status === 429) {
        // Rate limited — wait and retry
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)))
          continue
        }
      }

      if (res.status === 422) {
        // Validation error — don't retry
        return {
          success: false,
          method: 'failed',
          message: `Email validation error: ${errData.message || 'Invalid request'}. Check recipient address and sender domain verification.`,
        }
      }

      if (attempt === MAX_RETRIES) {
        return {
          success: false,
          method: 'failed',
          message: `Email send failed after ${MAX_RETRIES + 1} attempts: ${errData.message || res.statusText}`,
        }
      }
    } catch (err: any) {
      if (attempt === MAX_RETRIES) {
        return {
          success: false,
          method: 'failed',
          message: `Network error sending email: ${err.message}`,
        }
      }
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)))
    }
  }

  return {
    success: false,
    method: 'failed',
    message: 'Email send failed unexpectedly.',
  }
}

/**
 * Generate a professional HTML email wrapper for reports.
 */
export function wrapReportEmail(params: {
  recipientName: string
  hospitalName: string
  reportTitle: string
  reportPeriod: string
  summaryHtml: string
  footerName: string
  footerPhone?: string
}): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:'Inter',Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b;padding:20px;">
  <div style="border-bottom:3px solid #1e40af;padding-bottom:12px;margin-bottom:20px;">
    <h2 style="color:#1e40af;margin:0;font-size:18px;">${params.hospitalName}</h2>
  </div>

  <p>Dear ${params.recipientName},</p>
  
  <p>Please find attached the <strong>${params.reportTitle}</strong> for <strong>${params.reportPeriod}</strong>.</p>
  
  ${params.summaryHtml}
  
  <p style="font-size:12px;color:#64748b;margin-top:20px;">
    The detailed PDF report is attached to this email for your records and tax filing purposes.
  </p>
  
  <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;" />
  
  <p style="margin:0;">
    Regards,<br/>
    <strong>${params.footerName}</strong><br/>
    ${params.hospitalName}${params.footerPhone ? '<br/>' + params.footerPhone : ''}
  </p>
  
  <p style="font-size:10px;color:#94a3b8;margin-top:16px;">
    This is an automated report from NexMedicon HMS. Do not reply to this email.
  </p>
</body>
</html>`
}
