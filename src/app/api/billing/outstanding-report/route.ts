/**
 * src/app/api/billing/outstanding-report/route.ts
 *
 * Outstanding & Aging Report API
 *
 * GET /api/billing/outstanding-report
 *   Returns all bills with outstanding balances, grouped by aging buckets.
 *   Query params:
 *     module    — OPD | IPD | all (default: all)
 *     from      — date range start
 *     to        — date range end
 *     limit     — max results (default 200)
 *
 * GET /api/billing/outstanding-report?summary=true
 *   Returns aggregate summary only (for dashboard widgets).
 *
 * ADDITIVE — new route, no changes to existing code.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-auth'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface OutstandingBill {
  id: string
  invoice_number: string
  patient_id: string
  patient_name: string
  mrn: string
  bill_date: string
  total: number
  paid: number
  due: number
  status: string
  module: string
  days_overdue: number
  aging_bucket: string
}

function getAgingBucket(days: number): string {
  if (days <= 0) return 'current'
  if (days <= 7) return '1-7 days'
  if (days <= 15) return '8-15 days'
  if (days <= 30) return '16-30 days'
  if (days <= 60) return '31-60 days'
  if (days <= 90) return '61-90 days'
  return '90+ days'
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (auth instanceof Response) return auth

  const params = req.nextUrl.searchParams
  const module = params.get('module') || 'all'
  const fromDate = params.get('from')
  const toDate = params.get('to')
  const summaryOnly = params.get('summary') === 'true'
  const limit = Math.min(Number(params.get('limit')) || 200, 500)

  const sb = getSupabaseAdmin()
  const now = new Date()

  // Load all bills with outstanding amounts
  let query = sb
    .from('bills')
    .select('id, invoice_number, invoicenumber, patient_id, patientid, net_amount, total, paid, due, status, bill_module, created_at, createdat, items')
    .eq('is_deleted', false)
    .in('status', ['pending', 'partially_paid', 'sent', 'unpaid', 'partial'])
    .order('created_at', { ascending: true })
    .limit(limit)

  if (module !== 'all') {
    query = query.eq('bill_module', module)
  }
  if (fromDate) query = query.gte('created_at', fromDate + 'T00:00:00+05:30')
  if (toDate) query = query.lte('created_at', toDate + 'T23:59:59+05:30')

  const { data: bills, error } = await query

  if (error) {
    return NextResponse.json({ error: 'Failed to load bills: ' + error.message }, { status: 500 })
  }

  // Load patient info for all patient IDs
  const patientIds = [...new Set((bills || []).map((b: any) => b.patient_id || b.patientid).filter(Boolean))]

  let patientMap = new Map<string, any>()
  if (patientIds.length > 0) {
    const { data: patients } = await sb
      .from('patients')
      .select('id, full_name, mrn, mobile')
      .in('id', patientIds.slice(0, 100))

    if (patients) {
      for (const p of patients) patientMap.set(p.id, p)
    }
  }

  // Build outstanding records
  const outstanding: OutstandingBill[] = []

  for (const bill of (bills || [])) {
    const total = Number(bill.net_amount || bill.total || 0)
    const paid = Number(bill.paid || 0)
    const due = Number(bill.due || Math.max(0, total - paid))

    if (due <= 0) continue

    const billDate = bill.created_at || bill.createdat || ''
    const daysOverdue = Math.max(0, Math.floor((now.getTime() - new Date(billDate).getTime()) / 86400000))
    const patId = bill.patient_id || bill.patientid
    const patient = patientMap.get(patId)

    outstanding.push({
      id: bill.id,
      invoice_number: bill.invoice_number || bill.invoicenumber || bill.id.slice(0, 8),
      patient_id: patId,
      patient_name: patient?.full_name || 'Unknown',
      mrn: patient?.mrn || '',
      bill_date: billDate,
      total: Math.round(total * 100) / 100,
      paid: Math.round(paid * 100) / 100,
      due: Math.round(due * 100) / 100,
      status: bill.status,
      module: bill.bill_module || 'OPD',
      days_overdue: daysOverdue,
      aging_bucket: getAgingBucket(daysOverdue),
    })
  }

  // Aging bucket summary
  const buckets: Record<string, { count: number; amount: number }> = {
    'current': { count: 0, amount: 0 },
    '1-7 days': { count: 0, amount: 0 },
    '8-15 days': { count: 0, amount: 0 },
    '16-30 days': { count: 0, amount: 0 },
    '31-60 days': { count: 0, amount: 0 },
    '61-90 days': { count: 0, amount: 0 },
    '90+ days': { count: 0, amount: 0 },
  }

  let totalOutstanding = 0
  for (const o of outstanding) {
    if (!buckets[o.aging_bucket]) buckets[o.aging_bucket] = { count: 0, amount: 0 }
    buckets[o.aging_bucket].count++
    buckets[o.aging_bucket].amount += o.due
    totalOutstanding += o.due
  }

  // Round bucket amounts
  for (const key of Object.keys(buckets)) {
    buckets[key].amount = Math.round(buckets[key].amount * 100) / 100
  }

  if (summaryOnly) {
    return NextResponse.json({
      total_outstanding: Math.round(totalOutstanding * 100) / 100,
      total_bills: outstanding.length,
      aging_buckets: buckets,
      generated_at: now.toISOString(),
    })
  }

  // Sort by days overdue descending (oldest first)
  outstanding.sort((a, b) => b.days_overdue - a.days_overdue)

  return NextResponse.json({
    total_outstanding: Math.round(totalOutstanding * 100) / 100,
    total_bills: outstanding.length,
    aging_buckets: buckets,
    bills: outstanding,
    filters: { module, from: fromDate, to: toDate },
    generated_at: now.toISOString(),
  })
}