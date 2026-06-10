/**
 * src/app/api/consents/route.ts
 *
 * GET  /api/consents?encounter_id=...  — consents for encounter
 * GET  /api/consents?patient_id=...    — patient consent history
 * POST /api/consents                   — create new consent
 * PUT  /api/consents                   — sign / update / revoke consent
 *
 * NON-BREAKING: New endpoint. Does not affect existing IPD consent flow.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  createConsent,
  signConsent,
  revokeConsent,
  getEncounterConsents,
  getPatientConsents,
} from '@/lib/consent-helpers';

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

    if (encounterId) {
      const result = await getEncounterConsents(supabase, encounterId);
      if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });
      return NextResponse.json({ consents: result.data });
    }

    if (patientId) {
      const limit = parseInt(searchParams.get('limit') || '50', 10);
      const result = await getPatientConsents(supabase, patientId, limit);
      if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });
      return NextResponse.json({ consents: result.data });
    }

    return NextResponse.json({ error: 'Provide encounter_id or patient_id' }, { status: 400 });
  } catch (err) {
    console.error('[API /consents GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const body = await req.json();

    if (!body.patient_id || !body.consent_type || !body.consent_title) {
      return NextResponse.json(
        { error: 'patient_id, consent_type, and consent_title are required' },
        { status: 400 }
      );
    }

    const result = await createConsent(supabase, body);
    if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });

    return NextResponse.json({ consent: result.data }, { status: 201 });
  } catch (err) {
    console.error('[API /consents POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const body = await req.json();
    const { id, action } = body;

    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    // Sign consent
    if (action === 'sign') {
      const result = await signConsent(supabase, id, {
        patient_signature: body.patient_signature,
        guardian_name: body.guardian_name,
        guardian_relation: body.guardian_relation,
        guardian_signature: body.guardian_signature,
        witness_name: body.witness_name,
        witness_signature: body.witness_signature,
      });
      if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });
      return NextResponse.json({ consent: result.data });
    }

    // Revoke consent
    if (action === 'revoke') {
      if (!body.reason) {
        return NextResponse.json({ error: 'Revocation reason is required' }, { status: 400 });
      }
      const result = await revokeConsent(supabase, id, body.reason);
      if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });
      return NextResponse.json({ consent: result.data });
    }

    // Generic update
    const { data, error } = await supabase
      .from('consents')
      .update(body)
      .eq('id', id)
      .select('*')
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ consent: data });
  } catch (err) {
    console.error('[API /consents PUT]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
