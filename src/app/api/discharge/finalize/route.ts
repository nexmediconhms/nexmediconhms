// src/app/api/discharge/finalize/route.ts
// Discharge Summary — Finalize (lock for editing)
// PATCH /api/discharge/finalize
// Body: { dischargeId: string, signedBy: string }
//
// Auth:  doctor or admin (requireRole)
// Guard: uses a conditional update (.eq("is_final", false)) as an
//        optimistic lock — two simultaneous clicks return 409 Conflict,
//        never double-finalize.
// Audit: writes to auditlog via the existing audit() helper.
//
// Works with EXISTING dischargesummaries schema:
//   isfinal BOOLEAN DEFAULT FALSE
//   signedby TEXT
//   signedat TIMESTAMPTZ
//   version  INTEGER
//   updatedat TIMESTAMPTZ

import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase";
import { requireRole } from "@/lib/api-auth";
import { audit } from "@/lib/audit";

export async function PATCH(req: NextRequest) {
  // Only doctor or admin can finalise a discharge summary
  const auth = await requireRole(req, ["doctor", "admin"]);
  if (auth instanceof Response) return auth;

  let body: { dischargeId?: string; signedBy?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { dischargeId, signedBy } = body;

  if (!dischargeId) {
    return NextResponse.json(
      { error: "dischargeId is required" },
      { status: 400 }
    );
  }

  const admin = getAdminClient();

  // 1. Fetch the current record — confirm it exists and is not already final
  const { data: existing, error: fetchErr } = await admin
    .from("dischargesummaries")
    .select("id, isfinal, patientid, version, signedby")
    .eq("id", dischargeId)
    .single();

  if (fetchErr || !existing) {
    return NextResponse.json(
      { error: "Discharge summary not found" },
      { status: 404 }
    );
  }

  if (existing.isfinal) {
    return NextResponse.json(
      { error: "Discharge summary is already finalised." },
      { status: 409 }
    );
  }

  // 2. Conditional update — only proceed if still not final (optimistic lock)
  const { data: updated, error: updateErr } = await admin
    .from("dischargesummaries")
    .update({
      isfinal:   true,
      signedby:  signedBy ?? auth.fullName ?? auth.email,
      signedat:  new Date().toISOString(),
      updatedat: new Date().toISOString(),
      // Bump version to indicate finalised state in audit trail
      version:   (existing.version ?? 1) + 10,
    })
    .eq("id", dischargeId)
    .eq("isfinal", false)          // optimistic lock
    .select()
    .single();

  if (updateErr) {
    // Unique-constraint or concurrency error
    if (updateErr.code === "PGRST116") {
      // No rows matched — means it was already finalised by a concurrent request
      return NextResponse.json(
        { error: "Discharge summary was already finalised (concurrent request)." },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: updateErr.message },
      { status: 500 }
    );
  }

  if (!updated) {
    return NextResponse.json(
      { error: "Finalisation failed — record may have been concurrently updated." },
      { status: 409 }
    );
  }

  // 3. Write to audit log using the existing audit() helper signature:
  //    audit(action, table, recordId?, details?)
  await audit(
    "finalize_discharge",
    "dischargesummaries",
    dischargeId,
    {
      patientId: existing.patientid,
      signedBy:  signedBy ?? auth.fullName ?? auth.email,
      signedAt:  updated.signedat,
    }
  ).catch(() => {
    // Audit failure must NOT break the finalization response
  });

  return NextResponse.json({
    success:  true,
    id:       updated.id,
    isfinal:  updated.isfinal,
    signedby: updated.signedby,
    signedat: updated.signedat,
  });
}
