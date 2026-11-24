// Called from the app when staff press "Send on WhatsApp" and the API is connected.
// Amounts and dates are read from the database here. The browser cannot choose them.
import { adminClient, cors, isConfigured, json, sendOne } from '../_shared/whatsapp.ts'
import type { MessageKind } from '../_shared/messages.ts'

const KINDS: MessageKind[] = ['pending_fee', 'overdue', 'expiry', 'renewal', 'payment_confirmation']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)
  const admin = adminClient()

  // who is calling?
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const { data: u } = await admin.auth.getUser(jwt)
  if (!u?.user) return json({ error: 'Please log in again.' }, 401)
  const { data: prof } = await admin.from('profiles').select('role, active').eq('id', u.user.id).maybeSingle()
  if (!prof?.active || !['owner', 'receptionist'].includes(prof.role)) return json({ error: 'Not allowed.' }, 403)

  const body = await req.json().catch(() => ({}))
  const kind = body.kind as MessageKind
  if (!KINDS.includes(kind)) return json({ error: 'Unknown message type.' }, 400)
  if (!(await isConfigured(admin))) {
    return json({ status: 'not_configured', error: 'WhatsApp is not connected. Use the click-to-chat button instead.' }, 409)
  }

  const { data: member } = await admin.from('members').select('id, full_name, phone, whatsapp_consent, archived_at').eq('id', body.member_id).maybeSingle()
  if (!member || member.archived_at) return json({ error: 'Member not found.' }, 404)
  if (!member.whatsapp_consent) return json({ error: 'This member has not agreed to WhatsApp messages.' }, 409)

  let data = { name: member.full_name } as Record<string, unknown>
  let membership_id: string | null = body.membership_id ?? null
  let payment_id: string | null = body.payment_id ?? null

  if (kind === 'payment_confirmation') {
    const { data: pay } = await admin.from('payments').select('id, amount, membership_id').eq('id', payment_id).maybeSingle()
    if (!pay) return json({ error: 'Payment not found.' }, 404)
    const { data: ms } = await admin.from('v_memberships').select('plan_name, end_date').eq('id', pay.membership_id).single()
    membership_id = pay.membership_id
    data = { ...data, amount: Number(pay.amount), plan: ms?.plan_name, endDate: ms?.end_date }
  } else {
    const { data: ms } = await admin.from('v_memberships').select('id, balance, due_date, end_date, plan_name').eq('id', membership_id).maybeSingle()
    if (!ms) return json({ error: 'Membership not found.' }, 404)
    data = { ...data, amount: Number(ms.balance), dueDate: ms.due_date, endDate: ms.end_date, plan: ms.plan_name }
  }

  // do not message the same person about the same thing twice in a day
  if (!body.force) {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    let dup = admin.from('whatsapp_logs').select('id').eq('member_id', member.id).eq('kind', kind)
      .in('status', ['sent', 'pending']).gte('created_at', since).limit(1)
    if (payment_id) dup = dup.eq('payment_id', payment_id)
    const { data: seen } = await dup
    if (seen?.length) return json({ status: 'skipped', error: 'Already sent in the last 24 hours.' }, 409)
  }

  const result = await sendOne(admin, {
    kind, member_id: member.id, membership_id, payment_id, phone: member.phone,
    data: data as never, created_by: u.user.id,
  })
  return json(result, result.status === 'sent' ? 200 : 502)
})
