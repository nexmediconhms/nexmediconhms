'use client'

/**
 * src/components/charts/GrowthChart.tsx
 *
 * WHO/ICB Standard Growth Charts for Obstetric Monitoring
 *
 * Plots patient data against standard reference curves:
 *   - Fundal height vs gestational age
 *   - Maternal weight gain
 *   - Blood pressure trends
 *   - Fetal biometry (BPD, HC, AC, FL)
 *
 * Uses SVG for rendering — no external chart library needed.
 */

import { useMemo } from 'react'

// ─── Types ────────────────────────────────────────────────────

export type ChartType = 'fundal-height' | 'weight-gain' | 'bp-trend' | 'fetal-bpd' | 'fetal-hc' | 'fetal-ac' | 'fetal-fl'

export interface DataPoint {
  ga: number       // gestational age in weeks
  value: number    // measured value
  date?: string    // date of measurement
}

interface GrowthChartProps {
  type: ChartType
  data: DataPoint[]
  patientName?: string
  className?: string
}

// ─── WHO Reference Data ───────────────────────────────────────
// Format: [GA_weeks, 3rd_percentile, 10th, 50th, 90th, 97th]

const WHO_FUNDAL_HEIGHT: number[][] = [
  [20, 16, 17, 20, 23, 24],
  [22, 18, 19, 22, 25, 26],
  [24, 20, 21, 24, 27, 28],
  [26, 22, 23, 26, 29, 30],
  [28, 24, 25, 28, 31, 32],
  [30, 26, 27, 30, 33, 34],
  [32, 28, 29, 32, 35, 36],
  [34, 30, 31, 34, 37, 38],
  [36, 31, 32, 35, 38, 39],
  [38, 32, 33, 36, 39, 40],
  [40, 33, 34, 37, 40, 41],
]

const WHO_FETAL_BPD: number[][] = [
  [14, 24, 26, 29, 32, 34],
  [16, 30, 32, 36, 40, 42],
  [18, 36, 38, 42, 46, 48],
  [20, 43, 45, 49, 53, 55],
  [22, 49, 51, 55, 59, 61],
  [24, 55, 57, 61, 65, 67],
  [26, 60, 62, 66, 70, 72],
  [28, 65, 67, 71, 75, 77],
  [30, 70, 72, 76, 80, 82],
  [32, 74, 76, 80, 84, 86],
  [34, 78, 80, 84, 88, 90],
  [36, 81, 83, 87, 91, 93],
  [38, 84, 86, 90, 94, 96],
  [40, 86, 88, 92, 96, 98],
]

const WHO_FETAL_HC: number[][] = [
  [14, 85, 90, 98, 106, 111],
  [16, 108, 113, 122, 131, 136],
  [18, 131, 136, 146, 156, 161],
  [20, 154, 159, 170, 181, 186],
  [22, 176, 181, 193, 205, 210],
  [24, 197, 202, 215, 228, 233],
  [26, 217, 222, 236, 250, 255],
  [28, 235, 240, 255, 270, 275],
  [30, 252, 257, 273, 289, 294],
  [32, 267, 272, 289, 306, 311],
  [34, 280, 285, 303, 321, 326],
  [36, 291, 296, 315, 334, 339],
  [38, 300, 305, 325, 345, 350],
  [40, 307, 312, 333, 354, 359],
]

const WHO_FETAL_AC: number[][] = [
  [14, 65, 70, 78, 86, 91],
  [16, 88, 93, 103, 113, 118],
  [18, 112, 117, 129, 141, 146],
  [20, 136, 141, 155, 169, 174],
  [22, 160, 165, 181, 197, 202],
  [24, 183, 188, 206, 224, 229],
  [26, 205, 210, 230, 250, 255],
  [28, 226, 231, 253, 275, 280],
  [30, 246, 251, 275, 299, 304],
  [32, 264, 269, 295, 321, 326],
  [34, 281, 286, 314, 342, 347],
  [36, 296, 301, 331, 361, 366],
  [38, 309, 314, 346, 378, 383],
  [40, 320, 325, 359, 393, 398],
]

const WHO_FETAL_FL: number[][] = [
  [14, 10, 11, 14, 17, 18],
  [16, 16, 17, 21, 25, 26],
  [18, 22, 23, 28, 33, 34],
  [20, 28, 29, 34, 39, 40],
  [22, 34, 35, 40, 45, 46],
  [24, 39, 40, 46, 52, 53],
  [26, 44, 45, 51, 57, 58],
  [28, 48, 49, 56, 63, 64],
  [30, 52, 53, 60, 67, 68],
  [32, 56, 57, 64, 71, 72],
  [34, 59, 60, 67, 74, 75],
  [36, 62, 63, 70, 77, 78],
  [38, 64, 65, 73, 81, 82],
  [40, 66, 67, 75, 83, 84],
]

