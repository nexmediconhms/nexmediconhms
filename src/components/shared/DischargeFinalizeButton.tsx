// src/components/shared/DischargeFinalizeButton.tsx
// Discharge Summary — Finalize / Unfinalize button widget.
//
// Renders:
//  • Green "Finalize & Sign" button when not yet finalised (doctor/admin)
//  • Locked "Finalised ✓" badge with signedBy/signedAt when done
//  • Admin-only "Admin Undo" link that opens a reason modal before calling
//    PATCH /api/discharge/unfinalize
//
// Uses ONLY:
//  PATCH /api/discharge/finalize    (new route)
//  PATCH /api/discharge/unfinalize  (new route)
//  lucide-react icons (already installed)
//
// Props are chosen to match the fields already used in the existing
// DischargeSummaryPage — no new types needed.

"use client";

import { useState } from "react";
import { Lock, Unlock, CheckCircle, Loader2, AlertTriangle } from "lucide-react";

interface Props {
  dischargeId: string | undefined;
  isFinal: boolean;
  signedBy?: string;
  signedAt?: string;
  /** "doctor" | "admin" | "staff" — from auth context or passed from page */
  userRole: string;
  /** Name of current logged-in user — pre-fills the signedBy field */
  userName?: string;
  /** Called after successful finalise with the new signed data */
  onFinalized: (signedBy: string, signedAt: string) => void;
  /** Called after successful unfinalize */
  onUnfinalized: () => void;
  /** Disable when the DS form has unsaved changes */
  hasUnsavedChanges?: boolean;
}

export default function DischargeFinalizeButton({
  dischargeId,
  isFinal,
  signedBy,
  signedAt,
  userRole,
  userName,
  onFinalized,
  onUnfinalized,
  hasUnsavedChanges = false,
}: Props) {
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState("");
  const [showUndoModal, setShowUndoModal] = useState(false);
  const [undoReason, setUndoReason]     = useState("");
  const [undoLoading, setUndoLoading]   = useState(false);
  const [undoError, setUndoError]       = useState("");

  const isAdminOrDoctor = userRole === "admin" || userRole === "doctor";
  const isAdmin         = userRole === "admin";

  // ── Finalize ──────────────────────────────────────────────────────────
  async function handleFinalize() {
    if (!dischargeId) {
      setError("Please save the discharge summary before finalising.");
      return;
    }
    if (hasUnsavedChanges) {
      setError("You have unsaved changes. Please save first.");
      return;
    }
    if (
      !window.confirm(
        "Finalise this discharge summary? Once finalised, it cannot be edited without admin override."
      )
    )
      return;

    setLoading(true);
    setError("");
    try {
      const res  = await fetch("/api/discharge/finalize", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ dischargeId, signedBy: userName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Finalisation failed");
        return;
      }
      onFinalized(data.signedby ?? userName ?? "", data.signedat ?? new Date().toISOString());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  // ── Unfinalize ───────────────────────────────────────────────────────
  async function handleUnfinalize() {
    if (!undoReason.trim() || undoReason.trim().length < 5) {
      setUndoError("Please enter a reason (min 5 characters).");
      return;
    }
    setUndoLoading(true);
    setUndoError("");
    try {
      const res  = await fetch("/api/discharge/unfinalize", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ dischargeId, reason: undoReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setUndoError(data.error ?? "Unfinalize failed");
        return;
      }
      setShowUndoModal(false);
      setUndoReason("");
      onUnfinalized();
    } catch (e: unknown) {
      setUndoError(e instanceof Error ? e.message : "Network error");
    } finally {
      setUndoLoading(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────
  if (isFinal) {
    // Finalised state — show locked badge
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
          <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-green-800">Discharge Summary Finalised</p>
            {signedBy && (
              <p className="text-xs text-green-700">
                Signed by {signedBy}
                {signedAt
                  ? ` on ${new Date(signedAt).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}`
                  : ""}
              </p>
            )}
          </div>
          <Lock className="w-4 h-4 text-green-500 flex-shrink-0" />
        </div>

        {/* Admin-only undo */}
        {isAdmin && (
          <button
            type="button"
            onClick={() => setShowUndoModal(true)}
            className="flex items-center gap-1.5 text-xs text-orange-600 hover:text-orange-800 hover:underline transition-colors"
          >
            <Unlock className="w-3.5 h-3.5" />
            Admin: Undo Finalisation
          </button>
        )}

        {/* Undo modal */}
        {showUndoModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
              <div className="flex items-center gap-2 text-orange-700">
                <AlertTriangle className="w-5 h-5" />
                <h3 className="font-bold text-base">Undo Finalisation</h3>
              </div>
              <p className="text-sm text-gray-600">
                This action will re-open the discharge summary for editing. A
                mandatory reason is required and will be recorded in the audit
                log.
              </p>
              <div>
                <label className="label">Reason *</label>
                <textarea
                  className="input resize-none"
                  rows={3}
                  placeholder="e.g. Typographic error in diagnosis code, patient name correction..."
                  value={undoReason}
                  onChange={(e) => setUndoReason(e.target.value)}
                />
              </div>
              {undoError && (
                <p className="text-sm text-red-600">{undoError}</p>
              )}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleUnfinalize}
                  disabled={undoLoading}
                  className="btn-primary bg-orange-600 hover:bg-orange-700 flex items-center gap-2 text-sm disabled:opacity-60"
                >
                  {undoLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Confirm Undo
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowUndoModal(false);
                    setUndoReason("");
                    setUndoError("");
                  }}
                  className="btn-secondary text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Not finalised — show finalise button
  if (!isAdminOrDoctor) return null;

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleFinalize}
        disabled={loading || !dischargeId}
        className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Lock className="w-4 h-4" />
        )}
        Finalize &amp; Sign Discharge Summary
      </button>
      {!dischargeId && (
        <p className="text-xs text-gray-400">Save the form at least once before finalising.</p>
      )}
      {hasUnsavedChanges && (
        <p className="text-xs text-orange-500">You have unsaved changes — save first.</p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
