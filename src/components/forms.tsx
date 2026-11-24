import { useMemo, useRef, useState } from 'react'
import { rpc, errMsg, must } from '../lib/api'
import { supabase } from '../lib/supabase'
import { addDays, cleanPhone, fmtDate, inr, membershipEnd, METHOD_LABEL, todayISO, validPhone } from '../lib/format'
import { newKey } from '../lib/hooks'
import type { Gender, Member, Membership, Method } from '../lib/types'
import { useData } from '../data'
import { Field, Modal, useToast, ErrorBox } from './ui'
import { WaButton } from './WhatsAppModal'

const METHODS: Method[] = ['cash', 'upi', 'bank_transfer', 'other']

// ---------- shared: choose a plan, see the real price, optional discount ----------
function usePrice(gender: Gender, months: number | null, discount: number) {
  const { plans } = useData()
  const plan = plans.find((p) => p.months === months && p.active) ?? null
  const original = plan ? Number(gender === 'women' ? plan.price_women : plan.price_men) : 0
  const disc = Math.min(Math.max(discount || 0, 0), original)
  return { plan, original, disc, final: original - disc }
}

function PlanPicker({ gender, value, onChange }: { gender: Gender; value: number | null; onChange: (m: number) => void }) {
  const { plans } = useData()
  const active = plans.filter((p) => p.active)
  const one = active.find((p) => p.months === 1)
  if (!active.length) return <div className="notice warn">No membership plans yet. The owner can add them in Settings.</div>
  return (
    <div className="plan-pick" role="group" aria-label="Membership plan">
      {active.map((p) => {
        const price = Number(gender === 'women' ? p.price_women : p.price_men)
        const monthly = Math.round(price / p.months)
        const oneP = one ? Number(gender === 'women' ? one.price_women : one.price_men) : null
        const save = oneP && p.months > 1 ? oneP * p.months - price : 0
        return (
          <button type="button" key={p.id} aria-pressed={value === p.months} onClick={() => onChange(p.months)}>
            <span>{p.name}</span>
            <b>{inr(price)}</b>
            <span>{p.months > 1 ? `${inr(monthly)} a month` : 'Monthly'}{save > 0 ? ` · save ${inr(save)}` : ''}</span>
          </button>
        )
      })}
    </div>
  )
}

function DiscountField({ original, value, onChange }: { original: number; value: string; onChange: (v: string) => void }) {
  const { gym, isOwner } = useData()
  const max = isOwner ? original : Math.floor((original * Number(gym.receptionist_max_discount_pct)) / 100)
  return (
    <Field label="Discount (₹)" hint={isOwner ? 'Optional. Stored separately from the plan price.' : max > 0 ? `You can give up to ${inr(max)}.` : 'Only the owner can give a discount.'}>
      <input className="input" inputMode="numeric" value={value} disabled={max <= 0} placeholder="0" onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ''))} />
    </Field>
  )
}

function PayBlock({ final, mode, setMode, amount, setAmount, method, setMethod, txn, setTxn, note, setNote, confirmed, setConfirmed }: {
  final: number; mode: 'none' | 'part' | 'full'; setMode: (m: 'none' | 'part' | 'full') => void
  amount: string; setAmount: (v: string) => void; method: Method; setMethod: (m: Method) => void
  txn: string; setTxn: (v: string) => void; note: string; setNote: (v: string) => void
  confirmed: boolean; setConfirmed: (v: boolean) => void
}) {
  const paying = mode === 'full' ? final : Number(amount || 0)
  return (
    <div className="stack">
      <div className="seg" role="group" aria-label="Payment">
        <button type="button" aria-pressed={mode === 'none'} onClick={() => setMode('none')}>Not paid yet</button>
        <button type="button" aria-pressed={mode === 'part'} onClick={() => setMode('part')}>Part payment</button>
        <button type="button" aria-pressed={mode === 'full'} onClick={() => setMode('full')}>Paid in full</button>
      </div>
      {mode !== 'none' && (
        <>
          <div className="form-grid">
            {mode === 'part' && <Field label="Amount received (₹)"><input className="input" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))} /></Field>}
            <Field label="Payment method">
              <select className="input" value={method} onChange={(e) => setMethod(e.target.value as Method)}>
                {METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
              </select>
            </Field>
            <Field label="Transaction ID (optional)"><input className="input" value={txn} onChange={(e) => setTxn(e.target.value)} /></Field>
            <Field label="Note (optional)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </div>
          <label className="check">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>I have received <b>{inr(paying)}</b> by {METHOD_LABEL[method]}.</span>
          </label>
        </>
      )}
    </div>
  )
}

