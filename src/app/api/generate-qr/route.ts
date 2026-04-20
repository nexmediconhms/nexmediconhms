import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const url   = searchParams.get('url') || ''
  const size  = parseInt(searchParams.get('size') || '300')

  if (!url) {
    return NextResponse.json({ error: 'url param required' }, { status: 400 })
  }

  try {
    // Generate QR as PNG buffer
    const buffer = await QRCode.toBuffer(url, {
      type:           'png',
      width:          Math.min(size, 600),
      margin:         2,
      color:          { dark: '#1e40af', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    })

    return new NextResponse(buffer, {
      headers: {
        'Content-Type':  'image/png',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
