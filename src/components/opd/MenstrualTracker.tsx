/**
 * src/components/opd/MenstrualTracker.tsx
 *
 * Period logging and cycle analysis for OPD.
 * Shows cycle history, regularity analysis, and next period prediction.
 *
 * Usage:
 *   <MenstrualTracker patientId={id} encounterId={encId} />
 *
 * NON-BREAKING: New component.
 */
'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  MENSTRUAL_SYMPTOMS,
  FLOW_OPTIONS,
  analyzeCycles,
  type MenstrualCycle,
  type CycleAnalysis,
} from '@/lib/menstrual-tracking';

interface MenstrualTrackerProps {
  patientId: string;
  encounterId?: string;
}

export default function MenstrualTracker({ patientId, encounterId }: MenstrualTrackerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [cycles, setCycles] = useState<MenstrualCycle[]>([]);
  const [analysis, setAnalysis] = useState<CycleAnalysis | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [form, setForm] = useState({
    period_start_date: '',
    period_end_date: '',
    flow_intensity: 'moderate',
    pad_count_per_day: '',
    clots: false,
    pain_level: 0,
    symptoms: [] as string[],
    notes: '',
  });

  const loadData = useCallback(async () => {
    try {
      const res = await fetch('/api/clinical-tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'menstrual', action: 'analyze', patient_id: patientId }),
      });
      const data = await res.json();
      if (data.cycles) setCycles(data.cycles);
      if (data.analysis) setAnalysis(data.analysis);
    } catch { /* ignore */ }
  }, [patientId]);

  useEffect(() => { if (isOpen) loadData(); }, [isOpen, loadData]);

  const handleSave = useCallback(async () => {
    if (!form.period_start_date) { setError('Start date is required'); return; }
    setSaving(true); setError(null);
    try {
      const res = await fetch('/api/clinical-tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: 'menstrual', action: 'log',
          patient_id: patientId,
          encounter_id: encounterId,
          ...form,
          pad_count_per_day: form.pad_count_per_day ? parseInt(form.pad_count_per_day) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setShowForm(false);
      setForm({ period_start_date: '', period_end_date: '', flow_intensity: 'moderate', pad_count_per_day: '', clots: false, pain_level: 0, symptoms: [], notes: '' });
      loadData();
    } catch (err) { setError(String(err instanceof Error ? err.message : err)); }
    finally { setSaving(false); }
  }, [form, patientId, encounterId, loadData]);

  const toggleSymptom = (s: string) => {
    setForm(f => ({
      ...f,
      symptoms: f.symptoms.includes(s) ? f.symptoms.filter(x => x !== s) : [...f.symptoms, s],
    }));
  };

  const regColor = analysis?.regularity === 'regular' ? 'text-green-700 bg-green-50' :
    analysis?.regularity === 'mildly_irregular' ? 'text-yellow-700 bg-yellow-50' :
    'text-red-700 bg-red-50';

  return (
    <div className="border border-gray-200 rounded-lg">
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b">
        <h3 className="text-sm font-semibold text-gray-700">📅 Menstrual History</h3>
        <button onClick={() => setIsOpen(!isOpen)} className="text-xs px-3 py-1 bg-pink-600 text-white rounded-md hover:bg-pink-700">
          {isOpen ? 'Close' : 'View / Log'}
        </button>
      </div>

      {isOpen && (
        <div className="p-4 space-y-4">
          {error && <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</div>}

          {/* Analysis summary */}
          {analysis && analysis.totalCycles >= 2 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <div className="text-xs text-gray-500">Avg Cycle</div>
                <div className="text-lg font-bold text-gray-800">{analysis.avgCycleLength || '—'}<span className="text-xs font-normal"> days</span></div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <div className="text-xs text-gray-500">Avg Duration</div>
                <div className="text-lg font-bold text-gray-800">{analysis.avgDuration || '—'}<span className="text-xs font-normal"> days</span></div>
              </div>
              <div className={`rounded-lg p-3 text-center ${regColor}`}>
                <div className="text-xs opacity-70">Regularity</div>
                <div className="text-sm font-bold">{analysis.regularityNote}</div>
              </div>
              <div className="bg-blue-50 rounded-lg p-3 text-center">
                <div className="text-xs text-blue-500">Next Predicted</div>
                <div className="text-sm font-bold text-blue-800">{analysis.nextPredictedDate || '—'}</div>
              </div>
            </div>
          )}

          {/* Alerts */}
          {analysis?.alerts && analysis.alerts.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              {analysis.alerts.map((a, i) => (
                <div key={i} className="text-sm text-amber-800">⚠ {a}</div>
              ))}
            </div>
          )}

          {/* Cycle history */}
          {cycles.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Recent Cycles</h4>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {cycles.slice(0, 12).map(c => (
                  <div key={c.id} className="flex items-center justify-between text-sm py-1.5 px-2 border-b border-gray-50">
                    <div>
                      <span className="font-medium text-gray-800">{c.period_start_date}</span>
                      {c.period_end_date && <span className="text-gray-400"> → {c.period_end_date}</span>}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      {c.duration_days && <span>{c.duration_days}d duration</span>}
                      {c.cycle_length && <span>{c.cycle_length}d cycle</span>}
                      <span className={FLOW_OPTIONS.find(f => f.value === c.flow_intensity)?.color || ''}>
                        {c.flow_intensity}
                      </span>
                      {c.is_irregular && <span className="text-red-500">⚠</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Log new period */}
          {!showForm ? (
            <button onClick={() => setShowForm(true)} className="w-full py-2 text-sm text-pink-700 bg-pink-50 border border-pink-200 rounded-lg hover:bg-pink-100">
              + Log Period
            </button>
          ) : (
            <div className="bg-gray-50 rounded-lg p-4 space-y-3">
              <h4 className="text-sm font-semibold text-gray-700">Log Period</h4>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Start Date *</label>
                  <input type="date" value={form.period_start_date} onChange={e => setForm(f => ({ ...f, period_start_date: e.target.value }))}
                    max={new Date().toISOString().split('T')[0]} className="w-full border rounded-md px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">End Date</label>
                  <input type="date" value={form.period_end_date} onChange={e => setForm(f => ({ ...f, period_end_date: e.target.value }))}
                    max={new Date().toISOString().split('T')[0]} className="w-full border rounded-md px-2 py-1.5 text-sm" />
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">Flow</label>
                <div className="flex gap-2">
                  {FLOW_OPTIONS.map(f => (
                    <button key={f.value} onClick={() => setForm(prev => ({ ...prev, flow_intensity: f.value }))}
                      className={`text-xs px-3 py-1.5 rounded-md border ${form.flow_intensity === f.value ? 'bg-pink-100 border-pink-300 text-pink-800' : 'border-gray-200'}`}>
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">Pain (0-10): {form.pain_level}</label>
                <input type="range" min={0} max={10} value={form.pain_level} onChange={e => setForm(f => ({ ...f, pain_level: parseInt(e.target.value) }))}
                  className="w-full" />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">Symptoms</label>
                <div className="flex flex-wrap gap-1">
                  {MENSTRUAL_SYMPTOMS.slice(0, 12).map(s => (
                    <button key={s} onClick={() => toggleSymptom(s)}
                      className={`text-xs px-2 py-0.5 rounded border ${form.symptoms.includes(s) ? 'bg-pink-100 border-pink-300' : 'border-gray-200'}`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.clots} onChange={e => setForm(f => ({ ...f, clots: e.target.checked }))} className="rounded" />
                Clots present
              </label>

              <div className="flex justify-end gap-2">
                <button onClick={() => setShowForm(false)} className="px-3 py-1.5 text-xs bg-gray-200 rounded-md">Cancel</button>
                <button onClick={handleSave} disabled={saving} className="px-3 py-1.5 text-xs bg-pink-600 text-white rounded-md disabled:opacity-50">
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
