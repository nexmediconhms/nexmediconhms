// src/app/api/abdm/create-init/route.ts
// ABDM ABHA Creation — Initiate via Aadhaar OTP
// POST /api/abdm/create-init   Body: { aadhaar: "123456789012" }
//
// CHANGES vs existing route:
//  1. Graceful degradation — when ABDM env vars are not set, returns a
//     simulated txnId (prefixed "simulated-") so the registration form
//     is never blocked in dev/staging.
//  2. AbortController with 15-second timeout on every fetch — prevents
//     the serverless function from hanging when ABDM gateway is slow/down.
//  3. Preserves ALL existing response field names: txnId, error, simulated.

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
    const cleaned: string = (body.aadhaar ?? "").replace(/[\s-]/g, "");

    if (!/^\d{12}$/.test(cleaned)) {
      return NextResponse.json(
        { error: "Valid 12-digit Aadhaar number is required" },
        { status: 400 }
      );
    }

    // Graceful degradation — simulated flow when ABDM is not configured
    if (!process.env.ABDM_CLIENT_ID || !process.env.ABDM_CLIENT_SECRET) {
      const simulatedTxnId = `simulated-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      return NextResponse.json({
        txnId: simulatedTxnId,
        simulated: true,
        message:
          "ABDM credentials not configured. Simulated OTP flow — use OTP 000000 to proceed.",
      });
    }

    const environment = process.env.ABDM_ENVIRONMENT ?? "sandbox";
    const token       = await getToken(environment);
    const baseUrl     = environment === "production" ? ABDM_PROD_URL : ABDM_SANDBOX_URL;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let res: Response;
    try {
      res = await fetch(
        `${baseUrl}/abha/api/v1/registration/aadhaar/generateOtp`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ aadhaar: cleaned }),
          signal: controller.signal,
        }
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json(
        { error: `OTP generation failed: ${res.status} ${errText}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json({ txnId: data.txnId });
  } catch (err: unknown) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    const message = isAbort
      ? "ABDM service timed out. Please try again."
      : err instanceof Error
      ? err.message
      : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
