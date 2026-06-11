/**
 * src/app/api/billing/gst-export/route.ts
 *
 * GST Return Export API (GSTR-1 Format)
 *
 * GET /api/billing/gst-export?from=YYYY-MM-DD&to=YYYY-MM-DD
 *   Returns GST data in GSTR-1 compatible format for the given period.
 *   Includes: B2C supply summary, HSN-wise summary, credit note adjustments.
 *
 * GET /api/billing/gst-export?from=...&to=...&format=csv
 *   Returns CSV format for direct import into GST portal / Tally.
 *
 * Auth: admin only
 * ADDITIVE — new route.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireRole } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  // Admin-only for GST export
  const roleCheck = await requireRole(req, 'admin')
  if (roleCheck instanceof Response) return roleCheck

  const params = req.nextUrl.searchParams
  const fromDate = params.get('from')
  const toDate = params.get('to')
  const format = params.get('format') || 'json'

  if (!fromDate || !toDate) {
    return NextResponse.json({ error: 'from and to dates are required' }, { status: 400 })
  }

  const sb = getSupabaseAdmin()

  // 1. Load all paid bills in the period
  const { data: bills } = await sb
    .from('bills')
    .select('*')
    .eq('is_deleted', false)
    .neq('status', 'cancelled')
    .gte('created_at', fromDate + 'T00:00:00+05:30')
    .lte('created_at', toDate + 'T23:59:59+05:30')
    .order('created_at', { ascending: true })
    .limit(2000)

  // 2. Load credit notes in the period
  let creditNotes: any[] = []
  try {
    const { data: cns } = await sb
      .from('credit_notes')
      .select('*')
      .eq('is_deleted', false)
      .gte('created_at', fromDate + 'T00:00:00+05:30')
      .lte('created_at', toDate + 'T23:59:59+05:30')
      .order('created_at', { ascending: true })
    creditNotes = cns || []
  } catch { /* table may not exist */ }

  // 3. Aggregate B2C supplies (unregistered — typical for clinic patients)
  let totalTaxableValue = 0
  let totalCGST = 0
  let totalSGST = 0
  let totalIGST = 0
  let totalInvoiceValue = 0
  let totalExempt = 0
  let invoiceCount = 0

  const monthWise: Record<string, {
    count: number, taxable: number, cgst: number, sgst: number, total: number, exempt: number
  }> = {}

  const gstRateWise: Record<string, {
    count: number, taxable: number, cgst: number, sgst: number, total: number
  }> = {}

  for (const bill of (bills || [])) {
    const netAmount = Number(bill.net_amount || bill.total || 0)
    const gstAmount = Number(bill.gst_amount || 0)
    const gstPercent = Number(bill.gst_percent || 0)

    if (netAmount <= 0) continue

    invoiceCount++
    const taxableValue = gstPercent > 0 ? round2(netAmount - gstAmount) : netAmount
    const cgst = round2(gstAmount / 2)
    const sgst = round2(gstAmount / 2)

    if (gstPercent === 0) {
      totalExempt += netAmount
    } else {
      totalTaxableValue += taxableValue
      totalCGST += cgst
      totalSGST += sgst
    }
    totalInvoiceValue += netAmount

    // Month-wise grouping
    const month = (bill.created_at || '').slice(0, 7)
    if (!monthWise[month]) monthWise[month] = { count: 0, taxable: 0, cgst: 0, sgst: 0, total: 0, exempt: 0 }
    monthWise[month].count++
    monthWise[month].total += netAmount
    if (gstPercent === 0) {
      monthWise[month].exempt += netAmount
    } else {
      monthWise[month].taxable += taxableValue
      monthWise[month].cgst += cgst
      monthWise[month].sgst += sgst
    }

    // GST rate wise
    const rateKey = `${gstPercent}%`
    if (!gstRateWise[rateKey]) gstRateWise[rateKey] = { count: 0, taxable: 0, cgst: 0, sgst: 0, total: 0 }
    gstRateWise[rateKey].count++
    gstRateWise[rateKey].taxable += taxableValue
    gstRateWise[rateKey].cgst += cgst
    gstRateWise[rateKey].sgst += sgst
    gstRateWise[rateKey].total += netAmount
  }

  // 4. Credit note summary
  let cnTotalAmount = 0
  let cnTotalGST = 0
  let cnTotalCGST = 0
  let cnTotalSGST = 0

  for (const cn of creditNotes) {
    cnTotalAmount += Number(cn.amount || 0)
    cnTotalGST += Number(cn.gst_amount || 0)
    cnTotalCGST += Number(cn.cgst || 0)
    cnTotalSGST += Number(cn.sgst || 0)
  }

  // Round all aggregates
  for (const key of Object.keys(monthWise)) {
    const m = monthWise[key]
    m.taxable = round2(m.taxable)
    m.cgst = round2(m.cgst)
    m.sgst = round2(m.sgst)
    m.total = round2(m.total)
    m.exempt = round2(m.exempt)
  }
  for (const key of Object.keys(gstRateWise)) {
    const r = gstRateWise[key]
    r.taxable = round2(r.taxable)
    r.cgst = round2(r.cgst)
    r.sgst = round2(r.sgst)
    r.total = round2(r.total)
  }

  const result = {
    period: { from: fromDate, to: toDate },
    summary: {
      total_invoices: invoiceCount,
      total_invoice_value: round2(totalInvoiceValue),
      total_taxable_value: round2(totalTaxableValue),
      total_exempt_value: round2(totalExempt),
      total_cgst: round2(totalCGST),
      total_sgst: round2(totalSGST),
      total_igst: round2(totalIGST),
      total_gst: round2(totalCGST + totalSGST),
      net_gst_payable: round2(totalCGST + totalSGST - cnTotalGST),
    },
    credit_notes: {
      count: creditNotes.length,
      total_amount: round2(cnTotalAmount),
      total_gst_reversal: round2(cnTotalGST),
      total_cgst: round2(cnTotalCGST),
      total_sgst: round2(cnTotalSGST),
    },
    month_wise: monthWise,
    rate_wise: gstRateWise,
    hsn_summary: {
      '9993': {
        description: 'Human health services',
        taxable: round2(totalTaxableValue),
        cgst: round2(totalCGST),
        sgst: round2(totalSGST),
        total: round2(totalCGST + totalSGST),
      },
    },
    note: 'Most medical/healthcare services are GST-exempt in India (HSN 9993). Only cosmetic/non-medical services attract GST.',
    generated_at: new Date().toISOString(),
  }

  if (format === 'csv') {
    // Generate CSV for Tally/GST portal import
    const lines = [
      'Period,Total Invoices,Taxable Value,CGST,SGST,Total GST,Exempt Value,Invoice Total',
    ]

    for (const [month, data] of Object.entries(monthWise)) {
      lines.push(`${month},${data.count},${data.taxable},${data.cgst},${data.sgst},${round2(data.cgst + data.sgst)},${data.exempt},${data.total}`)
    }

    lines.push('')
    lines.push(`Total,${invoiceCount},${round2(totalTaxableValue)},${round2(totalCGST)},${round2(totalSGST)},${round2(totalCGST + totalSGST)},${round2(totalExempt)},${round2(totalInvoiceValue)}`)

    if (creditNotes.length > 0) {
      lines.push('')
      lines.push('Credit Notes')
      lines.push('CN Number,Date,Amount,GST Reversal,CGST,SGST,Reason')
      for (const cn of creditNotes) {
        lines.push(`${cn.credit_note_number},${(cn.created_at || '').slice(0, 10)},${cn.amount},${cn.gst_amount},${cn.cgst},${cn.sgst},"${(cn.reason || '').replace(/"/g, '""')}"`)
      }
    }

    return new NextResponse(lines.join('\n'), {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="GST_Export_${fromDate}_to_${toDate}.csv"`,
      },
    })
  }

  return NextResponse.json(result)
}