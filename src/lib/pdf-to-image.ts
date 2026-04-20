/**
 * Client-side PDF → PNG conversion using pdfjs-dist + browser Canvas API.
 *
 * Works on Vercel because:
 * - pdfjs-dist is loaded in the browser (not the server)
 * - The browser has a native Canvas API — no node-canvas needed
 * - The resulting PNG is sent to /api/ocr for AI vision processing
 *
 * Usage: import in a 'use client' component only.
 */

/**
 * Render the first page of a PDF to a PNG data URL.
 * Returns null if rendering fails.
 */
export async function pdfFirstPageToImageDataUrl(
  pdfBuffer: ArrayBuffer,
  scale = 2.0          // 2x = ~150dpi — good balance of quality vs size
): Promise<string | null> {
  try {
    // Dynamic import so this never runs server-side
    const pdfjs = await import('pdfjs-dist')

    // Point worker at the CDN copy (avoids bundler issues with workers)
    pdfjs.GlobalWorkerOptions.workerSrc =
      `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`

    const pdf = await pdfjs.getDocument({ data: pdfBuffer }).promise
    const page = await pdf.getPage(1)

    const viewport = page.getViewport({ scale })

    // Use OffscreenCanvas if available (modern browsers), fall back to regular canvas
    let canvas: HTMLCanvasElement | OffscreenCanvas
    let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null

    if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(viewport.width, viewport.height)
      ctx    = canvas.getContext('2d')
    } else {
      canvas        = document.createElement('canvas')
      canvas.width  = viewport.width
      canvas.height = viewport.height
      ctx           = (canvas as HTMLCanvasElement).getContext('2d')
    }

    if (!ctx) return null

    // pdfjs-dist v5+ requires canvas property in RenderParameters
    const renderCtx: any = { canvasContext: ctx, viewport }
    if (!(canvas instanceof OffscreenCanvas)) {
      renderCtx.canvas = canvas as HTMLCanvasElement
    }
    await page.render(renderCtx).promise

    // Convert to PNG data URL
    if (canvas instanceof OffscreenCanvas) {
      const blob = await canvas.convertToBlob({ type: 'image/png' })
      return new Promise(resolve => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => resolve(null)
        reader.readAsDataURL(blob)
      })
    } else {
      return (canvas as HTMLCanvasElement).toDataURL('image/png')
    }
  } catch (err: any) {
    console.warn('[pdf-to-image]', err?.message)
    return null
  }
}

/**
 * Convert a PDF File to a PNG File that can be sent to /api/ocr.
 * Returns null if the PDF cannot be rendered (e.g., encrypted PDF).
 */
export async function pdfToPngFile(pdfFile: File): Promise<File | null> {
  const buffer  = await pdfFile.arrayBuffer()
  const dataUrl = await pdfFirstPageToImageDataUrl(buffer)
  if (!dataUrl) return null

  // dataUrl = "data:image/png;base64,XXXX"
  const base64 = dataUrl.split(',')[1]
  const bytes   = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
  const blob    = new Blob([bytes], { type: 'image/png' })

  // Name it with today's date for the DoctorNote naming convention
  const today = new Date()
  const dd    = String(today.getDate()).padStart(2, '0')
  const mm    = String(today.getMonth() + 1).padStart(2, '0')
  const yy    = String(today.getFullYear()).slice(-2)
  return new File([blob], `scanned_${dd}_${mm}_${yy}.png`, { type: 'image/png' })
}