function paymentPayload(mode: 'none' | 'part' | 'full', final: number, amount: string, method: Method, txn: string, note: string, key: string) {
  if (mode === 'none') return undefined
  return { amount: mode === 'full' ? final : Number(amount), method, transaction_id: txn || null, notes: note || null, idempotency_key: key }
}

function validatePay(mode: 'none' | 'part' | 'full', final: number, amount: string, confirmed: boolean): string | null {
  if (mode === 'none') return null
  if (mode === 'part') {
    const a = Number(amount)
    if (!a || a <= 0) return 'Enter the amount received.'
    if (a >= final) return 'That is the full amount. Choose “Paid in full”.'
  }
  if (!confirmed) return 'Tick the box to confirm you received the money.'
  return null
}

// ---------- register ----------
export function RegisterModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { gym, plans } = useData()
  const toast = useToast()
  const keys = useRef({ request: newKey(), pay: newKey() })
  const [f, setF] = useState({ name: '', phone: '', age: '', address: '', emergency: '', notes: '', consent: true })
  const [gender, setGender] = useState<Gender>('men')
  const [months, setMonths] = useState<number | null>(null)
  const [joined, setJoined] = useState(todayISO())
  const [start, setStart] = useState(todayISO())
  const [discount, setDiscount] = useState('')
  const [mode, setMode] = useState<'none' | 'part' | 'full'>('none')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<Method>('cash')
  const [txn, setTxn] = useState('')
  const [note, setNote] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<null | { code: string; member_id: string; membership_id: string; payment_id: string | null; balance: number; end: string; final: number; name: string; phone: string; plan: string }>(null)

  const price = usePrice(gender, months, Number(discount || 0))
  const selected = months ?? (plans.find((p) => p.active)?.months ?? null)
  const phoneOk = validPhone(f.phone)

  async function save() {
    setErr(null)
    if (f.name.trim().length < 2) return setErr('Enter the member’s full name.')
    if (!phoneOk) return setErr('Enter a valid 10 digit mobile number. It is needed for WhatsApp.')
    if (!months) return setErr('Choose a membership plan.')
    const pe = validatePay(mode, price.final, amount, confirmed)
    if (pe) return setErr(pe)
    setBusy(true)
    try {
      const r = await rpc<{ member_id: string; member_code: string; membership_id: string; payment_id: string | null; balance: number; end_date: string; final_amount: number }>('register_member', {
        p: {
          full_name: f.name, phone: f.phone, gender, plan_months: months, joined_on: joined, start_date: start,
          discount: Number(discount || 0), age: f.age || null, address: f.address, emergency_contact: f.emergency, notes: f.notes,
          whatsapp_consent: f.consent, request_key: keys.current.request,
          payment: paymentPayload(mode, price.final, amount, method, txn, note, keys.current.pay),
        },
      })
      toast(`${f.name.trim()} registered as ${r.member_code}`)
      setDone({ code: r.member_code, member_id: r.member_id, membership_id: r.membership_id, payment_id: r.payment_id, balance: Number(r.balance), end: r.end_date, final: Number(r.final_amount), name: f.name.trim(), phone: f.phone, plan: plans.find((p) => p.months === months)?.name ?? '' })
      onDone()
    } catch (e) { setErr(errMsg(e)) }
    setBusy(false)
  }

  if (done) {
    return (
      <Modal title="Member registered" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Done</button>}>
        <div className="stack">
          <div className="summary">
            <div className="line"><span>Member ID</span><b>{done.code}</b></div>
            <div className="line"><span>Name</span><b>{done.name}</b></div>
            <div className="line"><span>Plan</span><b>{done.plan}</b></div>
            <div className="line"><span>Valid until</span><b>{fmtDate(done.end)}</b></div>
            <div className="line total"><span>{done.balance > 0 ? 'Balance to pay' : 'Fully paid'}</span><b>{done.balance > 0 ? inr(done.balance) : inr(done.final)}</b></div>
          </div>
          <div className="row wrap">
            {done.payment_id
              ? <WaButton label="Send payment confirmation" target={{ member_id: done.member_id, name: done.name, phone: done.phone, consent: f.consent, membership_id: done.membership_id, payment_id: done.payment_id, amount: done.final - done.balance, end_date: done.end, plan: done.plan, kind: 'payment_confirmation' }} />
              : <WaButton label="Send fee reminder" target={{ member_id: done.member_id, name: done.name, phone: done.phone, consent: f.consent, membership_id: done.membership_id, amount: done.balance, end_date: done.end, plan: done.plan, kind: 'pending_fee' }} />}
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Add new member" onClose={onClose} wide footer={
      <>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save member'}</button>
      </>
    }>
      <div className="stack">
        <div className="form-grid">
          <Field label="Full name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="off" autoFocus /></Field>
          <Field label="Mobile number" hint="Used for WhatsApp reminders" error={f.phone && !phoneOk ? '10 digits, starting with 6, 7, 8 or 9' : null}>
            <div className="phone-wrap"><span className="cc">+91</span>
              <input className="input" inputMode="numeric" value={f.phone} onChange={(e) => setF({ ...f, phone: cleanPhone(e.target.value) })} placeholder="98765 43210" />
            </div>
          </Field>
          <Field label="Gender">
            <div className="seg" role="group" aria-label="Gender">
              <button type="button" aria-pressed={gender === 'men'} onClick={() => setGender('men')}>Men</button>
              <button type="button" aria-pressed={gender === 'women'} onClick={() => setGender('women')}>Women</button>
            </div>
          </Field>
          <Field label="Joining date"><input className="input" type="date" value={joined} onChange={(e) => setJoined(e.target.value)} /></Field>
        </div>

        <Field label="Membership plan"><PlanPicker gender={gender} value={months} onChange={setMonths} /></Field>

        <div className="form-grid">
          <Field label="Membership starts" hint={months ? `Ends ${fmtDate(membershipEnd(start, months))}` : undefined}>
            <input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <DiscountField original={price.original} value={discount} onChange={setDiscount} />
        </div>

        <div className="summary" aria-live="polite">
          <div className="line"><span>Plan price ({gender === 'women' ? 'women' : 'men'})</span><span className="num">{months ? inr(price.original) : '—'}</span></div>
          {price.disc > 0 && <div className="line"><span>Discount</span><span className="num">− {inr(price.disc)}</span></div>}
          <div className="line total"><span>Amount to charge</span><span className="num">{months ? inr(price.final) : '—'}</span></div>
        </div>

        <Field label="Payment"><PayBlock final={price.final} mode={mode} setMode={setMode} amount={amount} setAmount={setAmount} method={method} setMethod={setMethod} txn={txn} setTxn={setTxn} note={note} setNote={setNote} confirmed={confirmed} setConfirmed={setConfirmed} /></Field>

        <label className="check"><input type="checkbox" checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} />
          <span>Member agrees to receive WhatsApp messages from {gym.gym_name} about fees and membership.</span></label>

        <button type="button" className="linkbtn" onClick={() => setMore(!more)}>{more ? 'Hide extra details' : 'Add age, address, emergency contact, notes'}</button>
        {more && (
          <div className="form-grid">
            <Field label="Age"><input className="input" inputMode="numeric" value={f.age} onChange={(e) => setF({ ...f, age: e.target.value.replace(/\D/g, '').slice(0, 3) })} /></Field>
            <Field label="Emergency contact"><input className="input" value={f.emergency} onChange={(e) => setF({ ...f, emergency: e.target.value })} /></Field>
            <div className="full"><Field label="Address"><input className="input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field></div>
            <div className="full"><Field label="Notes"><textarea className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field></div>
          </div>
        )}
        {selected == null && <span />}
        {err && <ErrorBox msg={err} />}
      </div>
    </Modal>
  )
}

