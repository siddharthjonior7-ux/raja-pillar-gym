// Scheduled sender (see README step 6). Does nothing until the owner connects the API
// and switches a reminder on in Settings > Reminders.
import { adminClient, cors, isConfigured, json, sendOne } from '../_shared/whatsapp.ts'
import type { MessageKind } from '../_shared/messages.ts'

const MODES: Record<string, MessageKind[]> = {
  daily: ['overdue', 'pending_fee', 'expiry', 'renewal'],
  confirmations: ['payment_confirmation'],
}
const MAX_PER_RUN = 100

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const secret = Deno.env.get('CRON_SECRET')
  if (!secret || req.headers.get('x-cron-secret') !== secret) return json({ error: 'Unauthorized' }, 401)

  const admin = adminClient()
  const body = await req.json().catch(() => ({}))
  const kinds = MODES[body.mode ?? 'daily']
  if (!kinds) return json({ error: 'mode must be daily or confirmations' }, 400)

  if (!(await isConfigured(admin))) return json({ skipped: 'WhatsApp API is not connected' })

  const summary: Record<string, { sent: number; failed: number }> = {}
  let total = 0
  for (const kind of kinds) {
    summary[kind] = { sent: 0, failed: 0 }
    const { data: rows, error } = await admin.rpc('reminder_candidates', { p_kind: kind })
    if (error) { summary[kind] = { sent: 0, failed: 0, error: error.message } as never; continue }
    for (const r of rows ?? []) {
      if (total >= MAX_PER_RUN) break
      const res = await sendOne(admin, {
        kind, member_id: r.member_id, membership_id: r.membership_id, payment_id: r.payment_id, phone: r.phone,
        data: { name: r.full_name, amount: Number(r.amount), dueDate: r.due_date, endDate: r.end_date, plan: r.plan_name },
      })
      res.status === 'sent' ? summary[kind].sent++ : summary[kind].failed++
      total++
      await new Promise((ok) => setTimeout(ok, 400)) // gentle pace
    }
  }
  return json({ done: true, summary })
})
