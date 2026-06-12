/**
 * src/components/billing/RegistrationFeeCollector.tsx
 *
 * Placed on the queue page or patient registration page.
 * Allows front-desk staff to collect and record the consultation fee
 * at the time of registration, BEFORE the patient sees the doctor.
 *
 * Usage in queue page (after patient is added to queue):
 *   <RegistrationFeeCollector
 *     patientId={entry.patient_id}
 *     queueEntryId={entry.id}
 *     encounterId={entry.encounter_id}
 *     visitType={entry.visit_type || 'OPD'}
 *   />
 *
 * NON-BREAKING: New component. Existing queue page unchanged.
 */
'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { DEFAULT_CONSULTATION_FEES } from '@/lib/billing-workflow';

interface RegistrationFeeCollectorProps {
  patientId: string;
  queueEntryId?: string;
  encounterId?: string;
  visitType?: string;
  onFeePaid?: (data: { amount: number; receiptNumber?: string }) => void;
}

export default function RegistrationFeeCollector({
  patientId,
  queueEntryId,
  encounterId,
  visitType = 'OPD',
  onFeePaid,
}: RegistrationFeeCollectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [feePaid, setFeePaid] = useState(false);
  const [feeAmount, setFeeAmount] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form
  const [paymentMode, setPaymentMode] = useState<string>('cash');
  const [receiptNumber, setReceiptNumber] = useState('');
  const [customAmount, setCustomAmount] = useState('');

  // Default fee based on visit type
  const defaultFee = useMemo(() => {
    const feeKey = `${visitType} Consultation`;
    return DEFAULT_CONSULTATION_FEES[feeKey] || DEFAULT_CONSULTATION_FEES['OPD Consultation'] || 500;
  }, [visitType]);

  // Check existing fee status on mount
  useEffect(() => {
    async function check() {
      try {
        const params = new URLSearchParams({ patient_id: patientId });
        if (encounterId) params.set('encounter_id', encounterId);
        if (queueEntryId) params.set('queue_id', queueEntryId);

        const res = await fetch(`/api/billing/fee-status?${params}`);
        const data = await res.json();
        if (data.fee_status?.feePaid) {
          setFeePaid(true);
          setFeeAmount(data.fee_status.feeAmount);
        }
      } catch { /* ignore */ }
    }
    check();
  }, [patientId, encounterId, queueEntryId]);

  const handleCollect = useCallback(async () => {
    const amount = customAmount ? parseFloat(customAmount) : defaultFee;
    if (!amount || amount <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await fetch('/api/billing/fee-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'mark_paid',
          patient_id: patientId,
          encounter_id: encounterId,
          queue_id: queueEntryId,
          amount,
          receipt_number: receiptNumber || undefined,
          payment_mode: paymentMode,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setFeePaid(true);
      setFeeAmount(amount);
      setIsOpen(false);
      onFeePaid?.({ amount, receiptNumber });
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setSaving(false);
    }
  }, [patientId, encounterId, queueEntryId, customAmount, defaultFee, receiptNumber, paymentMode, onFeePaid]);

  // Already paid — show green badge
  if (feePaid) {
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-green-50 border border-green-200 rounded-full text-xs text-green-700">
        <span>✓</span>
        <span>Fee Paid ₹{feeAmount}</span>
      </div>
    );
  }

  // Not yet paid — show collect button
  return (
    <div className="inline-block relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 border border-amber-200 rounded-full text-xs text-amber-700 hover:bg-amber-100"
      >
        <span>💰</span>
        <span>Collect Fee (₹{defaultFee})</span>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-72 bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-4 space-y-3">
          <h4 className="text-sm font-semibold text-gray-700">Collect Consultation Fee</h4>

          {error && <div className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</div>}

          <div>
            <label className="block text-xs text-gray-500 mb-1">Amount (₹)</label>
            <input
              type="number"
              value={customAmount || defaultFee}
              onChange={(e) => setCustomAmount(e.target.value)}
              className="w-full border rounded-md px-2 py-1.5 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Payment Mode</label>
            <div className="flex gap-1">
              {['cash', 'card', 'upi'].map(mode => (
                <button key={mode} onClick={() => setPaymentMode(mode)}
                  className={`text-xs px-3 py-1.5 rounded-md border ${paymentMode === mode ? 'bg-blue-100 border-blue-300 text-blue-800' : 'border-gray-200'}`}>
                  {mode === 'cash' ? '💵 Cash' : mode === 'card' ? '💳 Card' : '📱 UPI'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Receipt Number (optional)</label>
            <input
              type="text"
              value={receiptNumber}
              onChange={(e) => setReceiptNumber(e.target.value)}
              placeholder="Auto or manual receipt #"
              className="w-full border rounded-md px-2 py-1.5 text-sm"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={() => setIsOpen(false)} className="px-3 py-1.5 text-xs bg-gray-100 rounded-md">Cancel</button>
            <button onClick={handleCollect} disabled={saving}
              className="px-3 py-1.5 text-xs bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50">
              {saving ? 'Saving...' : '✓ Mark as Paid'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