// ---------- record payment ----------
export function PaymentModal({ ms, onClose, onDone }: { ms: Membership; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const key = useRef(newKey())
  const [amount, setAmount] = useState(String(Number(ms.balance)))
  const [method, setMethod] = useState<Method>('cash')
  const [txn, setTxn] = useState('')
  const [note, setNote] = useState('')
  const [ok, setOk] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<null | { id: string; paid: number; balance: number }>(null)
  const bal = Number(ms.balance)
  const amt = Number(amount || 0)

  async function save() {
    setErr(null)
    if (!amt || amt <= 0) return setErr('Enter the amount received.')
    if (amt > bal) return setErr(`The balance is only ${inr(bal)}.`)
    if (!ok) return setErr('Tick the box to confirm you received the money.')
    setBusy(true)
    try {
      const r = await rpc<{ payment_id: string; amount: number; balance: number }>('record_payment', {
        p_membership: ms.id, p_amount: amt, p_method: method, p_transaction_id: txn || null, p_notes: note || null, p_idempotency_key: key.current,
      })
      toast(`Payment of ${inr(r.amount)} recorded`)
      setDone({ id: r.payment_id, paid: Number(r.amount), balance: Number(r.balance) })
      onDone()
    } catch (e) { setErr(errMsg(e)) }
    setBusy(false)
  }

  if (done) {
    return (
      <Modal title="Payment recorded" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Done</button>}>
        <div className="stack">
          <div className="summary">
            <div className="line"><span>Received</span><b>{inr(done.paid)}</b></div>
            <div className="line total"><span>{done.balance > 0 ? 'Still pending' : 'Fully paid'}</span><b>{done.balance > 0 ? inr(done.balance) : '✓'}</b></div>
          </div>
          <WaButton label="Send payment confirmation" target={{ member_id: ms.member_id, name: ms.full_name, phone: ms.phone, consent: ms.whatsapp_consent, membership_id: ms.id, payment_id: done.id, amount: done.paid, end_date: ms.end_date, plan: ms.plan_name, kind: 'payment_confirmation' }} />
        </div>
      </Modal>
    )
  }
  return (
    <Modal title="Record payment" onClose={onClose} footer={
      <><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Record payment'}</button></>
    }>
      <div className="stack">
        <div className="summary">
          <div className="line"><span>{ms.full_name} · {ms.member_code}</span><span>{ms.plan_name}</span></div>
          <div className="line"><span>Plan amount</span><span className="num">{inr(ms.final_amount)}</span></div>
          <div className="line"><span>Paid so far</span><span className="num">{inr(ms.amount_paid)}</span></div>
          <div className="line total"><span>Balance</span><span className="num">{inr(bal)}</span></div>
        </div>
        <div className="form-grid">
          <Field label="Amount received (₹)"><input className="input" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))} /></Field>
          <Field label="Payment method">
            <select className="input" value={method} onChange={(e) => setMethod(e.target.value as Method)}>
              {METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
            </select>
          </Field>
          <Field label="Transaction ID (optional)"><input className="input" value={txn} onChange={(e) => setTxn(e.target.value)} /></Field>
          <Field label="Note (optional)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
        <label className="check"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /><span>I have received <b>{inr(amt)}</b> by {METHOD_LABEL[method]}.</span></label>
        {err && <ErrorBox msg={err} />}
      </div>
    </Modal>
  )
}

