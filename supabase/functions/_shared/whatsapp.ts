// Sends one WhatsApp message through the official WhatsApp Business Cloud API.
// The access token is read here, on the server, and is never sent to the browser.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { buildMessage, templateParams, type MessageData, type MessageKind } from './messages.ts'

export const adminClient = (): SupabaseClient =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

export async function isConfigured(admin: SupabaseClient): Promise<boolean> {
  const { data } = await admin.from('whatsapp_secrets').select('phone_number_id, access_token').eq('id', 1).maybeSingle()
  return !!(data?.phone_number_id && data?.access_token)
}

export interface SendArgs {
  kind: MessageKind
  member_id: string
  membership_id?: string | null
  payment_id?: string | null
  phone: string // 10 digit
  data: MessageData
  created_by?: string | null
}
export interface SendResult {
  status: 'sent' | 'failed' | 'not_configured'
  error?: string
  log_id?: string
}

export async function sendOne(admin: SupabaseClient, a: SendArgs): Promise<SendResult> {
  const { data: secret } = await admin.from('whatsapp_secrets').select('*').eq('id', 1).maybeSingle()
  if (!secret?.access_token || !secret?.phone_number_id) {
    return { status: 'not_configured', error: 'WhatsApp is not connected. Add the credentials in Settings.' }
  }
  const [{ data: gym }, { data: pref }] = await Promise.all([
    admin.from('gym_settings').select('gym_name, address').eq('id', 1).single(),
    admin.from('notification_preferences').select('template_name, template_language').eq('kind', a.kind).single(),
  ])
  const body = buildMessage(a.kind, a.data, { name: gym!.gym_name, address: gym!.address })

  const { data: log, error: logErr } = await admin.from('whatsapp_logs').insert({
    member_id: a.member_id, membership_id: a.membership_id ?? null, payment_id: a.payment_id ?? null,
    kind: a.kind, channel: 'api', status: 'pending', phone: a.phone, message_body: body, created_by: a.created_by ?? null,
  }).select('id').single()
  if (logErr) return { status: 'failed', error: logErr.message }

  const payload = pref?.template_name
    ? {
        messaging_product: 'whatsapp', to: `91${a.phone}`, type: 'template',
        template: {
          name: pref.template_name, language: { code: pref.template_language || 'en' },
          components: [{ type: 'body', parameters: templateParams(a.kind, a.data).map((text) => ({ type: 'text', text })) }],
        },
      }
    // Without an approved template WhatsApp only delivers free text inside a 24 hour chat window.
    : { messaging_product: 'whatsapp', to: `91${a.phone}`, type: 'text', text: { body } }

  try {
    const res = await fetch(`https://graph.facebook.com/${secret.api_version}/${secret.phone_number_id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const out = await res.json().catch(() => ({}))
    if (!res.ok) {
      const error = out?.error?.message ?? `WhatsApp returned ${res.status}`
      await admin.from('whatsapp_logs').update({ status: 'failed', error }).eq('id', log.id)
      return { status: 'failed', error, log_id: log.id }
    }
    await admin.from('whatsapp_logs').update({ status: 'sent', wa_message_id: out?.messages?.[0]?.id ?? null }).eq('id', log.id)
    return { status: 'sent', log_id: log.id }
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Network error'
    await admin.from('whatsapp_logs').update({ status: 'failed', error }).eq('id', log.id)
    return { status: 'failed', error, log_id: log.id }
  }
}