const WHO_WEIGHT_GAIN: number[][] = [
  [12, 0, 0.5, 1.0, 2.0, 2.5],
  [16, 1.0, 1.5, 2.5, 4.0, 4.5],
  [20, 2.5, 3.0, 4.5, 6.5, 7.0],
  [24, 4.0, 4.5, 6.5, 9.0, 9.5],
  [28, 5.5, 6.0, 8.5, 11.0, 11.5],
  [32, 7.0, 7.5, 10.0, 13.0, 13.5],
  [36, 8.5, 9.0, 11.5, 14.5, 15.0],
  [40, 10.0, 10.5, 12.5, 16.0, 16.5],
]

// ─── Chart Config ─────────────────────────────────────────────

const CHART_CONFIG: Record<ChartType, {
  title: string
  yLabel: string
  xLabel: string
  referenceData: number[][]
  yMin: number
  yMax: number
  xMin: number
  xMax: number
  color: string
}> = {
  'fundal-height': {
    title: 'Fundal Height vs Gestational Age',
    yLabel: 'Fundal Height (cm)',
    xLabel: 'Gestational Age (weeks)',
    referenceData: WHO_FUNDAL_HEIGHT,
    yMin: 10, yMax: 45,
    xMin: 18, xMax: 42,
    color: '#2563eb',
  },
  'weight-gain': {
    title: 'Maternal Weight Gain',
    yLabel: 'Weight Gain (kg)',
    xLabel: 'Gestational Age (weeks)',
    referenceData: WHO_WEIGHT_GAIN,
    yMin: -2, yMax: 20,
    xMin: 10, xMax: 42,
    color: '#059669',
  },
  'bp-trend': {
    title: 'Blood Pressure Trend',
    yLabel: 'BP (mmHg)',
    xLabel: 'Gestational Age (weeks)',
    referenceData: [],
    yMin: 50, yMax: 200,
    xMin: 10, xMax: 42,
    color: '#dc2626',
  },
  'fetal-bpd': {
    title: 'Fetal BPD (Biparietal Diameter)',
    yLabel: 'BPD (mm)',
    xLabel: 'Gestational Age (weeks)',
    referenceData: WHO_FETAL_BPD,
    yMin: 20, yMax: 105,
    xMin: 12, xMax: 42,
    color: '#7c3aed',
  },
  'fetal-hc': {
    title: 'Fetal Head Circumference',
    yLabel: 'HC (mm)',
    xLabel: 'Gestational Age (weeks)',
    referenceData: WHO_FETAL_HC,
    yMin: 70, yMax: 380,
    xMin: 12, xMax: 42,
    color: '#0891b2',
  },
  'fetal-ac': {
    title: 'Fetal Abdominal Circumference',
    yLabel: 'AC (mm)',
    xLabel: 'Gestational Age (weeks)',
    referenceData: WHO_FETAL_AC,
    yMin: 50, yMax: 420,
    xMin: 12, xMax: 42,
    color: '#ea580c',
  },
  'fetal-fl': {
    title: 'Fetal Femur Length',
    yLabel: 'FL (mm)',
    xLabel: 'Gestational Age (weeks)',
    referenceData: WHO_FETAL_FL,
    yMin: 5, yMax: 90,
    xMin: 12, xMax: 42,
    color: '#be185d',
  },
}

// ─── SVG Chart Component ──────────────────────────────────────

const CHART_WIDTH = 600
const CHART_HEIGHT = 350
const PADDING = { top: 30, right: 30, bottom: 50, left: 60 }
const PLOT_W = CHART_WIDTH - PADDING.left - PADDING.right
const PLOT_H = CHART_HEIGHT - PADDING.top - PADDING.bottom

