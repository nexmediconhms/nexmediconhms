// src/components/shared/ABHAVerificationSection.tsx
// Self-contained ABHA verification + creation widget.
//
// Props:
//   value        — current abhaid string in the parent form
//   onChange     — called with the verified ABHA number when confirmed
//   onProfileSet — optional: called with the full ABDM profile object
//   disabled     — when true (e.g. isFinal) renders read-only badge
//
// Modes:
//   "verify"  — patient already has ABHA; look it up by ID or health address
//   "create"  — create a new ABHA via Aadhaar OTP (two-step)
//
// Uses ONLY the existing API routes:
//   POST /api/abdm/verify           (existing)
//   POST /api/abdm/search           (existing)
//   POST /api/abdm/create-init      (updated)
//   POST /api/abdm/create-verify-otp (updated)
//
// No new libs required — only React + lucide-react which are already installed.

"use client";

import { useState } from "react";
import {
  Shield,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Loader2,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────
interface ABHAProfile {
  healthIdNumber?: string;
  healthId?: string;
  name?: string;
  gender?: string;
  yearOfBirth?: number;
  mobile?: string;
  status?: string;
  simulated?: boolean;
}

type VerifyMode = "verify" | "create";
type StepCreate = "aadhaar" | "otp" | "done";

interface Props {
  /** Current value of the abhaid field in parent form */
  value: string;
  /** Called with the final verified ABHA number string */
  onChange: (abhaId: string) => void;
  /** Optional — gives parent the full profile for auto-fill */
  onProfileSet?: (profile: ABHAProfile) => void;
  /** Disables all interactions (e.g. when discharge is finalised) */
  disabled?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function ABHAVerificationSection({
  value,
  onChange,
  onProfileSet,
  disabled = false,
}: Props) {
  const [expanded, setExpanded]     = useState(false);
  const [mode, setMode]             = useState<VerifyMode>("verify");
  const [input, setInput]           = useState(value ?? "");
  const [aadhaar, setAadhaar]       = useState("");
  const [otp, setOtp]               = useState("");
  const [txnId, setTxnId]           = useState("");
  const [step, setStep]             = useState<StepCreate>("aadhaar");
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");
  const [profile, setProfile]       = useState<ABHAProfile | null>(null);
  const [verified, setVerified]     = useState(false);
  const [simulated, setSimulated]   = useState(false);

  function reset() {
    setInput(value ?? "");
    setAadhaar("");
    setOtp("");
    setTxnId("");
    setStep("aadhaar");
    setLoading(false);
    setError("");
    setProfile(null);
    setVerified(false);
    setSimulated(false);
  }

  // ── VERIFY mode — look up existing ABHA ─────────────────────────────
  async function handleVerify() {
    setError("");
    setLoading(true);
    try {
      const cleaned = input.trim();
      // Decide endpoint: health address contains "@", number is 14 digits
      const isAddress = cleaned.includes("@");
      const endpoint  = isAddress ? "/api/abdm/search" : "/api/abdm/verify";
      const body      = isAddress ? { healthId: cleaned } : { abhaNumber: cleaned };

      const res  = await fetch(endpoint, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error ?? "Verification failed");
        return;
      }

      const p: ABHAProfile = data.profile ?? {};
      setProfile(p);
      setVerified(true);
      setSimulated(!!data.simulated);
      // Normalise to 14-digit number
      const finalId = p.healthIdNumber
        ? p.healthIdNumber.replace(/-/g, "")
        : cleaned.replace(/-/g, "");
      onChange(finalId);
      onProfileSet?.(p);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  // ── CREATE mode — Step 1: send Aadhaar OTP ───────────────────────────
  async function handleSendOtp() {
    setError("");
    setLoading(true);
    try {
      const res  = await fetch("/api/abdm/create-init", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ aadhaar: aadhaar.trim() }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        setError(data.error ?? "Failed to send OTP");
        return;
      }
      setTxnId(data.txnId);
      setSimulated(!!data.simulated);
      setStep("otp");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  // ── CREATE mode — Step 2: verify OTP → create ABHA ──────────────────
  async function handleVerifyOtp() {
    setError("");
    setLoading(true);
    try {
      const res  = await fetch("/api/abdm/create-verify-otp", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ txnId, otp: otp.trim() }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error ?? "OTP verification failed");
        return;
      }

      const p: ABHAProfile = {
        healthIdNumber: data.healthIdNumber,
        healthId:       data.healthId,
        simulated:      !!data.simulated,
      };
      setProfile(p);
      setVerified(true);
      setSimulated(!!data.simulated);
      setStep("done");
      const finalId = (data.healthIdNumber ?? "").replace(/-/g, "");
      onChange(finalId);
      onProfileSet?.(p);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────
  const isVerifiedDisplay = verified && profile;

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      {/* Header toggle */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-blue-50 hover:bg-blue-100 transition-colors"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-blue-800">
          {isVerifiedDisplay ? (
            <ShieldCheck className="w-4 h-4 text-green-600" />
          ) : (
            <Shield className="w-4 h-4 text-blue-600" />
          )}
          ABHA / ABDM Verification
          {isVerifiedDisplay && (
            <span className="ml-2 text-xs font-medium bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
              {simulated ? "Simulated" : "Verified"}
            </span>
          )}
        </span>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-blue-600" />
        ) : (
          <ChevronDown className="w-4 h-4 text-blue-600" />
        )}
      </button>

      {expanded && !disabled && (
        <div className="p-4 space-y-4 bg-white">
          {/* Mode tabs */}
          {!verified && (
            <div className="flex gap-2">
              {(["verify", "create"] as VerifyMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setMode(m); reset(); }}
                  className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                    mode === m
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {m === "verify" ? "Has ABHA" : "Create New ABHA"}
                </button>
              ))}
            </div>
          )}

          {/* ── VERIFY mode UI ──────────────────────────────────────── */}
          {mode === "verify" && !verified && (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">
                Enter the patient&apos;s 14-digit ABHA number or ABHA address
                (e.g. <code className="font-mono">91-1234-5678-9012</code> or{" "}
                <code className="font-mono">name@abdm</code>).
              </p>
              <input
                className="input w-full"
                placeholder="ABHA number or address@abdm"
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
              <button
                type="button"
                onClick={handleVerify}
                disabled={loading || !input.trim()}
                className="btn-primary flex items-center gap-2 text-sm disabled:opacity-60"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                Verify ABHA
              </button>
            </div>
          )}

          {/* ── CREATE mode UI ──────────────────────────────────────── */}
          {mode === "create" && !verified && (
            <div className="space-y-3">
              {step === "aadhaar" && (
                <>
                  <p className="text-xs text-gray-500">
                    Enter the patient&apos;s 12-digit Aadhaar number. An OTP
                    will be sent to the Aadhaar-linked mobile number.
                  </p>
                  <input
                    className="input w-full font-mono"
                    placeholder="123456789012"
                    maxLength={12}
                    value={aadhaar}
                    onChange={(e) => setAadhaar(e.target.value.replace(/\D/g, ""))}
                  />
                  <button
                    type="button"
                    onClick={handleSendOtp}
                    disabled={loading || aadhaar.length !== 12}
                    className="btn-primary flex items-center gap-2 text-sm disabled:opacity-60"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Send OTP
                  </button>
                </>
              )}

              {step === "otp" && (
                <>
                  <p className="text-xs text-gray-500">
                    Enter the 6-digit OTP sent to the Aadhaar-linked mobile.
                    {simulated && (
                      <span className="ml-1 text-orange-600 font-medium">
                        (Simulated mode — use OTP: 000000)
                      </span>
                    )}
                  </p>
                  <input
                    className="input w-full font-mono tracking-widest"
                    placeholder="000000"
                    maxLength={6}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleVerifyOtp}
                      disabled={loading || otp.length !== 6}
                      className="btn-primary flex items-center gap-2 text-sm disabled:opacity-60"
                    >
                      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                      Verify &amp; Create ABHA
                    </button>
                    <button
                      type="button"
                      onClick={() => { setStep("aadhaar"); setOtp(""); setError(""); }}
                      className="btn-secondary text-sm"
                    >
                      Back
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Error ─────────────────────────────────────────────────── */}
          {error && (
            <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* ── Verified profile card ────────────────────────────────── */}
          {verified && profile && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-1">
              <div className="flex items-center gap-2 text-green-700 font-semibold text-sm">
                <CheckCircle className="w-4 h-4" />
                ABHA {simulated ? "Simulated" : "Verified"}
              </div>
              {profile.healthIdNumber && (
                <p className="text-xs text-gray-700 font-mono">
                  Number: {profile.healthIdNumber}
                </p>
              )}
              {profile.healthId && (
                <p className="text-xs text-gray-600">
                  Address: {profile.healthId}
                </p>
              )}
              {profile.name && (
                <p className="text-xs text-gray-600">Name: {profile.name}</p>
              )}
              {simulated && (
                <p className="text-xs text-orange-600 mt-1">
                  ⚠ Simulated — configure ABDM credentials for live verification.
                </p>
              )}
              <button
                type="button"
                onClick={reset}
                className="mt-2 flex items-center gap-1 text-xs text-blue-600 hover:underline"
              >
                <RefreshCw className="w-3 h-3" /> Re-verify
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
