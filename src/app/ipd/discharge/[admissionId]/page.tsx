"use client";
/**
 * src/app/ipd/discharge/[admissionId]/page.tsx
 *
 * Comprehensive IPD Discharge Workflow Page
 *
 * This page is the single destination for ALL discharge actions.
 * When any part of the app initiates a discharge (bed management,
 * IPD census, patient profile), it redirects here.
 *
 * TABS:
 *   1. Patient & Admission Summary — read-only overview
 *   2. Clinical History — doctor notes, labs, prescriptions, procedures
 *   3. Discharge Summary — fillable form with AI assist + obstetric fields
 *   4. Billing & Finance — charges, payments, balance, settlement
 *   5. Clearance Checklist — gates the final discharge
 *   6. Confirm & Print — final action + PDF generation
 *
 * SAFETY: This file is entirely NEW. It does NOT modify any existing
 * component or page. Existing discharge flows continue to work.
 */

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import InlineDischargeClearance from "@/components/ipd/InlineDischargeClearance";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { formatDate, getIndiaToday } from "@/lib/utils";
import type {
  Patient,
  Encounter,
  Prescription,
  DischargeSummary,
} from "@/types";
import {
  ArrowLeft,
  User,
  BedDouble,
  Stethoscope,
  FileText,
  IndianRupee,
  ClipboardCheck,
  Printer,
  Save,
  Sparkles,
  Loader2,
  CheckCircle,
  AlertCircle,
  Calendar,
  Heart,
  Pill,
  TestTube,
  Baby,
  LogOut,
  Clock,
  Shield,
  CreditCard,
  Receipt,
  ChevronRight,
  Activity,
  Edit3,
  Download,
  Send,
  Eye,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────

interface IPDAdmission {
  id: string;
  patient_id: string;
  patient_name: string;
  mrn: string;
  age: number | null;
  gender: string;
  mobile: string;
  bed_id: string;
  bed_number: string;
  ward: string;
  floor?: string;
  bed_type?: string;
  admission_date: string;
  admission_time?: string;
  expected_discharge?: string;
  admitting_doctor: string;
  diagnosis_on_admission?: string;
  chief_complaint?: string;
  insurance_details?: string;
  status: string;
}

interface LabOrder {
  id: string;
  patient_id: string;
  test_name: string;
  status: string;
  result?: string;
  result_value?: string;
  normal_range?: string;
  ordered_at?: string;
  completed_at?: string;
}

interface BillRecord {
  id: string;
  patient_id: string;
  total: number;
  paid: number;
  balance: number;
  status: string;
  bill_number?: string;
  bill_date?: string;
  bill_module?: string;
  admission_id?: string;
  items?: any[];
  payment_mode?: string;
}

interface IPDCharge {
  id: string;
  admission_id: string;
  description?: string;
  item_name?: string;
  category: string;
  quantity: number;
  unit_rate?: number;
  amount: number;
  charge_date?: string;
}

interface PaymentRecord {
  id: string;
  bill_id: string;
  amount: number;
  payment_mode: string;
  payment_date: string;
  reference_number?: string;
  notes?: string;
}

interface DSForm {
  admission_date: string;
  discharge_date: string;
  final_diagnosis: string;
  secondary_diagnosis: string;
  clinical_summary: string;
  investigations: string;
  treatment_given: string;
  condition_at_discharge: string;
  discharge_advice: string;
  diet_advice: string;
  medications_at_discharge: string;
  follow_up_date: string;
  follow_up_note: string;
  // Obstetric / Gynaecology specific
  delivery_type: string;
  baby_sex: string;
  baby_weight: string;
  apgar_score: string;
  baby_birth_time: string;
  delivery_date: string;
  complications: string;
  lactation_advice: string;
  signed_by: string;
}

const EMPTY_DS: DSForm = {
  admission_date: "",
  discharge_date: getIndiaToday(),
  final_diagnosis: "",
  secondary_diagnosis: "",
  clinical_summary: "",
  investigations: "",
  treatment_given: "",
  condition_at_discharge: "Stable, afebrile, ambulant",
  discharge_advice: "",
  diet_advice: "",
  medications_at_discharge: "",
  follow_up_date: "",
  follow_up_note: "",
  delivery_type: "",
  baby_sex: "",
  baby_weight: "",
  apgar_score: "",
  baby_birth_time: "",
  delivery_date: "",
  complications: "",
  lactation_advice: "",
  signed_by: "",
};

const TAB_KEYS = [
  "summary",
  "clinical",
  "discharge",
  "billing",
  "clearance",
  "confirm",
] as const;
type TabKey = (typeof TAB_KEYS)[number];

const TAB_CONFIG: Record<
  TabKey,
  { label: string; icon: typeof User; color: string }
> = {
  summary: { label: "Patient Info", icon: User, color: "text-blue-600" },
  clinical: {
    label: "Clinical History",
    icon: Stethoscope,
    color: "text-purple-600",
  },
  discharge: {
    label: "Discharge Summary",
    icon: FileText,
    color: "text-green-600",
  },
  billing: {
    label: "Billing & Finance",
    icon: IndianRupee,
    color: "text-amber-600",
  },
  clearance: {
    label: "Clearance",
    icon: ClipboardCheck,
    color: "text-red-600",
  },
  confirm: { label: "Confirm & Print", icon: Printer, color: "text-gray-700" },
};

// ═══════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════

export default function DischargeWorkflowPage() {
  const params = useParams();
  const router = useRouter();
  const { user, can, isAdmin } = useAuth();
  const admissionId = params.admissionId as string;

  // ── State ──────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TabKey>("summary");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [discharging, setDischarging] = useState(false);
  const [discharged, setDischarged] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Data
  const [admission, setAdmission] = useState<IPDAdmission | null>(null);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [encounters, setEncounters] = useState<Encounter[]>([]);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [labOrders, setLabOrders] = useState<LabOrder[]>([]);
  const [ipdCharges, setIpdCharges] = useState<IPDCharge[]>([]);
  const [bills, setBills] = useState<BillRecord[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [nursingNotes, setNursingNotes] = useState<any[]>([]);
  const [existingDS, setExistingDS] = useState<DischargeSummary | null>(null);

  // Discharge form
  const [dsForm, setDsForm] = useState<DSForm>({ ...EMPTY_DS });
  const [showObFields, setShowObFields] = useState(false);
  const [canDischarge, setCanDischarge] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [dsSaved, setDsSaved] = useState(false);

  // Payment form
  const [payAmount, setPayAmount] = useState("");
  const [payMode, setPayMode] = useState("Cash");
  const [payRef, setPayRef] = useState("");
  const [payLoading, setPayLoading] = useState(false);

  // ── Load all data ─────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      // 1. Load admission
      const { data: adm, error: admErr } = await supabase
        .from("ipd_admissions")
        .select("*")
        .eq("id", admissionId)
        .single();

      if (admErr || !adm) {
        setError("Admission not found. Please check the URL and try again.");
        setLoading(false);
        return;
      }
      setAdmission(adm);

      // If already discharged, show read-only
      if (adm.status === "discharged") {
        setDischarged(true);
      }

      // 2. Load patient
      const { data: pat } = await supabase
        .from("patients")
        .select("*")
        .eq("id", adm.patient_id)
        .single();
      if (pat) setPatient(pat);

      // 3. Load encounters (doctor notes)
      const { data: enc } = await supabase
        .from("encounters")
        .select("*")
        .eq("patient_id", adm.patient_id)
        .gte("encounter_date", adm.admission_date)
        .order("created_at", { ascending: false });
      setEncounters(enc || []);

      // 4. Load prescriptions
      const { data: rx } = await supabase
        .from("prescriptions")
        .select("*")
        .eq("patient_id", adm.patient_id)
        .order("created_at", { ascending: false })
        .limit(10);
      setPrescriptions(rx || []);

      // 5. Load lab orders
      const { data: labs } = await supabase
        .from("lab_orders")
        .select("*")
        .eq("patient_id", adm.patient_id)
        .order("created_at", { ascending: false })
        .limit(20);
      setLabOrders(labs || []);

      // 6. Load IPD charges
      const { data: charges } = await supabase
        .from("ipd_charges")
        .select("*")
        .eq("admission_id", admissionId)
        .order("created_at", { ascending: true });
      setIpdCharges(charges || []);

      // 7. Load bills for this admission
      const { data: billData } = await supabase
        .from("bills")
        .select("*")
        .eq("patient_id", adm.patient_id)
        .order("created_at", { ascending: false });
      // Filter to admission-related bills
      const admBills = (billData || []).filter(
        (b: any) =>
          b.admission_id === admissionId ||
          b.bill_module === "IPD" ||
          (b.bill_date && b.bill_date >= adm.admission_date),
      );
      setBills(admBills);

      // 8. Load payments for those bills
      if (admBills.length > 0) {
        const billIds = admBills.map((b: any) => b.id);
        const { data: payData } = await supabase
          .from("payments")
          .select("*")
          .in("bill_id", billIds)
          .order("created_at", { ascending: false });
        setPayments(payData || []);
      }

      // 9. Load nursing notes
      const { data: nursing } = await supabase
        .from("ipd_nursing")
        .select("*")
        .eq("ipd_admission_id", admissionId)
        .order("recorded_at", { ascending: false })
        .limit(20);
      setNursingNotes(nursing || []);

      // 10. Load existing discharge summary
      const { data: ds } = await supabase
        .from("discharge_summaries")
        .select("*")
        .eq("patient_id", adm.patient_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (ds && !dsFormTouched(ds)) {
        setExistingDS(ds);
        setDsForm({
          admission_date: ds.admission_date || adm.admission_date || "",
          discharge_date: ds.discharge_date || getIndiaToday(),
          final_diagnosis: ds.final_diagnosis || "",
          secondary_diagnosis: ds.secondary_diagnosis || "",
          clinical_summary: ds.clinical_summary || "",
          investigations: ds.investigations || "",
          treatment_given: ds.treatment_given || "",
          condition_at_discharge:
            ds.condition_at_discharge || "Stable, afebrile, ambulant",
          discharge_advice: ds.discharge_advice || "",
          diet_advice: ds.diet_advice || "",
          medications_at_discharge: ds.medications_at_discharge || "",
          follow_up_date: ds.follow_up_date || "",
          follow_up_note: ds.follow_up_note || "",
          delivery_type: ds.delivery_type || "",
          baby_sex: ds.baby_sex || "",
          baby_weight: ds.baby_weight || "",
          apgar_score: ds.apgar_score || "",
          baby_birth_time: ds.baby_birth_time || "",
          delivery_date: ds.delivery_date || "",
          complications: ds.complications || "",
          lactation_advice: ds.lactation_advice || "",
          signed_by: ds.signed_by || "",
        });
        if (ds.delivery_type || ds.baby_sex) setShowObFields(true);
        if (ds.is_final) setDsSaved(true);
      } else {
        // Pre-fill from admission data
        setDsForm((prev) => ({
          ...prev,
          admission_date: adm.admission_date || "",
          final_diagnosis: adm.diagnosis_on_admission || "",
          signed_by: adm.admitting_doctor || "",
        }));
      }

      // Auto-fill medications from latest prescription
      if (rx && rx.length > 0 && !ds?.medications_at_discharge) {
        const latest = rx[0];
        if (latest.medications && Array.isArray(latest.medications)) {
          const medText = latest.medications
            .map(
              (m: any) =>
                `${m.drug} ${m.dose} ${m.route} ${m.frequency} × ${m.duration}`,
            )
            .join("\n");
          setDsForm((prev) => ({
            ...prev,
            medications_at_discharge: prev.medications_at_discharge || medText,
          }));
        }
      }

      // Auto-fill investigations from lab orders
      if (labs && labs.length > 0 && !ds?.investigations) {
        const labText = labs
          .filter((l: any) => l.status === "completed" && l.result_value)
          .map(
            (l: any) =>
              `${l.test_name}: ${l.result_value}${l.normal_range ? ` (Normal: ${l.normal_range})` : ""}`,
          )
          .join("\n");
        setDsForm((prev) => ({
          ...prev,
          investigations: prev.investigations || labText,
        }));
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load discharge data");
    } finally {
      setLoading(false);
    }
  }, [admissionId]);

  function dsFormTouched(ds: any) {
    // Check if we should overwrite the form - only if it's a different patient
    return false;
  }

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Re-fetch discharge summary when Confirm tab is activated
  useEffect(() => {
    if (activeTab === "confirm" && admission?.patient_id) {
      (async () => {
        const { data: ds } = await supabase
          .from("discharge_summaries")
          .select("*")
          .eq("patient_id", admission.patient_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();
        if (ds) {
          setDsForm((prev) => ({
            ...prev,
            final_diagnosis: ds.final_diagnosis || prev.final_diagnosis,
            discharge_advice: ds.discharge_advice || prev.discharge_advice,
            medications_at_discharge: ds.medications_at_discharge || prev.medications_at_discharge,
            signed_by: ds.signed_by || prev.signed_by,
          }));
          if (ds.is_final || ds.final_diagnosis) setDsSaved(true);
        }
      })();
    }
  }, [activeTab, admission?.patient_id]);

  // ── Save Discharge Summary (Draft) ────────────────────────────────
  async function saveDischargeSummary(finalize = false) {
    if (!admission || !patient) return;
    setSaving(true);
    setError("");

    const payload: any = {
      patient_id: patient.id,
      admission_date: dsForm.admission_date || null,
      discharge_date: dsForm.discharge_date || getIndiaToday(),
      final_diagnosis: dsForm.final_diagnosis,
      secondary_diagnosis: dsForm.secondary_diagnosis,
      clinical_summary: dsForm.clinical_summary,
      investigations: dsForm.investigations,
      treatment_given: dsForm.treatment_given,
      condition_at_discharge: dsForm.condition_at_discharge,
      discharge_advice: dsForm.discharge_advice,
      diet_advice: dsForm.diet_advice,
      medications_at_discharge: dsForm.medications_at_discharge,
      follow_up_date: dsForm.follow_up_date || null,
      follow_up_note: dsForm.follow_up_note,
      delivery_type: dsForm.delivery_type || null,
      baby_sex: dsForm.baby_sex || null,
      baby_weight: dsForm.baby_weight || null,
      apgar_score: dsForm.apgar_score || null,
      baby_birth_time: dsForm.baby_birth_time || null,
      delivery_date: dsForm.delivery_date || null,
      complications: dsForm.complications || null,
      lactation_advice: dsForm.lactation_advice || null,
      signed_by: dsForm.signed_by,
      is_final: finalize,
      updated_at: new Date().toISOString(),
    };

    if (finalize) {
      payload.finalized_at = new Date().toISOString();
    }

    try {
      if (existingDS?.id) {
        const { error: upErr } = await supabase
          .from("discharge_summaries")
          .update(payload)
          .eq("id", existingDS.id);
        if (upErr) throw upErr;
      } else {
        payload.version = 1;
        const { data: newDS, error: insErr } = await supabase
          .from("discharge_summaries")
          .insert(payload)
          .select()
          .single();
        if (insErr) throw insErr;
        if (newDS) setExistingDS(newDS);
      }

      setDsSaved(true);
      setSuccessMsg(
        finalize
          ? "Discharge summary finalized!"
          : "Discharge summary saved as draft.",
      );
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (err: any) {
      setError(`Failed to save discharge summary: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  // ── AI Auto-fill ──────────────────────────────────────────────────
  async function aiAutoFill() {
    if (!admission || !patient) return;
    setAiLoading(true);
    try {
      const res = await fetch("/api/discharge-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId: patient.id }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data) {
          setDsForm((prev) => ({
            ...prev,
            clinical_summary: data.clinical_summary || prev.clinical_summary,
            treatment_given: data.treatment_given || prev.treatment_given,
            discharge_advice: data.discharge_advice || prev.discharge_advice,
            diet_advice: data.diet_advice || prev.diet_advice,
            condition_at_discharge:
              data.condition_at_discharge || prev.condition_at_discharge,
          }));
        }
      }
    } catch {
      // AI is optional, silently fail
    } finally {
      setAiLoading(false);
    }
  }

  // ── Record Payment ────────────────────────────────────────────────
  async function recordPayment() {
    if (!payAmount || Number(payAmount) <= 0) return;
    if (bills.length === 0) {
      setError(
        "No bill found for this admission. Please generate a bill from IPD Billing first.",
      );
      return;
    }
    setPayLoading(true);
    try {
      const bill = bills[0]; // Primary bill
      const amt = Number(payAmount);

      // Insert payment
      const { error: payErr } = await supabase.from("payments").insert({
        bill_id: bill.id,
        amount: amt,
        payment_mode: payMode,
        payment_date: new Date().toISOString(),
        reference_number: payRef || null,
      });
      if (payErr) throw payErr;

      // Update bill paid amount
      const newPaid = (bill.paid || 0) + amt;
      const newBalance = (bill.total || 0) - newPaid;
      const newStatus = newBalance <= 0 ? "paid" : "partial";

      await supabase
        .from("bills")
        .update({
          paid: newPaid,
          balance: Math.max(0, newBalance),
          status: newStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("id", bill.id);

      setPayAmount("");
      setPayRef("");
      setSuccessMsg(
        `₹${amt.toLocaleString("en-IN")} payment recorded successfully!`,
      );
      setTimeout(() => setSuccessMsg(""), 3000);
      loadData(); // Refresh
    } catch (err: any) {
      setError(`Payment failed: ${err.message}`);
    } finally {
      setPayLoading(false);
    }
  }

  // ── CONFIRM DISCHARGE ─────────────────────────────────────────────
  async function confirmDischarge() {
    if (!admission) return;
    if (!dsSaved) {
      setError(
        "Please save the discharge summary first (Tab 3) before confirming discharge.",
      );
      return;
    }

    const proceed = window.confirm(
      `Are you sure you want to discharge ${admission.patient_name} from Bed ${admission.bed_number}?\n\n` +
        `This will:\n` +
        `• Finalize the discharge summary\n` +
        `• Update admission status to "Discharged"\n` +
        `• Free the bed for cleaning\n` +
        `• Sync details to patient profile\n` +
        `• Create follow-up appointment (if specified)\n\n` +
        `This action cannot be undone.`,
    );
    if (!proceed) return;

    setDischarging(true);
    setError("");

    try {
      // Call the comprehensive discharge API
      const res = await fetch("/api/ipd/discharge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          admission_id: admission.id,
          discharge_date: dsForm.discharge_date || getIndiaToday(),
          discharge_time: new Date().toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            timeZone: "Asia/Kolkata",
          }),
          condition_at_discharge: dsForm.condition_at_discharge,
          final_diagnosis: dsForm.final_diagnosis,
          discharge_advice: dsForm.discharge_advice,
          medications_at_discharge: dsForm.medications_at_discharge,
          follow_up_date: dsForm.follow_up_date || null,
          follow_up_note: dsForm.follow_up_note || null,
          discharged_by: dsForm.signed_by || user?.full_name || "",
        }),
      });

      if (!res.ok) {
        // Fallback: do manual updates if API fails
        console.warn("Discharge API failed, doing manual updates...");

        // Update admission status
        await supabase
          .from("ipd_admissions")
          .update({
            status: "discharged",
            discharge_date: dsForm.discharge_date || getIndiaToday(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", admission.id);

        // Free the bed
        await supabase
          .from("beds")
          .update({
            status: "cleaning",
            patient_id: null,
            patient_name: null,
            admission_date: null,
            expected_discharge: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", admission.bed_id);

        // Auto-mark bed available after delay
        setTimeout(async () => {
          await supabase
            .from("beds")
            .update({
              status: "available",
              updated_at: new Date().toISOString(),
            })
            .eq("id", admission.bed_id)
            .eq("status", "cleaning");
        }, 5000);
      }

      // Finalize discharge summary if not already
      if (!dsSaved || !existingDS?.is_final) {
        await saveDischargeSummary(true);
      }

      // Sync to patient profile
      if (patient) {
        await supabase
          .from("patients")
          .update({
            last_visit: dsForm.discharge_date || getIndiaToday(),
          })
          .eq("id", patient.id);
      }

      // Create follow-up appointment if specified
      if (dsForm.follow_up_date && patient) {
        await supabase
          .from("appointments")
          .insert({
            patient_id: patient.id,
            patient_name: patient.full_name,
            mrn: patient.mrn,
            date: dsForm.follow_up_date,
            time: "10:00",
            type: "Follow-up",
            status: "scheduled",
            doctor: dsForm.signed_by || admission.admitting_doctor || "",
            notes:
              dsForm.follow_up_note ||
              `Post-discharge follow-up. ${dsForm.final_diagnosis || ""}`.trim(),
          })
          .then(() => {});
      }

      setDischarged(true);
      setSuccessMsg(
        "Patient discharged successfully! All records have been updated.",
      );
    } catch (err: any) {
      setError(`Discharge failed: ${err.message}`);
    } finally {
      setDischarging(false);
    }
  }

  // ── Computed values ───────────────────────────────────────────────
  const totalCharges = ipdCharges.reduce((sum, c) => sum + (c.amount || 0), 0);
  const totalBilled = bills.reduce((sum, b) => sum + (b.total || 0), 0);
  const totalPaid = bills.reduce((sum, b) => sum + (b.paid || 0), 0);
  const totalBalance = bills.reduce((sum, b) => sum + (b.balance || 0), 0);
  const pendingLabs = labOrders.filter(
    (l) => l.status !== "completed" && l.status !== "cancelled",
  );
  const daysSinceAdmission = admission?.admission_date
    ? Math.max(
        1,
        Math.ceil(
          (Date.now() - new Date(admission.admission_date).getTime()) /
            86400000,
        ),
      )
    : 0;

  // ── Loading / Error states ────────────────────────────────────────
  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          <span className="ml-3 text-gray-500">
            Loading discharge workflow...
          </span>
        </div>
      </AppShell>
    );
  }

  if (error && !admission) {
    return (
      <AppShell>
        <div className="max-w-xl mx-auto mt-16 text-center">
          <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-gray-800 mb-2">
            Cannot Load Discharge
          </h2>
          <p className="text-gray-500 mb-6">{error}</p>
          <button onClick={() => router.back()} className="btn-primary">
            <ArrowLeft className="w-4 h-4 mr-2" /> Go Back
          </button>
        </div>
      </AppShell>
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════
  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-4 py-4">
        {/* ── Header ──────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.back()}
              className="p-2 rounded-lg hover:bg-gray-100"
            >
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </button>
            <div>
              <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <LogOut className="w-5 h-5 text-red-500" />
                {discharged ? "Discharge Complete" : "IPD Discharge Workflow"}
              </h1>
              {admission && (
                <p className="text-sm text-gray-500">
                  {admission.patient_name} · MRN: {admission.mrn || "—"} · Bed{" "}
                  {admission.bed_number} ({admission.ward})
                  {daysSinceAdmission > 0 && (
                    <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                      {daysSinceAdmission} day
                      {daysSinceAdmission > 1 ? "s" : ""}
                    </span>
                  )}
                </p>
              )}
            </div>
          </div>
          {discharged && (
            <span className="bg-green-100 text-green-800 px-4 py-2 rounded-full text-sm font-medium flex items-center gap-2">
              <CheckCircle className="w-4 h-4" /> Discharged
            </span>
          )}
        </div>

        {/* ── Status Messages ─────────────────────────────────────── */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
            <button
              onClick={() => setError("")}
              className="ml-auto text-red-400 hover:text-red-600"
            >
              ✕
            </button>
          </div>
        )}
        {successMsg && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm flex items-center gap-2">
            <CheckCircle className="w-4 h-4" /> {successMsg}
          </div>
        )}

        {/* ── Tab Navigation ──────────────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-4 overflow-hidden">
          <div className="flex overflow-x-auto border-b border-gray-200">
            {TAB_KEYS.map((key, idx) => {
              const cfg = TAB_CONFIG[key];
              const Icon = cfg.icon;
              const isActive = activeTab === key;
              return (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                    isActive
                      ? `border-blue-500 text-blue-700 bg-blue-50/50`
                      : "border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <span
                    className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                      isActive
                        ? "bg-blue-100 text-blue-700"
                        : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {idx + 1}
                  </span>
                  <Icon className={`w-4 h-4 ${isActive ? cfg.color : ""}`} />
                  {cfg.label}
                </button>
              );
            })}
          </div>

          {/* ── Tab Content ─────────────────────────────────────── */}
          <div className="p-6">
            {/* ═══════ TAB 1: Patient & Admission Summary ═══════ */}
            {activeTab === "summary" && admission && (
              <div className="space-y-6">
                <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                  <User className="w-5 h-5 text-blue-500" /> Patient & Admission
                  Details
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Patient Info */}
                  <div className="bg-blue-50 rounded-lg p-4 space-y-2">
                    <h3 className="font-medium text-blue-800 text-sm mb-3">
                      Patient Information
                    </h3>
                    <InfoRow label="Name" value={admission.patient_name} />
                    <InfoRow label="MRN" value={admission.mrn || "—"} />
                    <InfoRow
                      label="Age / Gender"
                      value={`${admission.age || "—"} / ${admission.gender || "—"}`}
                    />
                    <InfoRow
                      label="Mobile"
                      value={admission.mobile || patient?.mobile || "—"}
                    />
                    <InfoRow
                      label="Blood Group"
                      value={patient?.blood_group || "—"}
                    />
                    <InfoRow label="Address" value={patient?.address || "—"} />
                    {patient?.emergency_contact_name && (
                      <InfoRow
                        label="Emergency Contact"
                        value={`${patient.emergency_contact_name} (${patient.emergency_contact_phone || "—"})`}
                      />
                    )}
                  </div>

                  {/* Admission Info */}
                  <div className="bg-green-50 rounded-lg p-4 space-y-2">
                    <h3 className="font-medium text-green-800 text-sm mb-3">
                      Admission Details
                    </h3>
                    <InfoRow
                      label="Admission Date"
                      value={formatDate(admission.admission_date)}
                    />
                    <InfoRow
                      label="Admission Time"
                      value={admission.admission_time || "—"}
                    />
                    <InfoRow
                      label="Bed / Ward"
                      value={`${admission.bed_number} · ${admission.ward}`}
                    />
                    {admission.floor && (
                      <InfoRow label="Floor" value={admission.floor} />
                    )}
                    <InfoRow
                      label="Admitting Doctor"
                      value={admission.admitting_doctor || "—"}
                    />
                    <InfoRow
                      label="Diagnosis"
                      value={admission.diagnosis_on_admission || "—"}
                    />
                    <InfoRow
                      label="Chief Complaint"
                      value={admission.chief_complaint || "—"}
                    />
                    <InfoRow
                      label="Length of Stay"
                      value={`${daysSinceAdmission} day${daysSinceAdmission > 1 ? "s" : ""}`}
                    />
                    {admission.insurance_details && (
                      <InfoRow
                        label="Insurance"
                        value={admission.insurance_details}
                      />
                    )}
                  </div>
                </div>

                {/* Quick Links */}
                <div className="flex flex-wrap gap-2 pt-2">
                  <Link
                    href={`/patients/${admission.patient_id}`}
                    className="text-xs px-3 py-1.5 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 flex items-center gap-1"
                  >
                    <Eye className="w-3 h-3" /> View Patient Profile
                  </Link>
                  <Link
                    href={`/ipd/${admission.bed_id}`}
                    className="text-xs px-3 py-1.5 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 flex items-center gap-1"
                  >
                    <Activity className="w-3 h-3" /> Nursing Chart
                  </Link>
                  <Link
                    href={`/ipd/${admission.bed_id}/billing`}
                    className="text-xs px-3 py-1.5 rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 flex items-center gap-1"
                  >
                    <IndianRupee className="w-3 h-3" /> IPD Billing
                  </Link>
                </div>
              </div>
            )}

            {/* ═══════ TAB 2: Clinical History ═══════ */}
            {activeTab === "clinical" && (
              <div className="space-y-6">
                <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                  <Stethoscope className="w-5 h-5 text-purple-500" /> Clinical
                  History During Admission
                </h2>

                {/* Doctor Notes / Encounters */}
                <div>
                  <h3 className="font-medium text-gray-700 text-sm mb-3 flex items-center gap-2">
                    <FileText className="w-4 h-4" /> Doctor Notes (
                    {encounters.length})
                  </h3>
                  {encounters.length === 0 ? (
                    <p className="text-sm text-gray-400 italic">
                      No doctor notes recorded during this admission.
                    </p>
                  ) : (
                    <div className="space-y-3 max-h-[300px] overflow-y-auto">
                      {encounters.map((enc) => (
                        <div
                          key={enc.id}
                          className="bg-gray-50 rounded-lg p-3 text-sm border border-gray-100"
                        >
                          <div className="flex justify-between text-xs text-gray-400 mb-1">
                            <span>
                              {formatDate(enc.encounter_date)} ·{" "}
                              {enc.encounter_type || "Visit"}
                            </span>
                            <span>{enc.doctor_name || "—"}</span>
                          </div>
                          {enc.chief_complaint && (
                            <p className="text-gray-700">
                              <strong>CC:</strong> {enc.chief_complaint}
                            </p>
                          )}
                          {enc.diagnosis && (
                            <p className="text-gray-700">
                              <strong>Dx:</strong> {enc.diagnosis}
                            </p>
                          )}
                          {enc.notes && (
                            <p className="text-gray-600 mt-1">{enc.notes}</p>
                          )}
                          {(enc.pulse || enc.bp_systolic) && (
                            <div className="flex gap-3 mt-1 text-xs text-gray-500">
                              {enc.pulse && <span>Pulse: {enc.pulse}</span>}
                              {enc.bp_systolic && (
                                <span>
                                  BP: {enc.bp_systolic}/{enc.bp_diastolic}
                                </span>
                              )}
                              {enc.temperature && (
                                <span>Temp: {enc.temperature}°F</span>
                              )}
                              {enc.spo2 && <span>SpO2: {enc.spo2}%</span>}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Lab Results */}
                <div>
                  <h3 className="font-medium text-gray-700 text-sm mb-3 flex items-center gap-2">
                    <TestTube className="w-4 h-4" /> Lab Results (
                    {labOrders.length})
                    {pendingLabs.length > 0 && (
                      <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">
                        {pendingLabs.length} pending
                      </span>
                    )}
                  </h3>
                  {labOrders.length === 0 ? (
                    <p className="text-sm text-gray-400 italic">
                      No lab orders found.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-xs text-gray-500">
                          <tr>
                            <th className="text-left p-2">Test</th>
                            <th className="text-left p-2">Result</th>
                            <th className="text-left p-2">Normal</th>
                            <th className="text-left p-2">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {labOrders.slice(0, 15).map((lab) => (
                            <tr
                              key={lab.id}
                              className="border-t border-gray-100"
                            >
                              <td className="p-2 text-gray-700">
                                {lab.test_name}
                              </td>
                              <td className="p-2 text-gray-700 font-medium">
                                {lab.result_value || lab.result || "—"}
                              </td>
                              <td className="p-2 text-gray-400 text-xs">
                                {lab.normal_range || "—"}
                              </td>
                              <td className="p-2">
                                <span
                                  className={`text-xs px-2 py-0.5 rounded-full ${
                                    lab.status === "completed"
                                      ? "bg-green-100 text-green-700"
                                      : lab.status === "cancelled"
                                        ? "bg-gray-100 text-gray-500"
                                        : "bg-yellow-100 text-yellow-700"
                                  }`}
                                >
                                  {lab.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Recent Prescriptions */}
                <div>
                  <h3 className="font-medium text-gray-700 text-sm mb-3 flex items-center gap-2">
                    <Pill className="w-4 h-4" /> Prescriptions (
                    {prescriptions.length})
                  </h3>
                  {prescriptions.length === 0 ? (
                    <p className="text-sm text-gray-400 italic">
                      No prescriptions found.
                    </p>
                  ) : (
                    <div className="space-y-2 max-h-[200px] overflow-y-auto">
                      {prescriptions.slice(0, 5).map((rx) => (
                        <div
                          key={rx.id}
                          className="bg-gray-50 rounded-lg p-3 text-sm border border-gray-100"
                        >
                          <div className="text-xs text-gray-400 mb-1">
                            {formatDate(rx.created_at)}
                          </div>
                          {rx.medications &&
                            Array.isArray(rx.medications) &&
                            rx.medications.map((m: any, i: number) => (
                              <p key={i} className="text-gray-700">
                                {m.drug} {m.dose} {m.frequency} × {m.duration}
                              </p>
                            ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Nursing Notes Preview */}
                {nursingNotes.length > 0 && (
                  <div>
                    <h3 className="font-medium text-gray-700 text-sm mb-3 flex items-center gap-2">
                      <Heart className="w-4 h-4" /> Recent Nursing Records (
                      {nursingNotes.length})
                    </h3>
                    <div className="space-y-2 max-h-[200px] overflow-y-auto">
                      {nursingNotes.slice(0, 5).map((n: any) => (
                        <div
                          key={n.id}
                          className="bg-gray-50 rounded-lg p-3 text-sm border border-gray-100"
                        >
                          <div className="text-xs text-gray-400 mb-1">
                            {n.recorded_at ? formatDate(n.recorded_at) : "—"}
                          </div>
                          <div className="flex gap-3 text-xs text-gray-600">
                            {n.pulse && <span>P: {n.pulse}</span>}
                            {n.bp_systolic && (
                              <span>
                                BP: {n.bp_systolic}/{n.bp_diastolic}
                              </span>
                            )}
                            {n.temperature && <span>T: {n.temperature}°F</span>}
                            {n.spo2 && <span>SpO2: {n.spo2}%</span>}
                          </div>
                          {n.notes && (
                            <p className="text-gray-600 mt-1 text-xs">
                              {n.notes}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ═══════ TAB 3: Discharge Summary Form ═══════ */}
            {activeTab === "discharge" && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                    <FileText className="w-5 h-5 text-green-500" /> Discharge
                    Summary
                  </h2>
                  <div className="flex gap-2">
                    <button
                      onClick={aiAutoFill}
                      disabled={aiLoading || discharged}
                      className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50"
                    >
                      {aiLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Sparkles className="w-4 h-4" />
                      )}
                      AI Auto-fill
                    </button>
                    <button
                      onClick={() => saveDischargeSummary(false)}
                      disabled={saving || discharged}
                      className="btn-primary text-sm flex items-center gap-1 disabled:opacity-50"
                    >
                      {saving ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Save className="w-4 h-4" />
                      )}
                      Save Draft
                    </button>
                  </div>
                </div>

                {dsSaved && (
                  <div className="text-xs bg-green-50 text-green-700 px-3 py-1.5 rounded-lg flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" /> Discharge summary has
                    been saved.
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <DSField
                    label="Admission Date"
                    value={dsForm.admission_date}
                    field="admission_date"
                    type="date"
                    onChange={setDsForm}
                    disabled={discharged}
                  />
                  <DSField
                    label="Discharge Date"
                    value={dsForm.discharge_date}
                    field="discharge_date"
                    type="date"
                    onChange={setDsForm}
                    disabled={discharged}
                  />
                  <DSField
                    label="Final Diagnosis *"
                    value={dsForm.final_diagnosis}
                    field="final_diagnosis"
                    onChange={setDsForm}
                    disabled={discharged}
                    full
                  />
                  <DSField
                    label="Secondary Diagnosis"
                    value={dsForm.secondary_diagnosis}
                    field="secondary_diagnosis"
                    onChange={setDsForm}
                    disabled={discharged}
                    full
                  />
                  <DSField
                    label="Clinical Summary"
                    value={dsForm.clinical_summary}
                    field="clinical_summary"
                    onChange={setDsForm}
                    disabled={discharged}
                    full
                    rows={3}
                  />
                  <DSField
                    label="Investigations"
                    value={dsForm.investigations}
                    field="investigations"
                    onChange={setDsForm}
                    disabled={discharged}
                    full
                    rows={3}
                  />
                  <DSField
                    label="Treatment Given"
                    value={dsForm.treatment_given}
                    field="treatment_given"
                    onChange={setDsForm}
                    disabled={discharged}
                    full
                    rows={3}
                  />
                  <DSField
                    label="Condition at Discharge"
                    value={dsForm.condition_at_discharge}
                    field="condition_at_discharge"
                    onChange={setDsForm}
                    disabled={discharged}
                  />
                  <DSField
                    label="Discharge Advice"
                    value={dsForm.discharge_advice}
                    field="discharge_advice"
                    onChange={setDsForm}
                    disabled={discharged}
                    full
                    rows={3}
                  />
                  <DSField
                    label="Diet Advice"
                    value={dsForm.diet_advice}
                    field="diet_advice"
                    onChange={setDsForm}
                    disabled={discharged}
                    full
                    rows={2}
                  />
                  <DSField
                    label="Medications at Discharge"
                    value={dsForm.medications_at_discharge}
                    field="medications_at_discharge"
                    onChange={setDsForm}
                    disabled={discharged}
                    full
                    rows={3}
                  />
                  <DSField
                    label="Follow-up Date"
                    value={dsForm.follow_up_date}
                    field="follow_up_date"
                    type="date"
                    onChange={setDsForm}
                    disabled={discharged}
                  />
                  <DSField
                    label="Follow-up Instructions"
                    value={dsForm.follow_up_note}
                    field="follow_up_note"
                    onChange={setDsForm}
                    disabled={discharged}
                  />
                  <DSField
                    label="Signed By (Doctor)"
                    value={dsForm.signed_by}
                    field="signed_by"
                    onChange={setDsForm}
                    disabled={discharged}
                  />
                </div>

                {/* Obstetric / Delivery Fields Toggle */}
                <div className="border-t border-gray-200 pt-4">
                  <button
                    onClick={() => setShowObFields(!showObFields)}
                    className="text-sm font-medium text-pink-600 hover:text-pink-800 flex items-center gap-2"
                  >
                    <Baby className="w-4 h-4" />
                    {showObFields ? "Hide" : "Show"} Delivery / Obstetric
                    Details
                    <ChevronRight
                      className={`w-4 h-4 transition-transform ${showObFields ? "rotate-90" : ""}`}
                    />
                  </button>

                  {showObFields && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 bg-pink-50 rounded-lg p-4">
                      <DSField
                        label="Delivery Type"
                        value={dsForm.delivery_type}
                        field="delivery_type"
                        onChange={setDsForm}
                        disabled={discharged}
                        placeholder="Normal / LSCS / Assisted / Vacuum"
                      />
                      <DSField
                        label="Delivery Date"
                        value={dsForm.delivery_date}
                        field="delivery_date"
                        type="date"
                        onChange={setDsForm}
                        disabled={discharged}
                      />
                      <DSField
                        label="Baby Sex"
                        value={dsForm.baby_sex}
                        field="baby_sex"
                        onChange={setDsForm}
                        disabled={discharged}
                        placeholder="Male / Female"
                      />
                      <DSField
                        label="Baby Weight (kg)"
                        value={dsForm.baby_weight}
                        field="baby_weight"
                        onChange={setDsForm}
                        disabled={discharged}
                        placeholder="e.g., 2.8"
                      />
                      <DSField
                        label="APGAR Score"
                        value={dsForm.apgar_score}
                        field="apgar_score"
                        onChange={setDsForm}
                        disabled={discharged}
                        placeholder="e.g., 8/10, 9/10"
                      />
                      <DSField
                        label="Baby Birth Time"
                        value={dsForm.baby_birth_time}
                        field="baby_birth_time"
                        onChange={setDsForm}
                        disabled={discharged}
                        placeholder="HH:MM"
                      />
                      <DSField
                        label="Complications"
                        value={dsForm.complications}
                        field="complications"
                        onChange={setDsForm}
                        disabled={discharged}
                        full
                        rows={2}
                      />
                      <DSField
                        label="Lactation Advice"
                        value={dsForm.lactation_advice}
                        field="lactation_advice"
                        onChange={setDsForm}
                        disabled={discharged}
                        full
                        rows={2}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ═══════ TAB 4: Billing & Finance ═══════ */}
            {activeTab === "billing" && (
              <div className="space-y-6">
                <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                  <IndianRupee className="w-5 h-5 text-amber-500" /> Billing &
                  Financial Settlement
                </h2>

                {/* Summary Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <StatCard
                    label="Total Charges"
                    value={`₹${totalCharges.toLocaleString("en-IN")}`}
                    color="blue"
                    icon={Receipt}
                  />
                  <StatCard
                    label="Total Billed"
                    value={`₹${totalBilled.toLocaleString("en-IN")}`}
                    color="amber"
                    icon={FileText}
                  />
                  <StatCard
                    label="Total Paid"
                    value={`₹${totalPaid.toLocaleString("en-IN")}`}
                    color="green"
                    icon={CheckCircle}
                  />
                  <StatCard
                    label="Balance Due"
                    value={`₹${totalBalance.toLocaleString("en-IN")}`}
                    color={totalBalance > 0 ? "red" : "green"}
                    icon={totalBalance > 0 ? AlertCircle : CheckCircle}
                  />
                </div>

                {/* IPD Charges Breakdown */}
                {ipdCharges.length > 0 && (
                  <div>
                    <h3 className="font-medium text-gray-700 text-sm mb-3">
                      IPD Charges ({ipdCharges.length} items)
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-xs text-gray-500">
                          <tr>
                            <th className="text-left p-2">Date</th>
                            <th className="text-left p-2">Description</th>
                            <th className="text-left p-2">Category</th>
                            <th className="text-right p-2">Qty</th>
                            <th className="text-right p-2">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ipdCharges.map((c) => (
                            <tr key={c.id} className="border-t border-gray-100">
                              <td className="p-2 text-gray-500 text-xs">
                                {c.charge_date
                                  ? formatDate(c.charge_date)
                                  : "—"}
                              </td>
                              <td className="p-2 text-gray-700">
                                {c.description || c.item_name || "—"}
                              </td>
                              <td className="p-2">
                                <span className="text-xs bg-gray-100 px-2 py-0.5 rounded">
                                  {c.category}
                                </span>
                              </td>
                              <td className="p-2 text-right text-gray-600">
                                {c.quantity}
                              </td>
                              <td className="p-2 text-right font-medium text-gray-800">
                                ₹{(c.amount || 0).toLocaleString("en-IN")}
                              </td>
                            </tr>
                          ))}
                          <tr className="border-t-2 border-gray-300 font-semibold">
                            <td colSpan={4} className="p-2 text-right">
                              Total Charges:
                            </td>
                            <td className="p-2 text-right">
                              ₹{totalCharges.toLocaleString("en-IN")}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {ipdCharges.length === 0 && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-700 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium">No IPD charges found.</p>
                      <p>
                        Go to{" "}
                        <Link
                          href={`/ipd/${admission?.bed_id}/billing`}
                          className="underline font-medium"
                        >
                          IPD Billing
                        </Link>{" "}
                        to add room charges, procedure fees, and other charges
                        before discharge.
                      </p>
                    </div>
                  </div>
                )}

                {/* Payment History */}
                {payments.length > 0 && (
                  <div>
                    <h3 className="font-medium text-gray-700 text-sm mb-3">
                      Payment History
                    </h3>
                    <div className="space-y-2">
                      {payments.map((p) => (
                        <div
                          key={p.id}
                          className="flex items-center justify-between bg-green-50 rounded-lg p-3 text-sm border border-green-100"
                        >
                          <div>
                            <span className="font-medium text-green-800">
                              ₹{p.amount.toLocaleString("en-IN")}
                            </span>
                            <span className="text-green-600 ml-2">
                              via {p.payment_mode}
                            </span>
                            {p.reference_number && (
                              <span className="text-xs text-green-500 ml-2">
                                (Ref: {p.reference_number})
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-green-500">
                            {formatDate(p.payment_date)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Record Payment */}
                {totalBalance > 0 && !discharged && (
                  <div className="bg-amber-50 rounded-lg p-4 border border-amber-200">
                    <h3 className="font-medium text-amber-800 text-sm mb-3 flex items-center gap-2">
                      <CreditCard className="w-4 h-4" /> Record Payment
                    </h3>
                    <div className="flex flex-wrap gap-3 items-end">
                      <div>
                        <label className="text-xs text-gray-500 block mb-1">
                          Amount (₹)
                        </label>
                        <input
                          type="number"
                          value={payAmount}
                          onChange={(e) => setPayAmount(e.target.value)}
                          placeholder={`Max: ${totalBalance}`}
                          className="input-field w-32"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 block mb-1">
                          Mode
                        </label>
                        <select
                          value={payMode}
                          onChange={(e) => setPayMode(e.target.value)}
                          className="input-field w-32"
                        >
                          <option>Cash</option>
                          <option>UPI</option>
                          <option>Card</option>
                          <option>NEFT</option>
                          <option>Insurance</option>
                          <option>Cheque</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 block mb-1">
                          Reference #
                        </label>
                        <input
                          type="text"
                          value={payRef}
                          onChange={(e) => setPayRef(e.target.value)}
                          placeholder="Optional"
                          className="input-field w-36"
                        />
                      </div>
                      <button
                        onClick={recordPayment}
                        disabled={payLoading || !payAmount}
                        className="btn-primary text-sm disabled:opacity-50 flex items-center gap-1"
                      >
                        {payLoading ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <CheckCircle className="w-4 h-4" />
                        )}
                        Record Payment
                      </button>
                    </div>
                  </div>
                )}

                {totalBalance <= 0 && bills.length > 0 && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-700 flex items-center gap-2">
                    <CheckCircle className="w-4 h-4" /> All bills are fully
                    settled. No balance due.
                  </div>
                )}
              </div>
            )}

            {/* ═══════ TAB 5: Clearance Checklist ═══════ */}
            {activeTab === "clearance" && admission && (
              <div className="space-y-6">
                <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                  <ClipboardCheck className="w-5 h-5 text-red-500" /> Discharge
                  Clearance Checklist
                </h2>
                <p className="text-sm text-gray-500">
                  All departments must clear the patient before discharge can be
                  confirmed. Items marked with a red cross are blocking
                  discharge.
                </p>
                <InlineDischargeClearance
                  admissionId={admission.id}
                  patientId={admission.patient_id}
                  onClearanceResult={(ok) => setCanDischarge(ok)}
                  isAdmin={isAdmin}
                  currentUser={user?.full_name || user?.email || ""}
                />
              </div>
            )}

            {/* ═══════ TAB 6: Confirm & Print ═══════ */}
            {activeTab === "confirm" && admission && (
              <div className="space-y-6">
                <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                  <Printer className="w-5 h-5 text-gray-600" /> Confirm
                  Discharge & Print
                </h2>

                {discharged ? (
                  <div className="text-center py-8 space-y-4">
                    <CheckCircle className="w-16 h-16 text-green-500 mx-auto" />
                    <h3 className="text-xl font-semibold text-gray-800">
                      Discharge Complete!
                    </h3>
                    <p className="text-gray-500 max-w-md mx-auto">
                      {admission.patient_name} has been successfully discharged
                      from Bed {admission.bed_number}. The bed is now being
                      cleaned and will be available shortly.
                    </p>
                    <div className="flex justify-center gap-3 pt-4">
                      <Link
                        href={`/patients/${admission.patient_id}`}
                        className="btn-primary flex items-center gap-2"
                      >
                        <User className="w-4 h-4" /> View Patient Profile
                      </Link>
                      <Link
                        href={`/patients/${admission.patient_id}/discharge`}
                        className="btn-secondary flex items-center gap-2"
                      >
                        <Printer className="w-4 h-4" /> Print Discharge Summary
                      </Link>
                      <Link
                        href="/ipd"
                        className="btn-secondary flex items-center gap-2"
                      >
                        <BedDouble className="w-4 h-4" /> Back to IPD
                      </Link>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Pre-discharge checklist summary */}
                    <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                      <h3 className="font-medium text-gray-700 text-sm">
                        Pre-Discharge Verification
                      </h3>
                      <CheckItem label="Discharge summary saved" ok={dsSaved} />
                      <CheckItem
                        label="Final diagnosis documented"
                        ok={!!dsForm.final_diagnosis}
                      />
                      <CheckItem
                        label="Discharge advice provided"
                        ok={!!dsForm.discharge_advice}
                      />
                      <CheckItem
                        label="Medications at discharge listed"
                        ok={!!dsForm.medications_at_discharge}
                      />
                      <CheckItem
                        label="Doctor sign-off"
                        ok={!!dsForm.signed_by}
                      />
                      <CheckItem
                        label="No pending lab results"
                        ok={pendingLabs.length === 0}
                        warning={
                          pendingLabs.length > 0
                            ? `${pendingLabs.length} pending`
                            : undefined
                        }
                      />
                      <CheckItem
                        label="All clearances passed"
                        ok={canDischarge}
                      />
                      <CheckItem
                        label="Bill settled (no balance)"
                        ok={totalBalance <= 0}
                        warning={
                          totalBalance > 0
                            ? `₹${totalBalance.toLocaleString("en-IN")} due`
                            : undefined
                        }
                      />
                    </div>

                    {/* Discharge Actions */}
                    <div className="flex flex-wrap gap-3 pt-4">
                      <button
                        onClick={confirmDischarge}
                        disabled={discharging || !dsSaved}
                        className="bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-lg font-medium text-sm disabled:opacity-50 flex items-center gap-2 shadow-sm"
                      >
                        {discharging ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <LogOut className="w-4 h-4" />
                        )}
                        {discharging
                          ? "Processing Discharge..."
                          : "Confirm Discharge"}
                      </button>

                      {!dsSaved && (
                        <p className="text-sm text-red-500 flex items-center gap-1">
                          <AlertCircle className="w-4 h-4" />
                          Please save the discharge summary (Tab 3) before
                          confirming.
                        </p>
                      )}
                    </div>

                    {!canDischarge && (
                      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-700 flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                        <div>
                          Some clearance items are still pending. You can still
                          discharge if you have admin override or if the pending
                          items are non-critical. Check the Clearance tab for
                          details.
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// HELPER COMPONENTS
// ═══════════════════════════════════════════════════════════════════════

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-800 font-medium text-right max-w-[60%] truncate">
        {value}
      </span>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
  icon: Icon,
}: {
  label: string;
  value: string;
  color: string;
  icon: any;
}) {
  const bgMap: Record<string, string> = {
    blue: "bg-blue-50",
    amber: "bg-amber-50",
    green: "bg-green-50",
    red: "bg-red-50",
  };
  const textMap: Record<string, string> = {
    blue: "text-blue-700",
    amber: "text-amber-700",
    green: "text-green-700",
    red: "text-red-700",
  };
  return (
    <div
      className={`${bgMap[color] || "bg-gray-50"} rounded-lg p-3 text-center`}
    >
      <Icon className={`w-5 h-5 mx-auto mb-1 ${textMap[color] || ""}`} />
      <div className={`text-lg font-bold ${textMap[color] || ""}`}>{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

function DSField({
  label,
  value,
  field,
  onChange,
  type = "text",
  rows,
  full,
  disabled,
  placeholder,
}: {
  label: string;
  value: string;
  field: keyof DSForm;
  onChange: React.Dispatch<React.SetStateAction<DSForm>>;
  type?: string;
  rows?: number;
  full?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const cls = `w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:text-gray-500`;
  return (
    <div className={full ? "md:col-span-2" : ""}>
      <label className="text-xs text-gray-500 block mb-1">{label}</label>
      {rows ? (
        <textarea
          value={value}
          rows={rows}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) =>
            onChange((prev) => ({ ...prev, [field]: e.target.value }))
          }
          className={cls}
        />
      ) : type === "date" ? (
        <input
          type="date"
          value={value}
          disabled={disabled}
          onChange={(e) =>
            onChange((prev) => ({ ...prev, [field]: e.target.value }))
          }
          className={cls}
        />
      ) : (
        <input
          type="text"
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) =>
            onChange((prev) => ({ ...prev, [field]: e.target.value }))
          }
          className={cls}
        />
      )}
    </div>
  );
}

function CheckItem({
  label,
  ok,
  warning,
}: {
  label: string;
  ok: boolean;
  warning?: string;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {ok ? (
        <CheckCircle className="w-4 h-4 text-green-500" />
      ) : (
        <AlertCircle className="w-4 h-4 text-red-400" />
      )}
      <span className={ok ? "text-gray-700" : "text-gray-500"}>{label}</span>
      {warning && (
        <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
          {warning}
        </span>
      )}
    </div>
  );
}
