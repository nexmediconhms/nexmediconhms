'use client'
/**
 * src/app/fee-config/page.tsx
 * 
 * Fee Configuration — Admin sets consultation fees
 * Smart Visit Detection uses these fees to auto-suggest
 */

import { useState, useEffect } from 'react'
import AppShell from '@/components/layout/AppShell'
import { loadFeeConfig, saveFeeConfig, FeeConfig } from '@/lib/smart-visit'
import { useAuth } from '@/lib/auth'
import {
  IndianRupee, Save, CheckCircle, Settings,
  Clock, Baby, Stethoscope, UserPlus,
} from 'lucide-react'

export default function FeeConfigPage() {
  const { isAdmin } = useAuth()
  const [config, setConfig] = useState<FeeConfig>({
    newConsultation: 500,
    followUp7Days: 200,
    followUp30Days: 300,
    ancVisit: 400,
    postOpVisit: 0,
    procedureFee: 500,
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    loadFeeConfig().then(setConfig)
  }, [])

  async function handleSave() {
    setSaving(true)
    const success = await saveFeeConfig(config)
    setSaving(false)
    if (success) {
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    }
  }

  if (!isAdmin) {
    return (
      <AppShell>
        <div className="p-8 text-center text-gray-500">Only admins can configure fees.</div>
      </AppShell>
    )
  }

  const fields: { key: keyof FeeConfig; label: string; desc: string; icon: any }[] = [
    { key: 'newConsultation', label: 'New Consultation Fee', desc: 'First visit or different complaint (>30 days gap)', icon: UserPlus },
    { key: 'followUp7Days', label: 'Follow-up (within 7 days)', desc: 'Same complaint, returning within a week', icon: Clock },
    { key: 'followUp30Days', label: 'Follow-up (7-30 days)', desc: 'Returning for same condition within a month', icon: Clock },
    { key: 'ancVisit', label: 'ANC Visit Fee', desc: 'Antenatal care routine visit', icon: Baby },
    { key: 'postOpVisit', label: 'Post-Op Follow-up', desc: 'Wound check / post-surgery review (often ₹0 if in package)', icon: Stethoscope },
    { key: 'procedureFee', label: 'Procedure Fee (base)', desc: 'Base charge for minor procedures', icon: IndianRupee },
  ]

  return (
    <AppShell>
      <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Settings className="w-5 h-5 text-gray-600" />
            Fee Configuration
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Set your consultation fees. Smart Visit Detection will auto-suggest the correct fee based on patient history.
          </p>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <h3 className="text-xs font-bold text-blue-800 mb-1">How it works</h3>
          <p className="text-xs text-blue-600">
            When a patient arrives, the system checks their visit history and automatically suggests the appropriate fee.
            Staff no longer needs to ask &quot;Is this a new case or follow-up?&quot; — the system knows.
          </p>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
          {fields.map(field => (
            <div key={field.key} className="flex items-center gap-4 px-5 py-4">
              <div className="w-9 h-9 bg-gray-50 rounded-lg flex items-center justify-center flex-shrink-0">
                <field.icon className="w-4 h-4 text-gray-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-gray-900">{field.label}</div>
                <div className="text-xs text-gray-500">{field.desc}</div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <span className="text-sm text-gray-400">₹</span>
                <input
                  type="number"
                  value={config[field.key]}
                  onChange={e => setConfig(c => ({ ...c, [field.key]: Number(e.target.value) }))}
                  className="w-20 border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-right font-bold focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <div>
            {saved && (
              <span className="flex items-center gap-1.5 text-xs font-medium text-green-600">
                <CheckCircle className="w-3.5 h-3.5" /> Saved successfully
              </span>
            )}
          </div>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </div>
    </AppShell>
  )
}
