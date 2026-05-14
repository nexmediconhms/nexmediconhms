// src/app/api/discharge/unfinalize/route.ts
// Discharge Summary — Unfinalize (admin only, requires reason)
// PATCH /api/discharge/unfinalize
// Body: { dischargeId: string, reason: string }
//
// Auth:  admin ONLY
// Audit: mandatory — reason is stored in audit log for tamper-evident record.

import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase";
import { requireRole } from "@/lib/api-auth";
import { audit } from "@/lib/audit";

export async function PATCH(req: NextRequest) {
  const auth = await requireRole(req, "admin");
  if (auth instanceof Response) return auth;

  let body: { dischargeId?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { dischargeId, reason } = body;

  if (!dischargeId) {
    return NextResponse.json(
      { error: "dischargeId is required" },
      { status: 400 }
    );
  }
  if (!reason || reason.trim().length < 5) {
    return NextResponse.json(
      { error: "A reason (min 5 characters) is required to unfinalize a discharge summary." },
      { status: 400 }
    );
  }

  const admin = getAdminClient();

  // Confirm the record exists and is currently finalised
  const { data: existing, error: fetchErr } = await admin
    .from("dischargesummaries")
    .select("id, isfinal, patientid, signedby, signedat, version")
    .eq("id", dischargeId)
    .single();

  if (fetchErr || !existing) {
    return NextResponse.json(
      { error: "Discharge summary not found" },
      { status: 404 }
    );
  }

  if (!existing.isfinal) {
    return NextResponse.json(
      { error: "Discharge summary is not finalised — nothing to undo." },
      { status: 409 }
    );
  }

  const { data: updated, error: updateErr } = await admin
    .from("dischargesummaries")
    .update({
      isfinal:   false,
      signedat:  null,
      updatedat: new Date().toISOString(),
    })
    .eq("id", dischargeId)
    .select()
    .single();

  if (updateErr || !updated) {
    return NextResponse.json(
      { error: updateErr?.message ?? "Unfinalize failed" },
      { status: 500 }
    );
  }

  // Audit — include original signedby + the unlock reason
  await audit(
    "unfinalize_discharge",
    "dischargesummaries",
    dischargeId,
    {
      patientId:          existing.patientid,
      previouslySignedBy: existing.signedby,
      previouslySignedAt: existing.signedat,
      unfinalizedBy:      auth.email,
      reason:             reason.trim(),
    }
  ).catch(() => {});

  return NextResponse.json({
    success:     true,
    id:          updated.id,
    isfinal:     updated.isfinal,
    unfinalized: true,
  });
}
