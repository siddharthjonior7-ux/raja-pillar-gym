import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

// Only the public "anon" key lives in the browser. All access is limited by the
// database's Row Level Security, and secrets (WhatsApp token) are never sent here.
export const isConfigured = Boolean(url && key)
export const supabase = createClient(url ?? 'http://localhost:54321', key ?? 'not-configured', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})
