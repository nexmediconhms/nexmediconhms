import { NextResponse } from 'next/server'

export async function GET() {
  const anthropicKey = process.env.ANTHROPIC_API_KEY ?? ''
  const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const razorpayKey  = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? ''

  const anthropicOk = anthropicKey.length > 20 && !anthropicKey.includes('YOUR') && anthropicKey.startsWith('sk-ant-')
  const supabaseOk  = supabaseUrl.startsWith('https://') && !supabaseUrl.includes('YOUR_PROJECT_ID')
  const razorpayOk  = razorpayKey.length > 10 && !razorpayKey.includes('YOUR_KEY_HERE')

  return NextResponse.json({ anthropicOk, supabaseOk, razorpayOk })
}