// ---------- renew ----------
export function RenewModal({ member, expiry, onClose, onDone }: { member: Pick<Member, 'id' | 'full_name' | 'member_code' | 'gender' | 'phone' | 'whatsapp_consent'>; expiry: string | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const keys = useRef({ pay: newKey() })
  const today = todayISO()
  const defStart = expiry && expiry >= today ? addDays(expiry, 1) : today
  const [months, setMonths] = useState<number | null>(null)
  const [start, setStart] = useState(defStart)
  const [discount, setDiscount] = useState('')
  const [mode, setMode] = useState<'none' | 'part' | 'full'>('none')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<Method>('cash')
  const [txn, setTxn] = useState('')
  const [note, setNote] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<null | { id: string; ms: string; pay: string | null; end: string; balance: number; final: number; plan: string }>(null)
  const { plans } = useData()
  const price = usePrice(member.gender, months, Number(discount || 0))
  const minStart = expiry ? addDays(expiry, 1) : undefined

  async function save() {
    setErr(null)
    if (!months) return setErr('Choose the new plan.')
    if (minStart && start < minStart) return setErr(`The new plan must start on or after ${fmtDate(minStart)}, the day after the current one ends.`)
    const pe = validatePay(mode, price.final, amount, confirmed)
    if (pe) return setErr(pe)
    setBusy(true)
    try {
      const r = await rpc<{ membership_id: string; end_date: string; final_amount: number; payment_id: string | null; balance: number }>('renew_membership', {
        p: { member_id: member.id, plan_months: months, start_date: start, discount: Number(discount || 0), payment: paymentPayload(mode, price.final, amount, method, txn, note, keys.current.pay) },
      })
      toast(`${member.full_name} renewed until ${fmtDate(r.end_date)}`)
      setDone({ id: member.id, ms: r.membership_id, pay: r.payment_id, end: r.end_date, balance: Number(r.balance), final: Number(r.final_amount), plan: plans.find((p) => p.months === months)?.name ?? '' })
      onDone()
    } catch (e) { setErr(errMsg(e)) }
    setBusy(false)
  }

  if (done) {
    return (
      <Modal title="Membership renewed" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Done</button>}>
        <div className="stack">
          <div className="summary">
            <div className="line"><span>{member.full_name}</span><b>{done.plan}</b></div>
            <div className="line"><span>New period ends</span><b>{fmtDate(done.end)}</b></div>
            <div className="line total"><span>{done.balance > 0 ? 'Balance to pay' : 'Fully paid'}</span><b>{inr(done.balance > 0 ? done.balance : done.final)}</b></div>
          </div>
          <p className="muted sm-text">The earlier membership and its payments stay in the member’s history.</p>
          {done.pay && <WaButton label="Send payment confirmation" target={{ member_id: member.id, name: member.full_name, phone: member.phone, consent: member.whatsapp_consent, membership_id: done.ms, payment_id: done.pay, amount: done.final - done.balance, end_date: done.end, plan: done.plan, kind: 'payment_confirmation' }} />}
        </div>
      </Modal>
    )
  }
  return (
    <Modal title={`Renew ${member.full_name}`} onClose={onClose} wide footer={
      <><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Confirm renewal'}</button></>
    }>
      <div className="stack">
        <p className="muted">{member.member_code} · {member.gender === 'women' ? 'Women' : 'Men'} pricing{expiry ? ` · current plan ${expiry >= today ? 'ends' : 'ended'} ${fmtDate(expiry)}` : ''}</p>
        <Field label="New plan"><PlanPicker gender={member.gender} value={months} onChange={setMonths} /></Field>
        <div className="form-grid">
          <Field label="New period starts" hint={months ? `Ends ${fmtDate(membershipEnd(start, months))}` : undefined}><input className="input" type="date" min={minStart} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <DiscountField original={price.original} value={discount} onChange={setDiscount} />
        </div>
        <div className="summary" aria-live="polite">
          <div className="line"><span>Plan price</span><span className="num">{months ? inr(price.original) : '—'}</span></div>
          {price.disc > 0 && <div className="line"><span>Discount</span><span className="num">− {inr(price.disc)}</span></div>}
          <div className="line total"><span>Amount to charge</span><span className="num">{months ? inr(price.final) : '—'}</span></div>
        </div>
        <Field label="Payment"><PayBlock final={price.final} mode={mode} setMode={setMode} amount={amount} setAmount={setAmount} method={method} setMethod={setMethod} txn={txn} setTxn={setTxn} note={note} setNote={setNote} confirmed={confirmed} setConfirmed={setConfirmed} /></Field>
        {err && <ErrorBox msg={err} />}
      </div>
    </Modal>
  )
}

