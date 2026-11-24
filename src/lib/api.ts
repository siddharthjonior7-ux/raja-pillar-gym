import { supabase } from './supabase'

export function errMsg(e: unknown): string {
  const m = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e)
  if (/permission denied|row-level security|42501/i.test(m)) return 'You do not have permission to do this.'
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'No internet connection. Check your network and try again.'
  if (/JWT expired|invalid JWT/i.test(m)) return 'Your session ended. Please log in again.'
  return m
}

export async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(errMsg(error))
  return data as T
}

export function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(errMsg(res.error))
  return res.data as T
}

export async function sendViaApi(body: { kind: string; member_id: string; membership_id?: string | null; payment_id?: string | null }) {
  const { data, error } = await supabase.functions.invoke('send-whatsapp', { body })
  if (error) {
    // the function returns a JSON reason with non-200 status codes
    try {
      const ctx = (error as { context?: Response }).context
      const j = ctx ? await ctx.json() : null
      throw new Error(j?.error ?? error.message)
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : String(e))
    }
  }
  return data as { status: string; error?: string }
}
