/**
 * src/lib/storage-upload.ts
 *
 * FIXES THE ERROR:
 * "Storage unavailable (mime type text/plain is not supported) → using DB storage"
 *
 * ROOT CAUSE:
 * When you do `supabase.storage.from(bucket).upload(path, file)` WITHOUT
 * specifying contentType, Supabase uses the browser's detected mime type.
 * For many files (especially on mobile), browsers report mime type as
 * "text/plain" even for images and PDFs. Supabase Storage rejects these.
 *
 * FIX:
 * Always explicitly set contentType based on the file's extension.
 * This bypasses the browser's incorrect mime type detection.
 *
 * USAGE:
 * import { uploadFile, getFileUrl } from '@/lib/storage-upload'
 *
 * // Upload a file
 * const result = await uploadFile(file)
 * if (result.error) {
 *   console.error(result.error)
 * } else {
 *   // Save result.storageKey or result.fileData to database
 *   console.log('Uploaded:', result.publicUrl)
 * }
 *
 * // Get URL to display a file
 * const url = getFileUrl(attachment.storage_key, attachment.file_data)
 */

import { supabase } from './supabase'

// ── Mime type lookup ──────────────────────────────────────────
// Maps file extensions → correct mime types
// This fixes the "text/plain not supported" error

const MIME_TYPES: Record<string, string> = {
  // Images
  'jpg':  'image/jpeg',
  'jpeg': 'image/jpeg',
  'png':  'image/png',
  'gif':  'image/gif',
  'webp': 'image/webp',
  'bmp':  'image/bmp',
  'svg':  'image/svg+xml',
  'heic': 'image/heic',
  'heif': 'image/heif',
  // Documents
  'pdf':  'application/pdf',
  'doc':  'application/msword',
  'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'xls':  'application/vnd.ms-excel',
  'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'txt':  'text/plain',
  'csv':  'text/csv',
  // Audio/Video
  'mp4':  'video/mp4',
  'mp3':  'audio/mpeg',
  'wav':  'audio/wav',
}

/**
 * Get the correct mime type for a file.
 * Ignores browser-detected type (which is often wrong on mobile).
 * Falls back to file.type if extension is not in our map.
 */
function getCorrectMimeType(file: File): string {
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  
  // Check our map first — more reliable than browser detection
  if (MIME_TYPES[ext]) {
    return MIME_TYPES[ext]
  }

  // Use browser type only if it's not the generic/wrong ones
  if (
    file.type &&
    file.type !== 'text/plain' &&
    file.type !== 'application/octet-stream' &&
    file.type !== ''
  ) {
    return file.type
  }

  // Last resort fallback
  return 'application/octet-stream'
}

// ── Result type ───────────────────────────────────────────────

export interface UploadResult {
  /** Where the file was stored */
  source:     'storage' | 'db'
  /** Supabase Storage path (if stored in storage) */
  storageKey?: string
  /** base64 data URL (if stored in DB as fallback) */
  fileData?:   string
  /** Public URL to access the file */
  publicUrl?:  string
  /** Error message if upload failed completely */
  error?:      string
}

// 2MB limit for DB fallback storage
const MAX_DB_SIZE_BYTES = 2 * 1024 * 1024

/**
 * Upload a file to Supabase Storage with the correct mime type.
 * Automatically falls back to base64 database storage if Storage is unavailable.
 *
 * @param file   - The File object from an <input type="file"> element
 * @param bucket - Supabase storage bucket name (default: 'consultation-files')
 * @param folder - Subfolder within the bucket (default: 'attachments')
 */
export async function uploadFile(
  file:   File,
  bucket = 'consultation-files',
  folder = 'attachments',
): Promise<UploadResult> {
  // Build a safe filename: timestamp + sanitized original name
  const timestamp = Date.now()
  const safeName  = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path      = `${folder}/${timestamp}_${safeName}`

  // Get the correct mime type (THIS IS THE FIX)
  const mimeType = getCorrectMimeType(file)

  // ── Try Supabase Storage first ────────────────────────────
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(path, file, {
        contentType: mimeType,  // ← CRITICAL: explicit mime type
        upsert:      false,
        cacheControl: '3600',
      })

    if (!error && data) {
      // Storage upload succeeded
      const { data: urlData } = supabase.storage
        .from(bucket)
        .getPublicUrl(path)

      return {
        source:     'storage',
        storageKey: path,
        publicUrl:  urlData?.publicUrl,
      }
    }

    // Storage failed — log why and fall through to DB fallback
    console.warn(`[storage-upload] Storage upload failed for "${file.name}":`, error?.message)

  } catch (storageErr: any) {
    console.warn(`[storage-upload] Storage exception for "${file.name}":`, storageErr?.message)
  }

  // ── Fallback: store as base64 in database ─────────────────
  // Only if file is small enough (≤ 2MB)

  if (file.size > MAX_DB_SIZE_BYTES) {
    const sizeMB = (file.size / 1024 / 1024).toFixed(1)
    return {
      source: 'db',
      error: `File is ${sizeMB} MB — too large for offline storage (max 2 MB). ` +
             `To fix: Create a Supabase Storage bucket named "${bucket}" ` +
             `and make sure it allows uploads.`,
    }
  }

  try {
    // Convert file to base64
    const buffer = await file.arrayBuffer()
    const bytes  = new Uint8Array(buffer)
    let binary   = ''
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    const base64   = btoa(binary)
    const fileData = `data:${mimeType};base64,${base64}`

    return {
      source:   'db',
      fileData,
    }
  } catch (convertErr: any) {
    return {
      source: 'db',
      error:  `Failed to process file: ${convertErr?.message || 'Unknown error'}`,
    }
  }
}

/**
 * Get the URL to display/download a stored file.
 * Works for both Storage files and DB base64 files.
 *
 * @param storageKey - The path returned from uploadFile() when source='storage'
 * @param fileData   - The base64 string returned from uploadFile() when source='db'
 * @param bucket     - The storage bucket name
 */
export function getFileUrl(
  storageKey?: string | null,
  fileData?:   string | null,
  bucket = 'consultation-files',
): string | null {
  if (storageKey) {
    const { data } = supabase.storage.from(bucket).getPublicUrl(storageKey)
    return data?.publicUrl || null
  }
  if (fileData) {
    return fileData  // base64 data URL — works directly in <img src> and links
  }
  return null
}

/**
 * Check if Supabase Storage is available and configured.
 * Returns true if uploads to the given bucket will work.
 * Useful to show the user a warning before they try to upload.
 */
export async function isStorageAvailable(bucket = 'consultation-files'): Promise<boolean> {
  try {
    const { error } = await supabase.storage.getBucket(bucket)
    return !error
  } catch {
    return false
  }
}

/**
 * Delete a file from Supabase Storage.
 * Call this when an attachment is deleted from the database.
 */
export async function deleteStorageFile(
  storageKey: string,
  bucket = 'consultation-files',
): Promise<boolean> {
  try {
    const { error } = await supabase.storage
      .from(bucket)
      .remove([storageKey])
    return !error
  } catch {
    return false
  }
}