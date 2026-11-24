import { useMemo, useState } from 'react'
import { rpc, sendViaApi, errMsg } from '../lib/api'
import { buildMessage, waLink, type MessageKind } from '../lib/messages'
import { KIND_LABEL, showPhone } from '../lib/format'
import { useData } from '../data'
import { Modal, useToast } from './ui'
import { Icon } from './icons'

export interface WaTarget {
  member_id: string
  name: string
  phone: string
  consent: boolean
  membership_id?: string | null
  payment_id?: string | null
  amount?: number
  due_date?: string
  end_date?: string
  plan?: string
  kind: MessageKind
}

const KINDS: MessageKind[] = ['pending_fee', 'overdue', 'expiry', 'renewal', 'payment_confirmation']

export function WhatsAppModal({ target, onClose, onSent }: { target: WaTarget; onClose: () => void; onSent?: () => void }) {
  const { gym, waConfigured } = useData()
  const toast = useToast()
  const [kind, setKind] = useState<MessageKind>(target.kind)
  const [busy, setBusy] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)

  const text = useMemo(
    () => buildMessage(kind, { name: target.name, amount: target.amount, dueDate: target.due_date, endDate: target.end_date, plan: target.plan }, { name: gym.gym_name, address: gym.address }),
    [kind, target, gym],
  )
  const needsPayment = kind === 'payment_confirmation' && !target.payment_id

  async function openChat() {
    // Open first so the browser does not block the pop-up, then write the log.
    window.open(waLink(target.phone, text), '_blank', 'noopener')
    try {
      await rpc('log_manual_whatsapp', { p_member: target.member_id, p_membership: target.membership_id ?? null, p_payment: target.payment_id ?? null, p_kind: kind, p_message: text })
      onSent?.()
    } catch (e) { toast(errMsg(e), 'error') }
  }

  async function sendApi() {
    setBusy(true); setApiError(null)
    try {
      const r = await sendViaApi({ kind, member_id: target.member_id, membership_id: target.membership_id, payment_id: target.payment_id })
      if (r.status === 'sent') { toast('Message sent on WhatsApp'); onSent?.(); onClose() }
      else setApiError(r.error ?? 'WhatsApp did not accept the message.')
    } catch (e) { setApiError(errMsg(e)) }
    setBusy(false)
  }

  return (
    <Modal title={`WhatsApp to ${target.name}`} onClose={onClose} footer={
      <>
        <button className="btn ghost" onClick={onClose}>Close</button>
        {waConfigured && <button className="btn dark" onClick={sendApi} disabled={busy || !target.consent || needsPayment}>{busy ? 'Sending…' : 'Send from gym number'}</button>}
        <button className="btn wa" onClick={openChat} disabled={!target.consent || needsPayment}><Icon name="send" size={18} /> Open WhatsApp</button>
      </>
    }>
      <div className="stack">
        {!target.consent && <div className="notice warn">This member has not agreed to WhatsApp messages. Turn on consent in their profile first.</div>}
        <div className="form-grid">
          <label className="field"><span className="label">Message</span>
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value as MessageKind)}>
              {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
          </label>
          <div className="field"><span className="label">Sending to</span><div className="input" style={{ display: 'flex', alignItems: 'center' }}>{showPhone(target.phone)}</div></div>
        </div>
        {needsPayment && <div className="notice warn">Open this from a payment to send a payment confirmation.</div>}
        <pre style={{ whiteSpace: 'pre-wrap', background: '#e7f7ed', border: '1px solid #b8e3c8', borderRadius: 12, padding: 14, margin: 0, font: 'inherit', fontSize: '.95rem' }}>{text}</pre>
        {apiError && <div className="notice warn">{apiError}</div>}
        {!waConfigured && <p className="muted sm-text">“Open WhatsApp” opens a chat with this message already typed. Press send in WhatsApp. Automatic sending is off until the owner connects the WhatsApp Business API in Settings.</p>}
      </div>
    </Modal>
  )
}

export function WaButton({ target, label = 'WhatsApp', className = 'btn sm wa', onSent }: { target: WaTarget; label?: string; className?: string; onSent?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className={className} onClick={(e) => { e.stopPropagation(); setOpen(true) }} aria-label={`${label} ${target.name}`}><Icon name="chat" size={16} /> {label}</button>
      {open && <WhatsAppModal target={target} onClose={() => setOpen(false)} onSent={onSent} />}
    </>
  )
}
