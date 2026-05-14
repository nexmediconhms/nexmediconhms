/**
 * src/types/abdm.ts
 *
 * Shared ABDM / ABHA type definitions used across API routes and the client lib.
 * Moving types here avoids circular imports between lib/abdm-client.ts and route files.
 *
 * EXISTING CODE IMPACT: lib/abdm-client.ts already exports these same shapes.
 * Re-exporting from there keeps backwards compatibility:
 *   export type { ABDMConfig, ABHAProfile, ABHAVerifyResult, ABHACreateResult } from '@/types/abdm'
 */

export interface ABDMConfig {
  clientId: string
  clientSecret: string
  environment: 'sandbox' | 'production'
  enabled: boolean
}

export interface ABDMAuthToken {
  accessToken: string
  expiresIn: number
  tokenType: string
  issuedAt: number // timestamp
}

export interface ABHAProfile {
  healthIdNumber: string   // 14-digit ABHA number  XX-XXXX-XXXX-XXXX
  healthId: string         // ABHA address  user@abdm
  name: string
  firstName?: string
  middleName?: string
  lastName?: string
  gender: string            // M | F | O
  yearOfBirth: string
  monthOfBirth?: string
  dayOfBirth?: string
  mobile: string
  email?: string
  address?: string
  districtName?: string
  stateName?: string
  pincode?: string
  kycVerified?: boolean
  profilePhoto?: string    // base64
  status: 'ACTIVE' | 'INACTIVE' | 'DEACTIVATED'
}

export interface ABHAVerifyResult {
  success: boolean
  profile?: ABHAProfile
  error?: string
  /** Present on simulated responses when ABDM creds are not configured */
  simulated?: boolean
  /** Human-readable context message for simulated mode */
  message?: string
}

export interface ABHACreateResult {
  success: boolean
  healthIdNumber?: string
  healthId?: string
  token?: string
  error?: string
  /** txnId echoed back so callers can chain calls */
  txnId?: string
}

/** Shape returned by POST /api/abdm/create-init */
export interface ABHAInitResult {
  txnId?: string
  error?: string
  /** true when ABDM creds are absent and a simulated flow was started */
  simulated?: boolean
  message?: string
}
