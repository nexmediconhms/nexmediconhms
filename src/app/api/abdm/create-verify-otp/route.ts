// src/app/api/abdm/create-verify-otp/route.ts
// ABDM ABHA Creation — Verify Aadhaar OTP
// POST /api/abdm/create-verify-otp   Body: { txnId, otp }
//
// CHANGES vs existing route:
//  1. Handles simulated txnIds (prefixed "simulated-") — accepts OTP "000000"
//     and returns a dummy ABHA profile. No real ABDM call in simulated mode.
//  2. AbortController with 15-second timeout on all fetch calls.
//  3. All existing response fields (success, healthIdNumber, healthId, token,
//     error) preserved exactly.

import { NextRequest, NextResponse } from "next/server";

const ABDM_SANDBOX_URL = "https://dev.abdm.gov.in";
const ABDM_PROD_URL    = "https://live.abdm.gov.in";

async function getToken(env: string): Promise<string> {
  const clientId     = process.env.ABDM_CLIENT_ID;
  const clientSecret = process.env.ABDM_CLIENT_SECRET;
  const baseUrl      = env === "production" ? ABDM_PROD_URL : ABDM_SANDBOX_URL;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${baseUrl}/gateway/v0.5/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, clientSecret }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Auth failed: ${res.status}`);
    return (await res.json()).accessToken as string;
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { txnId, otp } = body;

    if (!txnId || !otp) {
      return NextResponse.json(
        { success: false, error: "txnId and otp are required" },
        { status: 400 }
      );
    }
    if (!/^\d{6}$/.test(otp)) {
      return NextResponse.json(
        { success: false, error: "OTP must be 6 digits" },
        { status: 400 }
      );
    }

    // ── Simulated mode — txnId starts with "simulated-" ───────────────
    if (String(txnId).startsWith("simulated-")) {
      if (otp !== "000000") {
        return NextResponse.json(
          { success: false, error: "Invalid OTP (simulated mode: use 000000)" },
          { status: 400 }
        );
      }
      // Return a dummy ABHA profile so registration form can be completed
      return NextResponse.json({
        success: true,
        simulated: true,
        healthIdNumber: "91-1234-5678-9012",
        healthId: "demo.patient@abdm",
        token: "simulated-abha-token",
        message: "Simulated ABHA created. Configure ABDM credentials for live use.",
      });
    }
    // ──────────────────────────────────────────────────────────────────

    if (!process.env.ABDM_CLIENT_ID || !process.env.ABDM_CLIENT_SECRET) {
      return NextResponse.json(
        { success: false, error: "ABDM credentials not configured." },
        { status: 400 }
      );
    }

    const environment = process.env.ABDM_ENVIRONMENT ?? "sandbox";
    const token       = await getToken(environment);
    const baseUrl     = environment === "production" ? ABDM_PROD_URL : ABDM_SANDBOX_URL;

    // Step 1 — Verify OTP
    const ctrl1 = new AbortController();
    const t1    = setTimeout(() => ctrl1.abort(), 15000);
    let verifyRes: Response;
    try {
      verifyRes = await fetch(
        `${baseUrl}/abha/api/v1/registration/aadhaar/verifyOtp`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ txnId, otp }),
          signal: ctrl1.signal,
        }
      );
    } finally {
      clearTimeout(t1);
    }

    if (!verifyRes.ok) {
      const errText = await verifyRes.text();
      return NextResponse.json(
        { success: false, error: `OTP verification failed: ${verifyRes.status} ${errText}` },
        { status: verifyRes.status }
      );
    }
    const verifyData = await verifyRes.json();

    // Step 2 — Create Health ID
    const ctrl2 = new AbortController();
    const t2    = setTimeout(() => ctrl2.abort(), 15000);
    let createRes: Response;
    try {
      createRes = await fetch(
        `${baseUrl}/abha/api/v1/registration/aadhaar/createHealthIdWithPreVerified`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ txnId: verifyData.txnId ?? txnId }),
          signal: ctrl2.signal,
        }
      );
    } finally {
      clearTimeout(t2);
    }

    if (!createRes.ok) {
      const errText = await createRes.text();
      return NextResponse.json(
        { success: false, error: `ABHA creation failed: ${createRes.status} ${errText}` },
        { status: createRes.status }
      );
    }

    const createData = await createRes.json();
    return NextResponse.json({
      success: true,
      healthIdNumber: createData.healthIdNumber,
      healthId: createData.healthId,
      token: createData.token,
    });
  } catch (err: unknown) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    const message = isAbort
      ? "ABDM service timed out. Please try again."
      : err instanceof Error
      ? err.message
      : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
