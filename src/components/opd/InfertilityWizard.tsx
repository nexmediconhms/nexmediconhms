/**
 * src/components/opd/InfertilityWizard.tsx
 *
 * Step-by-step infertility workup tracker.
 * Guides the doctor through systematic investigation and tracks progress.
 *
 * Usage:
 *   <InfertilityWizard patientId={id} encounterId={encId} />
 *
 * NON-BREAKING: New component.
 */
'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  INFERTILITY_WORKUP_STEPS,
  getWorkupProgress,
  type InfertilityWorkup,
  type WorkupStep,
} from '@/lib/infertility-wizard';

interface InfertilityWizardProps {
  patientId: string;
  encounterId?: string;
  doctorId?: string;
}

export default function InfertilityWizard({ patientId, encounterId, doctorId }: InfertilityWizardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [workup, setWorkup] = useState<InfertilityWorkup | null>(null);
  const [activeStep, setActiveStep] = useState<string | null>(null);
  const [stepData, setStepData] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Load existing workup
  const loadWorkup = useCallback(async () => {
    try {
      const res = await fetch('/api/clinical-tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'infertility', action: 'list', patient_id: patientId }),
      });
      const data = await res.json();
      if (data.workups?.length > 0) {
        setWorkup(data.workups[0]); // most recent
      }
    } catch { /* ignore */ }
  }, [patientId]);

  useEffect(() => { if (isOpen) loadWorkup(); }, [isOpen, loadWorkup]);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    try {
      const res = await fetch('/api/clinical-tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: 'infertility', action: 'create',
          patient_id: patientId, encounter_id: encounterId, doctor_id: doctorId,
        }),
      });
      const data = await res.json();
      if (data.workup) { setWorkup(data.workup); setActiveStep('history'); }
    } catch (err) { setError(String(err)); }
    finally { setCreating(false); }
  }, [patientId, encounterId, doctorId]);

  const handleOpenStep = useCallback((step: WorkupStep) => {
    setActiveStep(step.key);
    // Load existing data for this step
    if (workup) {
      const dataMap: Record<string, unknown> = {
        history: workup.history_data,
        female_hormonal: workup.female_hormonal,
        female_imaging: workup.female_imaging,
        female_tubal: workup.female_tubal,
        male_semen: workup.male_semen,
      };
      setStepData((dataMap[step.key] as Record<string, unknown>) || {});
    }
  }, [workup]);

  const handleSaveStep = useCallback(async () => {
    if (!workup || !activeStep) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch('/api/clinical-tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: 'infertility', action: 'update_step',
          workup_id: workup.id, step_key: activeStep, step_data: stepData,
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      await loadWorkup();
      setActiveStep(null);
    } catch (err) { setError(String(err instanceof Error ? err.message : err)); }
    finally { setSaving(false); }
  }, [workup, activeStep, stepData, loadWorkup]);

  const progress = workup ? getWorkupProgress(workup) : null;

  return (
    <div className="border border-gray-200 rounded-lg">
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b">
        <h3 className="text-sm font-semibold text-gray-700">🔬 Infertility Workup</h3>
        <button onClick={() => setIsOpen(!isOpen)} className="text-xs px-3 py-1 bg-violet-600 text-white rounded-md hover:bg-violet-700">
          {isOpen ? 'Close' : 'Open'}
        </button>
      </div>

      {isOpen && (
        <div className="p-4 space-y-4">
          {error && <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</div>}

          {/* No workup — create one */}
          {!workup && (
            <div className="text-center py-6">
              <p className="text-sm text-gray-500 mb-3">No infertility workup started for this patient.</p>
              <button onClick={handleCreate} disabled={creating}
                className="px-4 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-50">
                {creating ? 'Creating...' : 'Start New Workup'}
              </button>
            </div>
          )}

          {/* Progress overview */}
          {workup && progress && !activeStep && (
            <>
              {/* Overall progress bar */}
              <div>
                <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                  <span>Overall Progress</span>
                  <span className="font-medium">{progress.overallPercentage}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className="bg-violet-600 h-2 rounded-full transition-all" style={{ width: `${progress.overallPercentage}%` }} />
                </div>
              </div>

              {/* Step cards */}
              <div className="space-y-2">
                {INFERTILITY_WORKUP_STEPS.map((step, i) => {
                  const stepProgress = progress.steps.find(s => s.key === step.key);
                  const pct = stepProgress?.percentage || 0;
                  const catIcons: Record<string, string> = {
                    history: '📋', female: '♀️', male: '♂️', combined: '🔬', treatment: '💊',
                  };
                  return (
                    <button
                      key={step.key}
                      onClick={() => handleOpenStep(step)}
                      className="w-full text-left px-4 py-3 border rounded-lg hover:bg-violet-50 flex items-center gap-3"
                    >
                      <span className="text-lg">{catIcons[step.category] || '📋'}</span>
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-800">
                          Step {i + 1}: {step.title}
                        </div>
                        <div className="text-xs text-gray-500">{step.description}</div>
                        <div className="w-full bg-gray-200 rounded-full h-1 mt-1">
                          <div className={`h-1 rounded-full ${pct === 100 ? 'bg-green-500' : 'bg-violet-400'}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                      <span className={`text-xs font-medium ${pct === 100 ? 'text-green-600' : 'text-gray-400'}`}>
                        {pct === 100 ? '✓' : `${pct}%`}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Type and duration */}
              <div className="flex gap-3 text-xs text-gray-500">
                <span>Type: {workup.infertility_type || 'Primary'}</span>
                {workup.duration_months && <span>Duration: {workup.duration_months} months</span>}
                <span>Status: {workup.status}</span>
              </div>
            </>
          )}

          {/* Active step form */}
          {activeStep && (
            <StepForm
              step={INFERTILITY_WORKUP_STEPS.find(s => s.key === activeStep)!}
              data={stepData}
              onChange={setStepData}
              onSave={handleSaveStep}
              onBack={() => setActiveStep(null)}
              saving={saving}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Step Form Sub-component ────────────────────────────────────────────────

function StepForm({
  step, data, onChange, onSave, onBack, saving,
}: {
  step: WorkupStep;
  data: Record<string, unknown>;
  onChange: (d: Record<string, unknown>) => void;
  onSave: () => void;
  onBack: () => void;
  saving: boolean;
}) {
  const updateField = (key: string, value: unknown) => {
    onChange({ ...data, [key]: value });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-medium text-gray-800">{step.title}</h4>
        <button onClick={onBack} className="text-xs text-gray-500 hover:text-gray-700">← Back to overview</button>
      </div>
      <p className="text-xs text-gray-500">{step.description}</p>

      <div className="space-y-3">
        {step.checklistItems.map(item => (
          <div key={item.key} className="flex items-start gap-3">
            {item.type === 'checkbox' ? (
              <label className="flex items-center gap-2 text-sm py-1">
                <input
                  type="checkbox"
                  checked={!!data[item.key]}
                  onChange={e => updateField(item.key, e.target.checked)}
                  className="rounded border-gray-300"
                />
                <span className={data[item.key] ? 'text-green-700' : 'text-gray-700'}>
                  {item.label} {item.required && <span className="text-red-400">*</span>}
                </span>
              </label>
            ) : (
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  {item.label} {item.required && <span className="text-red-400">*</span>}
                  {item.labCode && <span className="text-violet-400 ml-1">[{item.labCode}]</span>}
                </label>
                {item.type === 'select' ? (
                  <select
                    value={(data[item.key] as string) || ''}
                    onChange={e => updateField(item.key, e.target.value)}
                    className="w-full border rounded-md px-2 py-1.5 text-sm"
                  >
                    <option value="">— Select —</option>
                    {item.options?.map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                ) : item.type === 'date' ? (
                  <input
                    type="date" value={(data[item.key] as string) || ''}
                    onChange={e => updateField(item.key, e.target.value)}
                    className="w-full border rounded-md px-2 py-1.5 text-sm"
                  />
                ) : (
                  <input
                    type="text" value={(data[item.key] as string) || ''}
                    onChange={e => updateField(item.key, e.target.value)}
                    className="w-full border rounded-md px-2 py-1.5 text-sm"
                    placeholder={item.label}
                  />
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onBack} className="px-4 py-2 text-sm bg-gray-100 rounded-md">Cancel</button>
        <button onClick={onSave} disabled={saving} className="px-4 py-2 text-sm bg-violet-600 text-white rounded-md disabled:opacity-50">
          {saving ? 'Saving...' : 'Save Step'}
        </button>
      </div>
    </div>
  );
}
