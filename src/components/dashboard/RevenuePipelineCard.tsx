'use client'

import { useState, useEffect } from 'react'
import { TrendingUp, IndianRupee, ArrowRight, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { getIndiaToday } from '@/lib/utils'
import { loadSettings } from '@/lib/settings'

interface PipelineData {
  scheduled: number
  arrived: number
  consulted: number
  billed: number
  paid: number
  arrivalRate: number
  billingRate: number
  collectionRate: number
  estimatedLostRevenue: number
  totalCollected: number
  totalBilled: number
}

function getRateColor(rate: number): string {
  if (rate >= 85) return 'text-green-600'
  if (rate >= 70) return 'text-amber-600'
  return 'text-red-600'
}

function getRateBg(rate: number): string {
  if (rate >= 85) return 'bg-green-100 text-green-700'
  if (rate >= 70) return 'bg-amber-100 text-amber-700'
  return 'bg-red-100 text-red-700'
}

export default function RevenuePipelineCard() {
  const [data, setData] = useState<PipelineData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchPipelineData()
  }, [])

  async function fetchPipelineData() {
    setLoading(true)
    const today = getIndiaToday()
    let feeOPD = 500

    try {
      const settings = loadSettings()
      feeOPD = parseInt(settings.feeOPD) || 500
    } catch {
      // fallback to 500
    }

    try {
      const [appointmentsResult, queueResult, billsResult] = await Promise.all([
        // (a) Appointments today (count by status)
        supabase
          .from('appointments')
          .select('id, status')
          .eq('date', today),

        // (b) OPD Queue today (count by status)
        supabase
          .from('opd_queue')
          .select('id, status')
          .eq('queue_date', today),

        // (c) Bills created today
        supabase
          .from('bills')
          .select('id, status, net_amount')
          .gte('createdat', `${today}T00:00:00`)
          .lte('createdat', `${today}T23:59:59`),
      ])

      const appointments = appointmentsResult.data || []
      const queue = queueResult.data || []
      const bills = billsResult.data || []

      // Calculate pipeline numbers
      const scheduled = appointments.length
      const arrived = queue.length
      const consulted = queue.filter(q => q.status === 'done').length
      const billed = bills.length
      const paidBills = bills.filter(b => b.status === 'paid' || b.status === 'completed')
      const paid = paidBills.length

      // Calculate rates (avoid division by zero)
      const arrivalRate = scheduled > 0 ? Math.round((arrived / scheduled) * 100) : (arrived > 0 ? 100 : 0)
      const billingRate = consulted > 0 ? Math.round((billed / consulted) * 100) : 0
      const collectionRate = billed > 0 ? Math.round((paid / billed) * 100) : 0

      // Revenue numbers
      const noShowCount = scheduled > arrived ? scheduled - arrived : 0
      const estimatedLostRevenue = noShowCount * feeOPD
      const totalCollected = paidBills.reduce((sum, b) => sum + (Number(b.net_amount) || 0), 0)
      const totalBilled = bills.reduce((sum, b) => sum + (Number(b.net_amount) || 0), 0)

      setData({
        scheduled,
        arrived,
        consulted,
        billed,
        paid,
        arrivalRate,
        billingRate,
        collectionRate,
        estimatedLostRevenue,
        totalCollected,
        totalBilled,
      })
    } catch (err) {
      console.error('[RevenuePipelineCard] Error fetching data:', err)
    }
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-5 animate-pulse">
        <div className="h-5 bg-gray-100 rounded w-40 mb-4" />
        <div className="h-16 bg-gray-50 rounded-lg" />
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-emerald-100 rounded-lg flex items-center justify-center">
            <TrendingUp className="w-4 h-4 text-emerald-600" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-gray-900">Revenue Pipeline</h2>
            <p className="text-[10px] text-gray-500">Today&apos;s patient flow &amp; billing funnel</p>
          </div>
        </div>
        <button
          onClick={fetchPipelineData}
          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Funnel Visualization */}
      <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-3 mb-4 overflow-x-auto">
        <div className="flex items-center gap-1 text-center min-w-0">
          <div className="flex flex-col items-center px-2">
            <span className="text-lg font-black text-gray-800">{data.scheduled}</span>
            <span className="text-[10px] text-gray-500">Scheduled</span>
          </div>
          <ArrowRight className="w-3 h-3 text-gray-300 flex-shrink-0" />
          <div className="flex flex-col items-center px-2">
            <span className="text-lg font-black text-gray-800">{data.arrived}</span>
            <span className={`text-[10px] font-medium ${getRateColor(data.arrivalRate)}`}>
              ({data.arrivalRate}%)
            </span>
            <span className="text-[10px] text-gray-500">Arrived</span>
          </div>
          <ArrowRight className="w-3 h-3 text-gray-300 flex-shrink-0" />
          <div className="flex flex-col items-center px-2">
            <span className="text-lg font-black text-gray-800">{data.consulted}</span>
            <span className="text-[10px] text-gray-500">Consulted</span>
          </div>
          <ArrowRight className="w-3 h-3 text-gray-300 flex-shrink-0" />
          <div className="flex flex-col items-center px-2">
            <span className="text-lg font-black text-gray-800">{data.billed}</span>
            <span className={`text-[10px] font-medium ${getRateColor(data.billingRate)}`}>
              ({data.billingRate}%)
            </span>
            <span className="text-[10px] text-gray-500">Billed</span>
          </div>
          <ArrowRight className="w-3 h-3 text-gray-300 flex-shrink-0" />
          <div className="flex flex-col items-center px-2">
            <span className="text-lg font-black text-gray-800">{data.paid}</span>
            <span className={`text-[10px] font-medium ${getRateColor(data.collectionRate)}`}>
              ({data.collectionRate}%)
            </span>
            <span className="text-[10px] text-gray-500">Paid</span>
          </div>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-gray-50 rounded-lg p-2.5 text-center">
          <div className={`text-[10px] font-bold uppercase tracking-wide mb-0.5 ${getRateColor(data.arrivalRate)}`}>
            Arrival
          </div>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${getRateBg(data.arrivalRate)}`}>
            {data.arrivalRate}%
          </span>
        </div>
        <div className="bg-gray-50 rounded-lg p-2.5 text-center">
          <div className={`text-[10px] font-bold uppercase tracking-wide mb-0.5 ${getRateColor(data.billingRate)}`}>
            Billing
          </div>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${getRateBg(data.billingRate)}`}>
            {data.billingRate}%
          </span>
        </div>
        <div className="bg-gray-50 rounded-lg p-2.5 text-center">
          <div className={`text-[10px] font-bold uppercase tracking-wide mb-0.5 ${getRateColor(data.collectionRate)}`}>
            Collection
          </div>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${getRateBg(data.collectionRate)}`}>
            {data.collectionRate}%
          </span>
        </div>
      </div>

      {/* Lost Revenue */}
      {data.estimatedLostRevenue > 0 && (
        <div className="mt-3 bg-red-50 border border-red-100 rounded-lg px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <IndianRupee className="w-3.5 h-3.5 text-red-500" />
            <span className="text-xs text-red-700">
              <strong>Est. lost revenue (no-shows):</strong> ₹{data.estimatedLostRevenue.toLocaleString('en-IN')}
            </span>
          </div>
        </div>
      )}

      {/* Total collected */}
      {data.totalCollected > 0 && (
        <div className="mt-2 bg-green-50 border border-green-100 rounded-lg px-3 py-2 flex items-center gap-1.5">
          <IndianRupee className="w-3.5 h-3.5 text-green-600" />
          <span className="text-xs text-green-700">
            <strong>Collected today:</strong> ₹{data.totalCollected.toLocaleString('en-IN')}
            {data.totalBilled > data.totalCollected && (
              <span className="text-green-500 ml-1">
                / ₹{data.totalBilled.toLocaleString('en-IN')} billed
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  )
}