// ---------- edit member details ----------
export function EditMemberModal({ m, onClose, onDone }: { m: Member; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [f, setF] = useState({ name: m.full_name, phone: m.phone, gender: m.gender as Gender, age: m.age ? String(m.age) : '', address: m.address ?? '', emergency: m.emergency_contact ?? '', notes: m.notes ?? '', consent: m.whatsapp_consent, joined: m.joined_on })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function save() {
    setErr(null)
    if (f.name.trim().length < 2) return setErr('Enter the member’s full name.')
    if (!validPhone(f.phone)) return setErr('Enter a valid 10 digit mobile number.')
    setBusy(true)
    try {
      must(await supabase.from('members').update({
        full_name: f.name.trim(), phone: f.phone, gender: f.gender, age: f.age ? Number(f.age) : null, address: f.address || null,
        emergency_contact: f.emergency || null, notes: f.notes || null, whatsapp_consent: f.consent, joined_on: f.joined,
      }).eq('id', m.id).select('id').single())
      toast('Member updated'); onDone(); onClose()
    } catch (e) { setErr(errMsg(e)) }
    setBusy(false)
  }
  const genderLocked = useMemo(() => false, [])
  return (
    <Modal title={`Edit ${m.full_name}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button></>}>
      <div className="stack">
        <div className="form-grid">
          <Field label="Full name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Mobile number"><div className="phone-wrap"><span className="cc">+91</span><input className="input" inputMode="numeric" value={f.phone} onChange={(e) => setF({ ...f, phone: cleanPhone(e.target.value) })} /></div></Field>
          <Field label="Gender" hint="Changes the price for future renewals only">
            <div className="seg"><button type="button" disabled={genderLocked} aria-pressed={f.gender === 'men'} onClick={() => setF({ ...f, gender: 'men' })}>Men</button>
              <button type="button" aria-pressed={f.gender === 'women'} onClick={() => setF({ ...f, gender: 'women' })}>Women</button></div>
          </Field>
          <Field label="Joining date"><input className="input" type="date" value={f.joined} onChange={(e) => setF({ ...f, joined: e.target.value })} /></Field>
          <Field label="Age"><input className="input" inputMode="numeric" value={f.age} onChange={(e) => setF({ ...f, age: e.target.value.replace(/\D/g, '').slice(0, 3) })} /></Field>
          <Field label="Emergency contact"><input className="input" value={f.emergency} onChange={(e) => setF({ ...f, emergency: e.target.value })} /></Field>
          <div className="full"><Field label="Address"><input className="input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field></div>
          <div className="full"><Field label="Notes"><textarea className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field></div>
        </div>
        <label className="check"><input type="checkbox" checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} /><span>Member agrees to receive WhatsApp messages.</span></label>
        {err && <ErrorBox msg={err} />}
      </div>
    </Modal>
  )
}

export { addDays }
