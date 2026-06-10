/**
 * src/app/vitals/[patientId]/page.tsx
 *
 * Dedicated vitals entry screen for nurse/staff.
 * Used BEFORE the doctor consultation in the OPD workflow.
 *
 * Flow: Queue → Staff clicks "Take Vitals" → This page → Save → Back to queue
 *
 * Features:
 *  - Standard vitals (BP, pulse, temp, SpO2, weight, height, BMI auto)
 *  - Blood sugar with type selector
 *  - Gynae vitals (LMP, gestational age auto, FHR, fundal height, etc.)
 *  - Previous vitals prefill option
 *  - Real-time validation warnings
 *  - Critical value alerts (red banner)
 *  - Auto-updates queue status to 'vitals_done' on save
 *
 * NON-BREAKING: New page. Does not modify any existing pages.
 */
'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import {
  VITALS_FIELD_GROUPS,
  validateVitals,
  formatVitalsSummary,
  type VitalsInput,
} from '@/lib/vitals-helpers';

// ─── Types ──────────────────────────────────────────────────────────────────

interface PatientInfo {
  id: string;
  name: string;
  age?: number;
  gender?: string;
  phone?: string;
  mrn?: string;
}

interface CriticalAlert {
  field: string;
  value: number | string;
  severity: 'warning' | 'critical';
  message: string;
}

// ─── Page Component ─────────────────────────────────────────────────────────

