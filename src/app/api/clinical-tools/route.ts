/**
 * src/app/api/clinical-tools/route.ts
 *
 * Unified API for Phase 3 clinical tools.
 *
 * POST /api/clinical-tools  body: { tool, action, ... }
 *   tool: 'menstrual' | 'score' | 'infertility' | 'education'
 *   action: 'create' | 'update' | 'list' | 'analyze'
 *
 * NON-BREAKING: New endpoint.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  logPeriod,
  updatePeriod,
  getPatientCycles,
  analyzeCycles,
} from "@/lib/menstrual-tracking";
import {
  saveScore,
  getPatientScores,
  calculateMRS,
  calculateBishopScore,
  calculateFGScore,
} from "@/lib/clinical-scores";
import {
  createWorkup,
  updateWorkupStep,
  getPatientWorkups,
} from "@/lib/infertility-wizard";
import { logEducationGiven } from "@/lib/patient-education";

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function POST(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const body = await req.json();
    const { tool, action, ...data } = body;

    // ── Menstrual Tracking ──────────────────────────────────────────────
    if (tool === "menstrual") {
      if (action === "log") {
        const result = await logPeriod(supabase, data);
        if (result.error)
          return NextResponse.json({ error: result.error }, { status: 500 });
        return NextResponse.json({ cycle: result.data }, { status: 201 });
      }
      if (action === "update") {
        const { id, ...updates } = data;
        const result = await updatePeriod(supabase, id, updates);
        if (result.error)
          return NextResponse.json({ error: result.error }, { status: 500 });
        return NextResponse.json({ cycle: result.data });
      }
      if (action === "list") {
        const result = await getPatientCycles(
          supabase,
          data.patient_id,
          data.limit,
        );
        if (result.error)
          return NextResponse.json({ error: result.error }, { status: 500 });
        return NextResponse.json({ cycles: result.data });
      }
      if (action === "analyze") {
        const result = await getPatientCycles(supabase, data.patient_id, 24);
        if (result.error)
          return NextResponse.json({ error: result.error }, { status: 500 });
        const analysis = analyzeCycles(result.data);
        return NextResponse.json({ cycles: result.data, analysis });
      }
    }

    // ── Clinical Scores ─────────────────────────────────────────────────
    if (tool === "score") {
      if (action === "calculate") {
        let result;
        switch (data.score_type) {
          case "mrs":
            result = calculateMRS(data.scores);
            break;
          case "bishop":
            result = calculateBishopScore(data.scores);
            break;
          case "ferriman_gallwey":
            result = calculateFGScore(data.scores);
            break;
          default:
            return NextResponse.json(
              { error: `Unknown score: ${data.score_type}` },
              { status: 400 },
            );
        }
        // Save to DB if patient_id provided
        if (data.patient_id) {
          await saveScore(
            supabase,
            data.patient_id,
            result,
            data.encounter_id,
            data.scored_by,
          );
        }
        return NextResponse.json({ result });
      }
      if (action === "history") {
        const result = await getPatientScores(
          supabase,
          data.patient_id,
          data.score_type,
        );
        if (result.error)
          return NextResponse.json({ error: result.error }, { status: 500 });
        return NextResponse.json({ scores: result.data });
      }
    }

    // ── Infertility Workup ──────────────────────────────────────────────
    if (tool === "infertility") {
      if (action === "create") {
        const result = await createWorkup(supabase, data);
        if (result.error)
          return NextResponse.json({ error: result.error }, { status: 500 });
        return NextResponse.json({ workup: result.data }, { status: 201 });
      }
      if (action === "update_step") {
        const result = await updateWorkupStep(
          supabase,
          data.workup_id,
          data.step_key,
          data.step_data,
        );
        if (result.error)
          return NextResponse.json({ error: result.error }, { status: 500 });
        return NextResponse.json({ success: true });
      }
      if (action === "list") {
        const result = await getPatientWorkups(supabase, data.patient_id);
        if (result.error)
          return NextResponse.json({ error: result.error }, { status: 500 });
        return NextResponse.json({ workups: result.data });
      }
    }

    // ── Patient Education ───────────────────────────────────────────────
    if (tool === "education") {
      if (action === "log") {
        const result = await logEducationGiven(supabase, data);
        if (result.error)
          return NextResponse.json({ error: result.error }, { status: 500 });
        return NextResponse.json({ success: true }, { status: 201 });
      }
    }

    return NextResponse.json(
      { error: "Invalid tool or action" },
      { status: 400 },
    );
  } catch (err) {
    console.error("[API /clinical-tools]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
