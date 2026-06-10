/**
 * src/components/opd/ReferralCreator.tsx
 *
 * Component for creating referrals during OPD consultation.
 * Features:
 *  - Common referral specialty selector
 *  - Common imaging referral quick-select
 *  - Auto-generates referral letter HTML
 *  - Letter preview + print
 *  - Tracks referral status
 *
 * Usage in OPD consultation page:
 *   <ReferralCreator
 *     encounterId={encounterId}
 *     patientId={patientId}
 *     patientName="Mrs. Priya Sharma"
 *     patientAge={28}
 *     patientGender="Female"
 *   />
 *
 * NON-BREAKING: New component.
 */
'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  COMMON_REFERRAL_SPECIALTIES,
  COMMON_IMAGING_REFERRALS,
  URGENCY_CONFIG,
  REFERRAL_STATUS,
  generateReferralLetter,
  type ReferralInput,
  type Referral,
  type LetterContext,
} from '@/lib/referral-helpers';

interface ReferralCreatorProps {
  encounterId: string;
  patientId: string;
  patientName: string;
  patientAge: number | string;
  patientGender: string;
  patientPhone?: string;
  doctorId?: string;
  doctorName?: string;
  doctorQualification?: string;
  doctorRegNumber?: string;
  clinicName?: string;
  clinicAddress?: string;
  clinicPhone?: string;
  onReferralCreated?: (referral: Referral) => void;
}

