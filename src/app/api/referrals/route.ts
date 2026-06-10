/**
 * src/app/api/referrals/route.ts
 *
 * GET  /api/referrals?encounter_id=...  — referrals for encounter
 * GET  /api/referrals?patient_id=...    — patient referral history
 * GET  /api/referrals?pending=true      — all pending referrals
 * POST /api/referrals                   — create referral + generate letter
 * PUT  /api/referrals                   — update status / add report
 *
 * NON-BREAKING: New endpoint.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  createReferral,
  updateReferral,
  getEncounterReferrals,
  getPatientReferrals,
  getPendingReferrals,
  generateReferralLetter,
} from '@/lib/referral-helpers';

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(req.url);

    const encounterId = searchParams.get('encounter_id');
    const patientId = searchParams.get('patient_id');
    const pending = searchParams.get('pending');
    const doctorId = searchParams.get('doctor_id');

    if (pending === 'true') {
      const result = await getPendingReferrals(supabase, doctorId || undefined);
      if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });
      return NextResponse.json({ referrals: result.data });
    }

    if (encounterId) {
      const result = await getEncounterReferrals(supabase, encounterId);
      if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });
      return NextResponse.json({ referrals: result.data });
    }

    if (patientId) {
      const status = searchParams.get('status') || undefined;
      const limit = parseInt(searchParams.get('limit') || '50', 10);
      const result = await getPatientReferrals(supabase, patientId, { status, limit });
      if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });
      return NextResponse.json({ referrals: result.data });
    }

    return NextResponse.json({ error: 'Provide encounter_id, patient_id, or pending=true' }, { status: 400 });
  } catch (err) {
    console.error('[API /referrals GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const body = await req.json();

    if (!body.patient_id || !body.referred_to_name || !body.reason) {
      return NextResponse.json(
        { error: 'patient_id, referred_to_name, and reason are required' },
        { status: 400 }
      );
    }

    // Generate referral letter if clinic context provided
    let letterHtml: string | undefined;
    if (body.clinic_context) {
      letterHtml = generateReferralLetter(body, body.clinic_context);
      body.letter_content = letterHtml;
      delete body.clinic_context; // don't store in DB
    }

    const result = await createReferral(supabase, body);
    if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });

    return NextResponse.json({
      referral: result.data,
      letter_html: letterHtml || null,
    }, { status: 201 });
  } catch (err) {
    console.error('[API /referrals POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const body = await req.json();
    const { id, ...updates } = body;

    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const result = await updateReferral(supabase, id, updates);
    if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });

    return NextResponse.json({ referral: result.data });
  } catch (err) {
    console.error('[API /referrals PUT]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
