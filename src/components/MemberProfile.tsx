import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { rpc, errMsg, must } from '../lib/api'
import { useAsync } from '../lib/hooks'
import { daysText, fmtDate, fmtDateTime, inr, METHOD_LABEL, showPhone } from '../lib/format'
import type { Member, Membership, Payment } from '../lib/types'
import { useData } from '../data'
import { Confirm, ErrorBox, Field, Loading, MemBadge, Modal, PayBadge, useToast } from './ui'
import { EditMemberModal, PaymentModal, RenewModal } from './forms'
import { WaButton } from './WhatsAppModal'

export function MemberProfile({ memberId, onClose, onChanged }: { memberId: string; onClose: () => void; onChanged: () => void }) {
  const { isOwner } = useData()
  const toast = useToast()
  const { data, loading, error, reload } = useAsync(async () => {
    const [m, ms, pay] = await Promise.all([
      supabase.from('v_members').select('*').eq('id', memberId).single(),
      supabase.from('v_memberships').select('*').eq('member_id', memberId).order('start_date', { ascending: false }),
      supabase.from('payments').select('*').eq('member_id', memberId).order('paid_at', { ascending: false }),
    ])
    return { m: must(m) as Member, ms: (must(ms) as Membership[]) ?? [], pay: (must(pay) as Payment[]) ?? [] }
  }, [memberId])

  const [edit, setEdit] = useState(false)
  const [renew, setRenew] = useState(false)
  const [payFor, setPayFor] = useState<Membership | null>(null)
  const [archive, setArchive] = useState(false)
  const [cancelMs, setCancelMs] = useState<Membership | null>(null)
  const [voidPay, setVoidPay] = useState<Payment | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const changed = () => { reload(); onChanged() }
  async function run(fn: () => Promise<unknown>, okMsg: string, close: () => void) {
    setBusy(true); setErr(null)
    try { await fn(); toast(okMsg); close(); setReason(''); changed() } catch (e) { setErr(errMsg(e)) }
    setBusy(false)
  }

  if (loading && !data) return <Modal title="Member" onClose={onClose}><Loading /></Modal>
  if (error || !data) return <Modal title="Member" onClose={onClose}><ErrorBox msg={error ?? 'Could not load this member.'} retry={reload} /></Modal>
  const { m, ms, pay } = data
  const current = ms.find((x) => x.membership_status === 'active') ?? ms.find((x) => x.membership_status === 'upcoming') ?? ms[0]
  const open = ms.filter((x) => ['pending', 'partial', 'overdue'].includes(x.pay_status))
  const archived = Boolean(m.archived_at)

  return (
    <Modal title={m.full_name} onClose={onClose} wide footer={
      <>
        {isOwner && (archived
          ? <button className="btn ghost" onClick={() => rpc('restore_member', { p_member: m.id }).then(() => { toast('Member restored'); changed() }).catch((e) => toast(errMsg(e), 'error'))}>Restore member</button>
          : <button className="btn ghost" onClick={() => setArchive(true)}>Archive</button>)}
        <button className="btn" onClick={() => setEdit(true)}>Edit details</button>
        {!archived && <button className="btn dark" onClick={() => setRenew(true)}>Renew</button>}
      </>
    }>
      <div className="stack">
        <div className="row wrap">
          <span className="badge none">{m.member_code}</span>
          <MemBadge s={m.membership_status} />
          <PayBadge s={m.fee_status} />
          {archived && <span className="badge cancelled">Archived</span>}
        </div>

        <dl className="kv">
          <dt>Mobile</dt><dd>{showPhone(m.phone)} {!m.whatsapp_consent && <span className="badge pending">No WhatsApp consent</span>}</dd>
          <dt>Gender</dt><dd>{m.gender === 'women' ? 'Women' : 'Men'}</dd>
          <dt>Joined</dt><dd>{fmtDate(m.joined_on)}</dd>
          {m.age && <><dt>Age</dt><dd>{m.age}</dd></>}
          {m.address && <><dt>Address</dt><dd>{m.address}</dd></>}
          {m.emergency_contact && <><dt>Emergency</dt><dd>{m.emergency_contact}</dd></>}
          {m.notes && <><dt>Notes</dt><dd>{m.notes}</dd></>}
          {current && <><dt>Current plan</dt><dd>{current.plan_name}, {fmtDate(current.start_date)} to {fmtDate(current.end_date)} ({daysText(current.days_left)})</dd></>}
          <dt>Outstanding</dt><dd><b>{inr(m.outstanding)}</b></dd>
        </dl>

        {!archived && (
          <div className="row wrap">
            {open.length > 0 && <button className="btn primary" onClick={() => setPayFor(open[0])}>Record payment</button>}
            {current && (
              <WaButton label="WhatsApp" className="btn wa" onSent={changed} target={{
                member_id: m.id, name: m.full_name, phone: m.phone, consent: m.whatsapp_consent, membership_id: current.id,
                amount: Number(current.balance), due_date: current.due_date, end_date: current.end_date, plan: current.plan_name,
                kind: current.pay_status === 'overdue' ? 'overdue' : ['pending', 'partial'].includes(current.pay_status) ? 'pending_fee' : current.membership_status === 'expired' ? 'renewal' : 'expiry',
              }} />
            )}
          </div>
        )}

        <h3>Memberships</h3>
        <div className="card flush table-wrap">
          <table>
            <thead><tr><th>Plan</th><th>Period</th><th className="right">Price</th><th className="right">Paid</th><th>Status</th><th /></tr></thead>
            <tbody>
              {ms.map((x) => (
                <tr key={x.id}>
                  <td>{x.plan_name}{x.kind === 'renewal' && <span className="sub">Renewal</span>}</td>
                  <td>{fmtDate(x.start_date)} to {fmtDate(x.end_date)}<span className="sub">Due {fmtDate(x.due_date)}</span></td>
                  <td className="right num">{inr(x.final_amount)}{Number(x.discount) > 0 && <span className="sub">{inr(x.original_price)} − {inr(x.discount)}</span>}</td>
                  <td className="right num">{inr(x.amount_paid)}</td>
                  <td><PayBadge s={x.pay_status} /></td>
                  <td className="actions">
                    {['pending', 'partial', 'overdue'].includes(x.pay_status) && <button className="btn sm primary" onClick={() => setPayFor(x)}>Pay</button>}{' '}
                    {isOwner && x.pay_status !== 'cancelled' && <button className="btn sm ghost" onClick={() => setCancelMs(x)}>Cancel</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3>Payment history</h3>
        {pay.length === 0 ? <p className="muted">No payments recorded yet.</p> : (
          <div className="card flush table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Method</th><th className="right">Amount</th><th /></tr></thead>
              <tbody>
                {pay.map((p) => (
                  <tr key={p.id} style={p.voided_at ? { opacity: .55 } : undefined}>
                    <td>{fmtDateTime(p.paid_at)}{p.transaction_id && <span className="sub">Txn {p.transaction_id}</span>}{p.notes && <span className="sub">{p.notes}</span>}</td>
                    <td>{METHOD_LABEL[p.method]}</td>
                    <td className="right num">{p.voided_at ? <s>{inr(p.amount)}</s> : inr(p.amount)}{p.voided_at && <span className="sub">Voided: {p.void_reason}</span>}</td>
                    <td className="actions">{isOwner && !p.voided_at && <button className="btn sm ghost" onClick={() => setVoidPay(p)}>Void</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {edit && <EditMemberModal m={m} onClose={() => setEdit(false)} onDone={changed} />}
      {renew && <RenewModal member={m} expiry={m.expiry_date} onClose={() => setRenew(false)} onDone={changed} />}
      {payFor && <PaymentModal ms={payFor} onClose={() => setPayFor(null)} onDone={changed} />}
      {archive && (
        <Confirm title="Archive this member?" confirmLabel="Archive" danger busy={busy} onClose={() => setArchive(false)}
          onConfirm={() => run(() => rpc('archive_member', { p_member: m.id }), 'Member archived', () => setArchive(false))}
          message={<><p>{m.full_name} will no longer appear in member counts or reminders. Their payments and history are kept, and you can restore them any time.</p>{err && <ErrorBox msg={err} />}</>} />
      )}
      {cancelMs && (
        <Confirm title="Cancel this membership?" confirmLabel="Cancel membership" danger busy={busy} onClose={() => { setCancelMs(null); setReason('') }}
          onConfirm={() => run(() => rpc('cancel_membership', { p_membership: cancelMs.id, p_reason: reason }), 'Membership cancelled', () => setCancelMs(null))}
          message={<><p>{cancelMs.plan_name} ({fmtDate(cancelMs.start_date)} to {fmtDate(cancelMs.end_date)}) stops counting as active and its balance is no longer due. Payments already received stay on record.</p>
            <Field label="Reason"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>{err && <ErrorBox msg={err} />}</>} />
      )}
      {voidPay && (
        <Confirm title="Void this payment?" confirmLabel="Void payment" danger busy={busy} onClose={() => { setVoidPay(null); setReason('') }}
          onConfirm={() => run(() => rpc('void_payment', { p_payment: voidPay.id, p_reason: reason }), 'Payment voided', () => setVoidPay(null))}
          message={<><p>{inr(voidPay.amount)} received on {fmtDateTime(voidPay.paid_at)} will stop counting as revenue and the balance becomes due again. The record stays in the history.</p>
            <Field label="Reason"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>{err && <ErrorBox msg={err} />}</>} />
      )}
    </Modal>
  )
}