export default function ReferralCreator({
  encounterId,
  patientId,
  patientName,
  patientAge,
  patientGender,
  patientPhone,
  doctorId,
  doctorName = '',
  doctorQualification = '',
  doctorRegNumber = '',
  clinicName = '',
  clinicAddress = '',
  clinicPhone = '',
  onReferralCreated,
}: ReferralCreatorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<Referral[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [letterHtml, setLetterHtml] = useState('');
  const previewRef = useRef<HTMLIFrameElement>(null);

  // Form state
  const [form, setForm] = useState<Partial<ReferralInput>>({
    urgency: 'routine',
  });
  const [investigations, setInvestigations] = useState<Array<{ name: string; date?: string; result?: string }>>([]);
  const [requestedTests, setRequestedTests] = useState<Array<{ name: string; notes?: string }>>([]);

  // Load existing referrals
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/referrals?encounter_id=${encounterId}`);
        const data = await res.json();
        if (data.referrals) setExisting(data.referrals);
      } catch { /* ignore */ }
    }
    load();
  }, [encounterId]);

  const handlePreview = useCallback(() => {
    const ctx: LetterContext = {
      clinicName: clinicName || 'Your Clinic Name',
      clinicAddress: clinicAddress || 'Your Clinic Address',
      clinicPhone: clinicPhone || 'Your Phone',
      doctorName: doctorName || 'Your Name',
      doctorQualification: doctorQualification || 'MBBS, MS (OBG)',
      doctorRegNumber: doctorRegNumber || 'MCI-XXXXX',
      patientName,
      patientAge,
      patientGender,
      patientPhone,
    };

    const html = generateReferralLetter(
      {
        ...form as ReferralInput,
        investigations_done: investigations,
        investigations_requested: requestedTests,
      },
      ctx
    );
    setLetterHtml(html);
    setShowPreview(true);
  }, [form, investigations, requestedTests, patientName, patientAge, patientGender, patientPhone, clinicName, clinicAddress, clinicPhone, doctorName, doctorQualification, doctorRegNumber]);

  const handlePrint = useCallback(() => {
    const iframe = previewRef.current;
    if (iframe?.contentWindow) {
      iframe.contentWindow.print();
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!form.referred_to_name || !form.reason) {
      setError('Referred to and reason are required');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await fetch('/api/referrals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          patient_id: patientId,
          encounter_id: encounterId,
          referring_doctor_id: doctorId,
          referring_doctor_name: doctorName,
          investigations_done: investigations,
          investigations_requested: requestedTests,
          clinic_context: {
            clinicName: clinicName || 'Clinic',
            clinicAddress: clinicAddress || '',
            clinicPhone: clinicPhone || '',
            doctorName: doctorName || '',
            doctorQualification: doctorQualification || '',
            doctorRegNumber: doctorRegNumber || '',
            patientName,
            patientAge,
            patientGender,
            patientPhone,
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setExisting(prev => [...prev, data.referral]);
      if (data.letter_html) setLetterHtml(data.letter_html);
      onReferralCreated?.(data.referral);

      // Reset form
      setForm({ urgency: 'routine' });
      setInvestigations([]);
      setRequestedTests([]);
      setIsOpen(false);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setSaving(false);
    }
  }, [form, investigations, requestedTests, patientId, encounterId, doctorId, doctorName, patientName, patientAge, patientGender, patientPhone, clinicName, clinicAddress, clinicPhone, doctorQualification, doctorRegNumber, onReferralCreated]);

  return (
    <div className="border border-gray-200 rounded-lg">
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b">
        <h3 className="text-sm font-semibold text-gray-700">
          📨 Referrals ({existing.length})
        </h3>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="text-xs px-3 py-1 bg-teal-600 text-white rounded-md hover:bg-teal-700"
        >
          {isOpen ? 'Cancel' : '+ New Referral'}
        </button>
      </div>

      {/* Existing referrals */}
      {existing.length > 0 && (
        <div className="px-4 py-2 space-y-1">
          {existing.map((ref) => {
            const urgCfg = URGENCY_CONFIG[ref.urgency || 'routine'];
            return (
              <div key={ref.id} className="flex items-center justify-between text-sm py-1 border-b border-gray-50 last:border-0">
                <div>
                  <span className="text-gray-800">{ref.referred_to_name}</span>
                  {ref.referred_to_specialty && (
                    <span className="text-xs text-gray-400 ml-1">({ref.referred_to_specialty})</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${urgCfg.bgColor} ${urgCfg.color}`}>
                    {urgCfg.label}
                  </span>
                  <span className="text-xs text-gray-500">{ref.status}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Referral form */}
      {isOpen && !showPreview && (
        <div className="p-4 space-y-4">
          {error && <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</div>}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Refer To (Doctor/Centre)</label>
              <input
                type="text"
                value={form.referred_to_name || ''}
                onChange={(e) => setForm(f => ({ ...f, referred_to_name: e.target.value }))}
                className="w-full border rounded-md px-2 py-1.5 text-sm"
                placeholder="Dr. Name / Centre Name"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Specialty</label>
              <select
                value={form.referred_to_specialty || ''}
                onChange={(e) => setForm(f => ({ ...f, referred_to_specialty: e.target.value }))}
                className="w-full border rounded-md px-2 py-1.5 text-sm"
              >
                <option value="">Select specialty</option>
                {COMMON_REFERRAL_SPECIALTIES.map((s) => (
                  <option key={s.value} value={s.label}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Quick imaging referral buttons */}
          {form.referred_to_specialty?.includes('Sonography') && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Quick Select Imaging</label>
              <div className="flex flex-wrap gap-1">
                {COMMON_IMAGING_REFERRALS.slice(0, 8).map((img) => (
                  <button
                    key={img}
                    onClick={() => setRequestedTests(prev => [...prev, { name: img }])}
                    className="text-xs px-2 py-1 border border-teal-200 text-teal-700 rounded hover:bg-teal-50"
                  >
                    + {img}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Hospital/Centre</label>
              <input
                type="text"
                value={form.referred_to_hospital || ''}
                onChange={(e) => setForm(f => ({ ...f, referred_to_hospital: e.target.value }))}
                className="w-full border rounded-md px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Urgency</label>
              <select
                value={form.urgency || 'routine'}
                onChange={(e) => setForm(f => ({ ...f, urgency: e.target.value as 'routine' | 'urgent' | 'emergency' }))}
                className="w-full border rounded-md px-2 py-1.5 text-sm"
              >
                <option value="routine">Routine</option>
                <option value="urgent">Urgent</option>
                <option value="emergency">Emergency</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Reason for Referral</label>
            <textarea
              rows={2}
              value={form.reason || ''}
              onChange={(e) => setForm(f => ({ ...f, reason: e.target.value }))}
              className="w-full border rounded-md px-2 py-1.5 text-sm"
              placeholder="Reason for referral..."
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Provisional Diagnosis</label>
            <input
              type="text"
              value={form.provisional_diagnosis || ''}
              onChange={(e) => setForm(f => ({ ...f, provisional_diagnosis: e.target.value }))}
              className="w-full border rounded-md px-2 py-1.5 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Clinical Summary</label>
            <textarea
              rows={2}
              value={form.clinical_summary || ''}
              onChange={(e) => setForm(f => ({ ...f, clinical_summary: e.target.value }))}
              className="w-full border rounded-md px-2 py-1.5 text-sm"
              placeholder="Brief clinical history and relevant findings..."
            />
          </div>

          {/* Requested investigations */}
          {requestedTests.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Investigations Requested</label>
              <div className="flex flex-wrap gap-1">
                {requestedTests.map((t, i) => (
                  <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-teal-100 text-teal-800 rounded text-xs">
                    {t.name}
                    <button onClick={() => setRequestedTests(prev => prev.filter((_, j) => j !== i))} className="text-teal-500 hover:text-red-500">✕</button>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={handlePreview}
              disabled={!form.referred_to_name || !form.reason}
              className="px-4 py-2 text-sm text-teal-700 bg-teal-50 border border-teal-200 rounded-md hover:bg-teal-100 disabled:opacity-50"
            >
              Preview Letter
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !form.referred_to_name || !form.reason}
              className="px-4 py-2 text-sm text-white bg-teal-600 rounded-md hover:bg-teal-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Referral'}
            </button>
          </div>
        </div>
      )}

      {/* Letter preview */}
      {showPreview && (
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium text-gray-800 text-sm">Referral Letter Preview</h4>
            <div className="flex gap-2">
              <button onClick={handlePrint} className="text-xs px-3 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700">🖨 Print</button>
              <button onClick={() => setShowPreview(false)} className="text-xs px-3 py-1 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300">Close</button>
            </div>
          </div>
          <iframe
            ref={previewRef}
            srcDoc={letterHtml}
            className="w-full h-[500px] border rounded-md bg-white"
            title="Referral Letter Preview"
          />
        </div>
      )}
    </div>
  );
}
