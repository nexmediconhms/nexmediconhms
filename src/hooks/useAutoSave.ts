/**
 * src/hooks/useAutoSave.ts
 *
 * BUG FIX M1: This file was previously empty (0 bytes), causing any import
 * from '@/hooks/useAutoSave' to resolve to undefined exports and crash at runtime.
 *
 * The actual implementation lives in src/lib/useAutoSave.ts.
 * This file now re-exports everything from that module so both import paths work:
 *   import { useAutoSave } from '@/hooks/useAutoSave'   ← works
 *   import { useAutoSave } from '@/lib/useAutoSave'     ← also works
 */

export { useAutoSave, useFormDraft } from '@/lib/useAutoSave'
export type { AutoSaveStatus } from '@/lib/useAutoSave'