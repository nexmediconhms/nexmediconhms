/**
 * FILE: src/lib/pdf-download-helper.ts
 *
 * ISSUE #7 FIX (CLIENT SIDE): PDF Download Helper
 *
 * When the email API returns `method: 'download'` or `method: 'email_failed'`,
 * this helper converts the response into a downloadable PDF file.
 *
 * HOW TO USE:
 *   In the component that calls the email API (e.g., CAReportSection),
 *   after receiving the response:
 *
 *   import { handleEmailResponse } from '@/lib/pdf-download-helper'
 *
 *   const result = await fetch('/api/billing/send-email', { ... }).then(r => r.json())
 *   handleEmailResponse(result)
 *
 * WHAT THIS DOES NOT CHANGE:
 *   - Does not modify any existing components
 *   - Does not change the API response format
 */

export interface EmailAPIResponse {
  success: boolean
  method: 'email' | 'download' | 'email_failed' | 'client_fallback'
  message: string
  pdfBase64?: string | null
  pdfHtml?: string | null
  fileName?: string
  emailId?: string
  mailtoUrl?: string  // from old API — now unused
}

/**
 * Handle the response from /api/billing/send-email
 *
 * If the email was sent successfully, shows a success message.
 * If it returns a PDF for download, triggers the browser download.
 */
export function handleEmailResponse(result: EmailAPIResponse): {
  success: boolean
  message: string
  emailSent: boolean
} {
  // Case 1: Email sent successfully
  if (result.method === 'email' && result.success) {
    return {
      success: true,
      message: result.message || 'Email sent successfully!',
      emailSent: true,
    }
  }

  // Case 2: PDF available for download (either base64 or HTML)
  if (result.pdfBase64) {
    downloadBase64PDF(result.pdfBase64, result.fileName || 'Revenue-Report.pdf')
    return {
      success: true,
      message: result.message || 'PDF downloaded.',
      emailSent: false,
    }
  }

  if (result.pdfHtml) {
    downloadHtmlAsPrintable(result.pdfHtml, result.fileName || 'Revenue-Report.html')
    return {
      success: true,
      message: (result.message || 'Report downloaded.') +
        ' Open the file and use Ctrl+P / Cmd+P to save as PDF.',
      emailSent: false,
    }
  }

  // Case 3: Something went wrong
  return {
    success: false,
    message: result.message || 'Failed to generate report.',
    emailSent: false,
  }
}

/**
 * Download a base64-encoded PDF file
 */
function downloadBase64PDF(base64: string, fileName: string) {
  try {
    const byteCharacters = atob(base64)
    const byteArray = new Uint8Array(byteCharacters.length)
    for (let i = 0; i < byteCharacters.length; i++) {
      byteArray[i] = byteCharacters.charCodeAt(i)
    }
    const blob = new Blob([byteArray], { type: 'application/pdf' })
    triggerDownload(blob, fileName)
  } catch (err) {
    console.error('[pdf-download] Base64 decode failed:', err)
  }
}

/**
 * Download HTML content as a printable file
 * (Fallback when jsPDF is not available on server)
 */
function downloadHtmlAsPrintable(html: string, fileName: string) {
  const blob = new Blob([html], { type: 'text/html' })
  triggerDownload(blob, fileName)
}

/**
 * Trigger browser download
 */
function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Revoke after a short delay to ensure download starts
  setTimeout(() => URL.revokeObjectURL(url), 3000)
}