export default function GrowthChart({ type, data, patientName, className }: GrowthChartProps) {
  const config = CHART_CONFIG[type]

  const { xScale, yScale, refPaths, dataPath, dataPoints } = useMemo(() => {
    const xS = (v: number) => PADDING.left + ((v - config.xMin) / (config.xMax - config.xMin)) * PLOT_W
    const yS = (v: number) => PADDING.top + PLOT_H - ((v - config.yMin) / (config.yMax - config.yMin)) * PLOT_H

    // Reference curves (3rd, 10th, 50th, 90th, 97th percentiles)
    const percentileLabels = ['3rd', '10th', '50th', '90th', '97th']
    const refP = [1, 2, 3, 4, 5].map(idx => {
      const points = config.referenceData
        .filter(row => row[0] >= config.xMin && row[0] <= config.xMax)
        .map(row => `${xS(row[0])},${yS(row[idx])}`)
      return {
        path: `M ${points.join(' L ')}`,
        label: percentileLabels[idx - 1],
        isDashed: idx === 1 || idx === 5,
        isMajor: idx === 3,
      }
    })

    // Patient data points
    const dp = data
      .filter(d => d.ga >= config.xMin && d.ga <= config.xMax)
      .sort((a, b) => a.ga - b.ga)
      .map(d => ({
        x: xS(d.ga),
        y: yS(d.value),
        ga: d.ga,
        value: d.value,
        date: d.date,
      }))

    const dPath = dp.length > 1
      ? `M ${dp.map(p => `${p.x},${p.y}`).join(' L ')}`
      : ''

    return { xScale: xS, yScale: yS, refPaths: refP, dataPath: dPath, dataPoints: dp }
  }, [type, data, config])

  // BP trend has special reference lines instead of percentile curves
  const isBP = type === 'bp-trend'

  return (
    <div className={`bg-white rounded-xl border border-gray-200 p-4 ${className || ''}`}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold text-gray-900">{config.title}</h3>
          {patientName && <p className="text-xs text-gray-500">{patientName}</p>}
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          {!isBP && (
            <>
              <span className="flex items-center gap-1">
                <span className="w-4 h-0.5 bg-gray-300 inline-block" /> 3rd/97th
              </span>
              <span className="flex items-center gap-1">
                <span className="w-4 h-0.5 bg-gray-400 inline-block" /> 10th/90th
              </span>
              <span className="flex items-center gap-1">
                <span className="w-4 h-0.5 bg-gray-600 inline-block" style={{ height: 2 }} /> 50th
              </span>
            </>
          )}
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: config.color }} />
            Patient
          </span>
        </div>
      </div>

      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="w-full" style={{ maxHeight: 350 }}>
        {/* Grid lines */}
        {Array.from({ length: 6 }, (_, i) => {
          const y = PADDING.top + (PLOT_H / 5) * i
          const val = config.yMax - ((config.yMax - config.yMin) / 5) * i
          return (
            <g key={`grid-y-${i}`}>
              <line x1={PADDING.left} y1={y} x2={PADDING.left + PLOT_W} y2={y}
                stroke="#e5e7eb" strokeWidth={1} />
              <text x={PADDING.left - 8} y={y + 4} textAnchor="end"
                className="text-[10px] fill-gray-500">{Math.round(val)}</text>
            </g>
          )
        })}
        {Array.from({ length: Math.ceil((config.xMax - config.xMin) / 4) + 1 }, (_, i) => {
          const week = config.xMin + i * 4
          if (week > config.xMax) return null
          const x = xScale(week)
          return (
            <g key={`grid-x-${i}`}>
              <line x1={x} y1={PADDING.top} x2={x} y2={PADDING.top + PLOT_H}
                stroke="#e5e7eb" strokeWidth={1} />
              <text x={x} y={PADDING.top + PLOT_H + 18} textAnchor="middle"
                className="text-[10px] fill-gray-500">{week}w</text>
            </g>
          )
        })}

        {/* Axes */}
        <line x1={PADDING.left} y1={PADDING.top} x2={PADDING.left} y2={PADDING.top + PLOT_H}
          stroke="#9ca3af" strokeWidth={1.5} />
        <line x1={PADDING.left} y1={PADDING.top + PLOT_H} x2={PADDING.left + PLOT_W} y2={PADDING.top + PLOT_H}
          stroke="#9ca3af" strokeWidth={1.5} />

        {/* Axis labels */}
        <text x={CHART_WIDTH / 2} y={CHART_HEIGHT - 5} textAnchor="middle"
          className="text-[11px] fill-gray-600 font-medium">{config.xLabel}</text>
        <text x={15} y={CHART_HEIGHT / 2} textAnchor="middle"
          transform={`rotate(-90, 15, ${CHART_HEIGHT / 2})`}
          className="text-[11px] fill-gray-600 font-medium">{config.yLabel}</text>

        {/* BP reference lines */}
        {isBP && (
          <>
            <line x1={PADDING.left} y1={yScale(140)} x2={PADDING.left + PLOT_W} y2={yScale(140)}
              stroke="#ef4444" strokeWidth={1} strokeDasharray="6,3" />
            <text x={PADDING.left + PLOT_W + 4} y={yScale(140) + 4}
              className="text-[9px] fill-red-500">140 (HTN)</text>
            <line x1={PADDING.left} y1={yScale(90)} x2={PADDING.left + PLOT_W} y2={yScale(90)}
              stroke="#f97316" strokeWidth={1} strokeDasharray="6,3" />
            <text x={PADDING.left + PLOT_W + 4} y={yScale(90) + 4}
              className="text-[9px] fill-orange-500">90 (HTN)</text>
          </>
        )}

        {/* Reference percentile curves */}
        {!isBP && refPaths.map((ref, idx) => (
          <path key={idx} d={ref.path} fill="none"
            stroke={ref.isMajor ? '#6b7280' : '#d1d5db'}
            strokeWidth={ref.isMajor ? 2 : 1}
            strokeDasharray={ref.isDashed ? '4,4' : undefined} />
        ))}

        {/* Shaded normal range (10th-90th) */}
        {!isBP && config.referenceData.length > 0 && (
          <path
            d={`M ${config.referenceData.filter(r => r[0] >= config.xMin && r[0] <= config.xMax).map(r => `${xScale(r[0])},${yScale(r[2])}`).join(' L ')} L ${[...config.referenceData].filter(r => r[0] >= config.xMin && r[0] <= config.xMax).reverse().map(r => `${xScale(r[0])},${yScale(r[4])}`).join(' L ')} Z`}
            fill={config.color}
            fillOpacity={0.05}
          />
        )}

        {/* Patient data line */}
        {dataPath && (
          <path d={dataPath} fill="none" stroke={config.color} strokeWidth={2.5}
            strokeLinecap="round" strokeLinejoin="round" />
        )}

        {/* Patient data points */}
        {dataPoints.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={5} fill={config.color} stroke="white" strokeWidth={2} />
            <title>{`GA: ${p.ga}w | Value: ${p.value} | ${p.date || ''}`}</title>
          </g>
        ))}

        {/* No data message */}
        {data.length === 0 && (
          <text x={CHART_WIDTH / 2} y={CHART_HEIGHT / 2} textAnchor="middle"
            className="text-sm fill-gray-400">No data points yet</text>
        )}
      </svg>
    </div>
  )
}

