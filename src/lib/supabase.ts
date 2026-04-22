import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Client-side Supabase client (uses anon key, respects RLS)
export const supabase = createClient(supabaseUrl, supabaseKey)

/**
 * Server-side Supabase admin client (uses service_role key).
 * Only use in API routes — NEVER expose to the browser.
 * Required for:
 *   - Creating new auth users (invite flow)
 *   - Admin operations that bypass RLS
 *   - Password reset emails
 */
export function getAdminClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. ' +
      'Add it to your .env.local or Vercel environment variables. ' +
      'Find it in Supabase → Project Settings → API → service_role key.'
    )
  }
  return createClient(supabaseUrl, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
