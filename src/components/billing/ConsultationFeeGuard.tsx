/**
 * src/components/billing/ConsultationFeeGuard.tsx
 *
 * This component sits at the TOP of the New Bill page.
 * It checks whether the consultation fee was already paid and:
 *   - Shows a GREEN banner if fee was already collected
 *   - Disables/removes consultation fee from the service list
 *   - Provides a "No Additional Services — Skip Billing" button
 *   - Shows a YELLOW banner if fee was NOT collected (post-consultation model)
 *
 * Usage in src/app/billing/new/page.tsx:
 *
 *   <ConsultationFeeGuard
 *     patientId={selectedPatientId}
 *     encounterId={encounterId}
 *     queueEntryId={queueId}
 *     onFeeStatusLoaded={(status) => {
 *       // Use status.additionalServicesOnly to filter service list
 *       // Use status.feePaid to disable consultation fee button
 *     }}
 *     onBillingSkipped={() => {
 *       // Navigate back to queue or show success
 *       router.push('/queue');
 *     }}
 *   />
 *
 * NON-BREAKING: New component. Existing billing page works without it.
 */
'use client';

import { useState, useEffect, useCallback } from 'react';
import type { FeeStatus } from '@/lib/billing-workflow';

interface ConsultationFeeGuardProps {
  patientId: string;
  encounterId?: string | null;
  queueEntryId?: string | null;
  onFeeStatusLoaded?: (status: FeeStatus) => void;
  onBillingSkipped?: () => void;
}

export default function ConsultationFeeGuard({
  patientId,
  encounterId,
  queueEntryId,
  onFeeStatusLoaded,
  onBillingSkipped,
}: ConsultationFeeGuardProps) {
  const [feeStatus, setFeeStatus] = useState<FeeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [skipping, setSkipping] = useState(false);

  // Check fee status when patient is selected
  useEffect(() => {
    async function check() {
      if (!patientId) return;
      setLoading(true);
      try {
        const params = new URLSearchParams({ patient_id: patientId });
        if (encounterId) params.set('encounter_id', encounterId);
        if (queueEntryId) params.set('queue_id', queueEntryId);

        const res = await fetch(`/api/billing/fee-status?${params}`);
        const data = await res.json();
        if (data.fee_status) {
          setFeeStatus(data.fee_status);
          onFeeStatusLoaded?.(data.fee_status);
        }
      } catch { /* ignore */ }
      finally { setLoading(false); }
    }
    check();
  }, [patientId, encounterId, queueEntryId, onFeeStatusLoaded]);

  const handleSkipBilling = useCallback(async () => {
    if (!encounterId) return;
    setSkipping(true);
    try {
      await fetch('/api/billing/fee-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'skip_billing',
          encounter_id: encounterId,
          patient_id: patientId,
          reason: 'No additional services — consultation fee already paid at registration',
        }),
      });
      onBillingSkipped?.();
    } catch { /* ignore */ }
    finally { setSkipping(false); }
  }, [encounterId, patientId, onBillingSkipped]);

  if (loading || !feeStatus) return null;

  // ── Fee Already Paid (Upfront Model) ──────────────────────────────────
  if (feeStatus.feePaid) {
    return (
      <div className="mb-4 space-y-3">
        {/* Green banner */}
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <span className="text-green-600 text-xl">✅</span>
            <div className="flex-1">
              <h4 className="font-semibold text-green-800 text-sm">
                Consultation Fee Already Paid
              </h4>
              <p className="text-green-700 text-sm mt-0.5">
                ₹{feeStatus.feeAmount} collected at registration
                {feeStatus.receiptNumber && ` (Receipt: ${feeStatus.receiptNumber})`}
                {feeStatus.paymentMode && ` via ${feeStatus.paymentMode.toUpperCase()}`}
              </p>
              <p className="text-green-600 text-xs mt-1">
                Only additional services (labs, procedures, consumables) should be billed below.
                The consultation fee will NOT appear in the service list.
              </p>
            </div>
          </div>
        </div>

        {/* Skip billing button */}
        {encounterId && (
          <button
            onClick={handleSkipBilling}
            disabled={skipping}
            className="w-full py-2.5 text-sm font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {skipping ? (
              'Processing...'
            ) : (
              <>
                <span>🚫</span>
                No Additional Services — Skip Billing for This Visit
              </>
            )}
          </button>
        )}
      </div>
    );
  }

  // ── Fee Not Yet Paid (Post-Consultation or first-time) ────────────────
  return (
    <div className="mb-4">
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <span className="text-amber-600 text-xl">⚠️</span>
          <div className="flex-1">
            <h4 className="font-semibold text-amber-800 text-sm">
              Consultation Fee Not Yet Collected
            </h4>
            <p className="text-amber-700 text-sm mt-0.5">
              The consultation/registration fee has not been collected for this visit.
              {feeStatus.billingModel === 'upfront' && (
                <span className="block text-xs mt-1">
                  Your clinic uses upfront fee collection. This fee should normally be collected at registration.
                </span>
              )}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