// ─── Multi-Chart Panel ────────────────────────────────────────

interface GrowthChartPanelProps {
  encounters: any[]
  patientName?: string
}

/**
 * Renders all relevant growth charts from encounter data.
 */
export function GrowthChartPanel({ encounters, patientName }: GrowthChartPanelProps) {
  // Extract data points from encounters
  const fundalData: DataPoint[] = []
  const bpSysData: DataPoint[] = []
  const bpDiaData: DataPoint[] = []
  const weightData: DataPoint[] = []
  const bpdData: DataPoint[] = []
  const hcData: DataPoint[] = []
  const acData: DataPoint[] = []
  const flData: DataPoint[] = []

  let baseWeight: number | null = null

  for (const enc of encounters) {
    const ob = enc.ob_data || {}
    const gaStr = ob.gestational_age || ''
    const gaMatch = gaStr.match(/(\d+)/)
    const ga = gaMatch ? parseInt(gaMatch[1]) : null

    if (!ga) continue

    const date = enc.encounter_date

    if (ob.fundal_height) fundalData.push({ ga, value: ob.fundal_height, date })
    if (enc.bp_systolic) bpSysData.push({ ga, value: enc.bp_systolic, date })
    if (enc.bp_diastolic) bpDiaData.push({ ga, value: enc.bp_diastolic, date })

    if (enc.weight) {
      if (!baseWeight) baseWeight = enc.weight
      weightData.push({ ga, value: enc.weight - baseWeight, date })
    }

    if (ob.bpd) bpdData.push({ ga, value: ob.bpd, date })
    if (ob.hc) hcData.push({ ga, value: ob.hc, date })
    if (ob.ac) acData.push({ ga, value: ob.ac, date })
    if (ob.fl) flData.push({ ga, value: ob.fl, date })
  }

  const hasAnyData = [fundalData, bpSysData, weightData, bpdData, hcData, acData, flData].some(d => d.length > 0)

  if (!hasAnyData) {
    return (
      <div className="text-center py-8 text-gray-400">
        <p className="text-sm">No growth chart data available yet.</p>
        <p className="text-xs mt-1">Data will appear as ANC visits are recorded with vitals and USG measurements.</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {fundalData.length > 0 && (
        <GrowthChart type="fundal-height" data={fundalData} patientName={patientName} />
      )}
      {weightData.length > 0 && (
        <GrowthChart type="weight-gain" data={weightData} patientName={patientName} />
      )}
      {bpSysData.length > 0 && (
        <GrowthChart type="bp-trend" data={bpSysData} patientName={patientName} />
      )}
      {bpdData.length > 0 && (
        <GrowthChart type="fetal-bpd" data={bpdData} patientName={patientName} />
      )}
      {hcData.length > 0 && (
        <GrowthChart type="fetal-hc" data={hcData} patientName={patientName} />
      )}
      {acData.length > 0 && (
        <GrowthChart type="fetal-ac" data={acData} patientName={patientName} />
      )}
      {flData.length > 0 && (
        <GrowthChart type="fetal-fl" data={flData} patientName={patientName} />
      )}
    </div>
  )
}