export default function VitalsEntryPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClientComponentClient();

  const patientId = params.patientId as string;
  const encounterId = searchParams.get('encounter_id');
  const queueId = searchParams.get('queue_id');
  const returnTo = searchParams.get('return') || '/queue';

  // State
  const [patient, setPatient] = useState<PatientInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [criticalAlerts, setCriticalAlerts] = useState<CriticalAlert[]>([]);
  const [showGynaeSection, setShowGynaeSection] = useState(true);
  const [prefillApplied, setPrefillApplied] = useState(false);
  const [currentEncounterId, setCurrentEncounterId] = useState<string | null>(
    encounterId
  );

  // Vitals form state
  const [vitals, setVitals] = useState<Partial<VitalsInput>>({});

  // Computed BMI
  const computedBmi = useMemo(() => {
    if (vitals.weight_kg && vitals.height_cm && vitals.height_cm > 0) {
      const heightM = vitals.height_cm / 100;
      return Math.round((vitals.weight_kg / (heightM * heightM)) * 10) / 10;
    }
    return null;
  }, [vitals.weight_kg, vitals.height_cm]);

  // Computed gestational age from LMP
  const computedGA = useMemo(() => {
    if (vitals.lmp) {
      const lmpDate = new Date(vitals.lmp);
      const today = new Date();
      const diffDays = Math.floor(
        (today.getTime() - lmpDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (diffDays >= 0 && diffDays <= 300) {
        return {
          weeks: Math.floor(diffDays / 7),
          days: diffDays % 7,
          totalDays: diffDays,
        };
      }
    }
    return null;
  }, [vitals.lmp]);

  // ─── Fetch Patient Info ─────────────────────────────────────────────────

  useEffect(() => {
    async function fetchPatient() {
      try {
        const { data, error: fetchErr } = await supabase
          .from('patients')
          .select('id, name, age, gender, phone, mrn')
          .eq('id', patientId)
          .single();

        if (fetchErr) throw new Error(fetchErr.message);
        setPatient(data);
      } catch (err) {
        setError(`Patient not found: ${err}`);
      } finally {
        setLoading(false);
      }
    }
    fetchPatient();
  }, [patientId, supabase]);

  // ─── Create Encounter if Needed ─────────────────────────────────────────

  useEffect(() => {
    async function ensureEncounter() {
      if (currentEncounterId || !patientId) return;

      try {
        const res = await fetch('/api/encounters', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            patient_id: patientId,
            visit_type: 'OPD',
            queue_entry_id: queueId || undefined,
          }),
        });
        const data = await res.json();
        if (data.encounter?.id) {
          setCurrentEncounterId(data.encounter.id);
        }
      } catch (err) {
        console.error('Failed to create encounter:', err);
      }
    }
    ensureEncounter();
  }, [currentEncounterId, patientId, queueId]);

  // ─── Prefill from Previous Vitals ───────────────────────────────────────

  const applyPrefill = useCallback(async () => {
    try {
      const res = await fetch(`/api/vitals?patient_id=${patientId}`);
      const data = await res.json();
      if (data.vitals) {
        // Only prefill stable values (height, LMP) — not BP, pulse, etc.
        setVitals((prev) => ({
          ...prev,
          height_cm: data.vitals.height_cm || prev.height_cm,
          lmp: data.vitals.lmp || prev.lmp,
        }));
        setPrefillApplied(true);
      }
    } catch (err) {
      console.error('Prefill failed:', err);
    }
  }, [patientId]);

  // ─── Handle Field Change ────────────────────────────────────────────────

  const handleChange = useCallback(
    (key: string, value: string | number | null) => {
      setVitals((prev) => {
        const updated = { ...prev, [key]: value };
        // Live validation
        setWarnings(validateVitals(updated));
        return updated;
      });
      setSaved(false);
    },
    []
  );

  // ─── Save Vitals ───────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!currentEncounterId) {
      setError('No encounter found. Please try again.');
      return;
    }

    // Check if at least one vital is filled
    const hasData = Object.entries(vitals).some(
      ([key, val]) =>
        val !== null &&
        val !== undefined &&
        val !== '' &&
        key !== 'encounter_id' &&
        key !== 'patient_id'
    );
    if (!hasData) {
      setError('Please enter at least one vital sign.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await fetch('/api/vitals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...vitals,
          encounter_id: currentEncounterId,
          patient_id: patientId,
          capture_type: 'pre_consultation',
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to save vitals');
      }

      // Handle critical alerts from server
      if (data.critical) {
        setCriticalAlerts(data.criticalAlerts || []);
      }
      if (data.warnings) {
        setWarnings(data.warnings);
      }

      setSaved(true);

      // Update queue status if queue_id exists
      if (queueId) {
        await fetch('/api/opd/queue-status', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            queue_id: queueId,
            new_status: 'vitals_done',
          }),
        });
      }
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setSaving(false);
    }
  }, [vitals, currentEncounterId, patientId, queueId]);

  // ─── Save & Go Back ──────────────────────────────────────────────────

  const handleSaveAndReturn = useCallback(async () => {
    await handleSave();
    // Small delay so user sees the success state
    setTimeout(() => router.push(returnTo), 600);
  }, [handleSave, router, returnTo]);

  // ─── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-500">Loading patient...</div>
      </div>
    );
  }

  if (!patient) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-red-500">Patient not found</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <button
              onClick={() => router.push(returnTo)}
              className="text-sm text-blue-600 hover:text-blue-800 mb-1 flex items-center gap-1"
            >
              ← Back to Queue
            </button>
            <h1 className="text-xl font-bold text-gray-900">
              Record Vitals
            </h1>
          </div>
          <div className="text-right">
            <div className="font-semibold text-gray-900">{patient.name}</div>
            <div className="text-sm text-gray-500">
              {patient.age && `${patient.age}y`}
              {patient.gender && ` / ${patient.gender}`}
              {patient.mrn && ` • MRN: ${patient.mrn}`}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Critical Alerts Banner */}
        {criticalAlerts.length > 0 && (
          <div className="bg-red-50 border-2 border-red-300 rounded-lg p-4">
            <h3 className="text-red-800 font-bold text-lg mb-2">
              ⚠️ Critical Values Detected
            </h3>
            {criticalAlerts.map((alert, i) => (
              <div key={i} className="text-red-700 text-sm py-1">
                <span className="font-semibold">
                  {alert.severity === 'critical' ? '🔴' : '🟡'}{' '}
                </span>
                {alert.message}
              </div>
            ))}
            <p className="text-red-600 text-xs mt-2 italic">
              Please inform the doctor immediately.
            </p>
          </div>
        )}

        {/* Error Banner */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
            {error}
            <button
              onClick={() => setError(null)}
              className="ml-2 text-red-500 hover:text-red-700"
            >
              ✕
            </button>
          </div>
        )}

        {/* Prefill Button */}
        {!prefillApplied && (
          <button
            onClick={applyPrefill}
            className="text-sm text-indigo-600 hover:text-indigo-800 underline"
          >
            📋 Prefill height/LMP from previous visit
          </button>
        )}
        {prefillApplied && (
          <div className="text-sm text-green-600">
            ✓ Height and LMP prefilled from last visit
          </div>
        )}

        {/* Standard Vitals */}
        <VitalsSection
          config={VITALS_FIELD_GROUPS.standard}
          values={vitals}
          onChange={handleChange}
          computedBmi={computedBmi}
        />

        {/* Blood Sugar */}
        <VitalsSection
          config={VITALS_FIELD_GROUPS.bloodSugar}
          values={vitals}
          onChange={handleChange}
        />

        {/* Gynae Toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowGynaeSection(!showGynaeSection)}
            className="text-sm font-medium text-purple-700 hover:text-purple-900 flex items-center gap-1"
          >
            {showGynaeSection ? '▼' : '▶'} Gynae / Obstetric Vitals
          </button>
        </div>

        {/* Gynae Vitals */}
        {showGynaeSection && (
          <div>
            <VitalsSection
              config={VITALS_FIELD_GROUPS.gynae}
              values={vitals}
              onChange={handleChange}
            />
            {/* Show computed GA */}
            {computedGA && (
              <div className="mt-2 p-3 bg-indigo-50 rounded-lg text-sm text-indigo-800">
                <span className="font-semibold">Gestational Age: </span>
                {computedGA.weeks} weeks {computedGA.days} days
                ({computedGA.totalDays} total days)
              </div>
            )}
          </div>
        )}

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Notes
          </label>
          <textarea
            rows={2}
            value={(vitals as Record<string, string>).notes || ''}
            onChange={(e) => handleChange('notes', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="Any observations or notes..."
          />
        </div>

        {/* Validation Warnings */}
        {warnings.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
            <h4 className="text-yellow-800 font-semibold text-sm mb-1">
              ⚠ Validation Warnings
            </h4>
            {warnings.map((w, i) => (
              <div key={i} className="text-yellow-700 text-sm">
                • {w}
              </div>
            ))}
          </div>
        )}

        {/* Summary Preview */}
        {Object.keys(vitals).length > 0 && (
          <div className="bg-gray-100 rounded-lg p-3">
            <h4 className="text-gray-600 text-xs font-semibold uppercase mb-1">
              Summary
            </h4>
            <div className="text-sm text-gray-800">
              {formatVitalsSummary({ ...vitals, bmi: computedBmi })}
            </div>
          </div>
        )}
      </div>

      {/* Sticky Save Bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-lg">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            {saved && (
              <span className="text-green-600 text-sm font-medium">
                ✓ Vitals saved successfully
              </span>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => router.push(returnTo)}
              className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : 'Save Vitals'}
            </button>
            <button
              onClick={handleSaveAndReturn}
              disabled={saving}
              className="px-4 py-2 text-sm text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : 'Save & Return to Queue'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Vitals Section Component ─────────────────────────────────────────────

interface VitalsSectionProps {
  config: {
    label: string;
    fields: Array<{
      key: string;
      label: string;
      unit: string;
      type: string;
      step?: number;
      min?: number;
      max?: number;
      options?: string[];
    }>;
  };
  values: Record<string, unknown>;
  onChange: (key: string, value: string | number | null) => void;
  computedBmi?: number | null;
}

function VitalsSection({
  config,
  values,
  onChange,
  computedBmi,
}: VitalsSectionProps) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
        {config.label}
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {config.fields.map((field) => (
          <div key={field.key}>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              {field.label}
              {field.unit && (
                <span className="text-gray-400 ml-1">({field.unit})</span>
              )}
            </label>

            {field.type === 'select' ? (
              <select
                value={(values[field.key] as string) || ''}
                onChange={(e) =>
                  onChange(field.key, e.target.value || null)
                }
                className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">— Select —</option>
                {field.options?.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt.charAt(0).toUpperCase() + opt.slice(1)}
                  </option>
                ))}
              </select>
            ) : field.type === 'date' ? (
              <input
                type="date"
                value={(values[field.key] as string) || ''}
                onChange={(e) =>
                  onChange(field.key, e.target.value || null)
                }
                max={new Date().toISOString().split('T')[0]}
                className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            ) : (
              <input
                type="number"
                value={(values[field.key] as number) ?? ''}
                onChange={(e) => {
                  const val = e.target.value;
                  onChange(
                    field.key,
                    val === '' ? null : parseFloat(val)
                  );
                }}
                step={field.step}
                min={field.min}
                max={field.max}
                className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder={`${field.min || ''}–${field.max || ''}`}
              />
            )}
          </div>
        ))}

        {/* Show computed BMI after height/weight fields */}
        {config.label === 'Standard Vitals' && computedBmi !== null && computedBmi !== undefined && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              BMI <span className="text-gray-400">(auto)</span>
            </label>
            <div
              className={`w-full border rounded-md px-2 py-1.5 text-sm font-medium ${
                computedBmi < 18.5
                  ? 'bg-yellow-50 border-yellow-300 text-yellow-800'
                  : computedBmi > 30
                    ? 'bg-red-50 border-red-300 text-red-800'
                    : computedBmi > 25
                      ? 'bg-orange-50 border-orange-300 text-orange-800'
                      : 'bg-green-50 border-green-300 text-green-800'
              }`}
            >
              {computedBmi}
              <span className="text-xs ml-1 font-normal">
                {computedBmi < 18.5
                  ? 'Underweight'
                  : computedBmi > 30
                    ? 'Obese'
                    : computedBmi > 25
                      ? 'Overweight'
                      : 'Normal'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
