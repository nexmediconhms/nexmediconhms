'use client'
import { useState } from 'react'
import AppShell from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { Upload, CheckCircle, AlertTriangle, ArrowLeft } from 'lucide-react'
import Link from 'next/link'

interface CSVRow {
    [key: string]: string
}

export default function PharmacyImportPage() {
    const [rows, setRows] = useState<CSVRow[]>([])
    const [headers, setHeaders] = useState<string[]>([])
    const [mapping, setMapping] = useState<Record<string, string>>({})
    const [importing, setImporting] = useState(false)
    const [result, setResult] = useState<{ success: number; failed: number } | null>(null)
    const [error, setError] = useState('')

    const TARGET_FIELDS = [
        { key: 'name', label: 'Medicine Name *', required: true },
        { key: 'generic_name', label: 'Generic Name', required: false },
        { key: 'brand_name', label: 'Brand Name', required: false },
        { key: 'manufacturer', label: 'Manufacturer / Company', required: false },
        { key: 'strength', label: 'Strength (e.g. 500mg)', required: false },
        { key: 'mrp', label: 'MRP (₹)', required: false },
        { key: 'purchase_price', label: 'Purchase Price (₹)', required: false },
        { key: 'current_stock', label: 'Current Stock', required: false },
        { key: 'batch_number', label: 'Batch Number', required: false },
        { key: 'expiry_date', label: 'Expiry Date', required: false },
    ]

    function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        if (!file) return
        setError('')
        setResult(null)

        const reader = new FileReader()
        reader.onload = (ev) => {
            const text = ev.target?.result as string
            if (!text) return
            const lines = text.split('').map(l => l.trim()).filter(Boolean)
            if (lines.length < 2) { setError('CSV must have at least a header row and one data row.'); return }

            const hdrs = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''))
            setHeaders(hdrs)

            const parsed: CSVRow[] = []
            for (let i = 1; i < lines.length; i++) {
                const vals = lines[i].split(',').map(v => v.trim().replace(/^["']|["']$/g, ''))
                const row: CSVRow = {}
                hdrs.forEach((h, idx) => { row[h] = vals[idx] || '' })
                parsed.push(row)
            }
            setRows(parsed)

            // Auto-guess mapping
            const autoMap: Record<string, string> = {}
            hdrs.forEach(h => {
                const lower = h.toLowerCase()
                if (lower.includes('name') && !lower.includes('company') && !lower.includes('generic')) autoMap['name'] = h
                if (lower.includes('generic')) autoMap['generic_name'] = h
                if (lower.includes('brand')) autoMap['brand_name'] = h
                if (lower.includes('company') || lower.includes('mfg') || lower.includes('manufacturer')) autoMap['manufacturer'] = h
                if (lower.includes('mrp') || lower.includes('m.r.p')) autoMap['mrp'] = h
                if (lower.includes('purchase') || lower.includes('cost') || lower.includes('rate')) autoMap['purchase_price'] = h
                if (lower.includes('stock') || lower.includes('qty') || lower.includes('quantity')) autoMap['current_stock'] = h
                if (lower.includes('batch')) autoMap['batch_number'] = h
                if (lower.includes('expiry') || lower.includes('exp')) autoMap['expiry_date'] = h
                if (lower.includes('strength') || lower.includes('pack')) autoMap['strength'] = h
            })
            setMapping(autoMap)
        }
        reader.readAsText(file)
    }

    async function handleImport() {
        if (!mapping.name) { setError('Please map the "Medicine Name" column.'); return }
        setImporting(true); setError('')

        let success = 0
        let failed = 0

        for (const row of rows) {
            const name = row[mapping.name]
            if (!name || !name.trim()) { failed++; continue }

            // Detect form from name
            const nameLower = name.toLowerCase()
            let form = 'tablet'
            if (nameLower.includes('cap')) form = 'capsule'
            else if (nameLower.includes('syr') || nameLower.includes('susp')) form = 'syrup'
            else if (nameLower.includes('inj')) form = 'injection'
            else if (nameLower.includes('cream')) form = 'cream'
            else if (nameLower.includes('drop')) form = 'drops'
            else if (nameLower.includes('gel')) form = 'gel'
            else if (nameLower.includes('oint')) form = 'ointment'

            const payload: any = {
                name: name.trim(),
                form,
                is_active: true,
                current_stock: 0,
                min_stock: 10,
                unit: 'strip',
            }

            if (mapping.generic_name && row[mapping.generic_name]) payload.generic_name = row[mapping.generic_name].trim()
            if (mapping.brand_name && row[mapping.brand_name]) payload.brand_name = row[mapping.brand_name].trim()
            if (mapping.manufacturer && row[mapping.manufacturer]) payload.manufacturer = row[mapping.manufacturer].trim()
            if (mapping.strength && row[mapping.strength]) payload.strength = row[mapping.strength].trim()
            if (mapping.mrp && row[mapping.mrp]) payload.mrp = parseFloat(row[mapping.mrp]) || null
            if (mapping.purchase_price && row[mapping.purchase_price]) payload.purchase_price = parseFloat(row[mapping.purchase_price]) || null
            if (mapping.current_stock && row[mapping.current_stock]) payload.current_stock = parseInt(row[mapping.current_stock]) || 0

            const { error: insertErr } = await supabase.from('pharmacy_medicines').insert(payload)
            if (insertErr) { failed++ } else { success++ }
        }

        setResult({ success, failed })
        setImporting(false)
    }

    return (
        <AppShell>
            <div className="p-6 max-w-4xl mx-auto">
                <div className="flex items-center gap-3 mb-5">
                    <Link href="/pharmacy" className="text-gray-400 hover:text-gray-700">
                        <ArrowLeft className="w-5 h-5" />
                    </Link>
                    <div>
                        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                            <Upload className="w-5 h-5 text-blue-600" /> Import Medicines from CSV
                        </h1>
                        <p className="text-sm text-gray-500">Upload your pharmacy stock list to bulk-import medicines</p>
                    </div>
                </div>

                {/* Step 1: Upload */}
                {rows.length === 0 && (
                    <div className="card p-8 text-center">
                        <Upload className="w-12 h-12 mx-auto mb-4 text-blue-300" />
                        <h2 className="font-semibold text-gray-800 mb-2">Upload CSV File</h2>
                        <p className="text-sm text-gray-500 mb-4">
                            Export your medicine stock from your pharmacy software (Marg, Busy, RetailGraph, etc.) as CSV and upload here.
                        </p>
                        <label className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-3 rounded-lg cursor-pointer transition-colors">
                            <Upload className="w-4 h-4" /> Choose CSV File
                            <input type="file" accept=".csv,.txt" className="hidden" onChange={handleFile} />
                        </label>
                        <p className="text-xs text-gray-400 mt-3">Supports: .csv files with comma separation</p>
                    </div>
                )}

                {error && (
                    <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" /> {error}
                    </div>
                )}

                {/* Step 2: Column Mapping */}
                {rows.length > 0 && !result && (
                    <>
                        <div className="card p-5 mb-5">
                            <h2 className="font-semibold text-gray-800 mb-1">Step 2: Map Columns</h2>
                            <p className="text-sm text-gray-500 mb-4">
                                Found {rows.length} rows with {headers.length} columns. Map your CSV columns to our fields:
                            </p>
                            <div className="grid grid-cols-2 gap-3">
                                {TARGET_FIELDS.map(field => (
                                    <div key={field.key}>
                                        <label className="label">{field.label}</label>
                                        <select className="input" value={mapping[field.key] || ''}
                                            onChange={e => setMapping(p => ({ ...p, [field.key]: e.target.value }))}>
                                            <option value="">— Skip this field —</option>
                                            {headers.map(h => <option key={h} value={h}>{h}</option>)}
                                        </select>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Preview */}
                        <div className="card p-5 mb-5">
                            <h3 className="font-semibold text-gray-800 mb-3">Preview (first 5 rows)</h3>
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="bg-gray-50">
                                            {headers.slice(0, 8).map(h => (
                                                <th key={h} className="px-2 py-1.5 text-left font-semibold text-gray-500">{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.slice(0, 5).map((row, i) => (
                                            <tr key={i} className="border-t border-gray-50">
                                                {headers.slice(0, 8).map(h => (
                                                    <td key={h} className="px-2 py-1.5 text-gray-700 max-w-[150px] truncate">{row[h] || '—'}</td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <button onClick={handleImport} disabled={importing || !mapping.name}
                                className="btn-primary flex items-center gap-2 disabled:opacity-60">
                                {importing ? 'Importing…' : `Import ${rows.length} Medicines`}
                            </button>
                            <button onClick={() => { setRows([]); setHeaders([]); setMapping({}) }} className="btn-secondary">
                                Cancel
                            </button>
                        </div>
                    </>
                )}

                {/* Step 3: Result */}
                {result && (
                    <div className="card p-8 text-center">
                        <CheckCircle className="w-12 h-12 mx-auto mb-4 text-green-500" />
                        <h2 className="font-semibold text-gray-800 mb-2">Import Complete</h2>
                        <div className="text-sm text-gray-600 mb-4">
                            <span className="text-green-700 font-bold">{result.success} imported</span>
                            {result.failed > 0 && <span className="text-red-600 font-bold ml-3">{result.failed} failed</span>}
                        </div>
                        <div className="flex gap-3 justify-center">
                            <Link href="/pharmacy" className="btn-primary">View Inventory</Link>
                            <button onClick={() => { setRows([]); setHeaders([]); setMapping({}); setResult(null) }}
                                className="btn-secondary">Import More</button>
                        </div>
                    </div>
                )}
            </div>
        </AppShell>
    )
}
