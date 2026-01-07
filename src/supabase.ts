import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

let cachedSupabase: any = null

function createSupabaseClient() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error('Missing SUPABASE env vars')
  }

  const client = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    }
  })

  return client
}

export function getSupabaseClient() {
  if (!cachedSupabase) {
    cachedSupabase = createSupabaseClient()
  }
  return cachedSupabase
}

// Lazy-load the supabase client on first export
export const supabase = new Proxy({}, {
  get: (target, prop) => {
    return getSupabaseClient()[prop as string]
  }
}) as any
