import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/hooks'
import { daysText, fmtDate, fmtDateTime, inr, KIND_LABEL, showPhone } from '../lib/format'
import type { Membership, WaLog } from '../lib/types'
import { Empty, ErrorBox, Loading, PageHead, Tabs } from '../components/ui'
import { WaButton } from '../components/WhatsAppModal'
import { PayBadge } from '../components/ui'
import { useData } from '../data'

type Tab = 'overdue' | 'pending' | 'expiring' | 'expired' | 'log'
const LOG_LABEL: Record<string, string> = { sent: 'Sent', failed: 'Failed', pending: 'Sending', manual_opened: 'Opened in WhatsApp' }

export default function WhatsApp() {
  const { waConfigured, isOwner } = useData()
  const [tab, setTab] = useState<Tab>('overdue')
  const [status, setStatus] = useState('all')

  const { data, loading, error, reload } = useAsync(async () => {
    const [ms, logs] = await Promise.all([
      supabase.from('v_memberships').select('*').is('archived_at', null).eq('is_latest', true).neq('membership_status', 'cancelled').limit(1000),
      supabase.from('whatsapp_logs').select('*, members(full_name, member_code)').order('created_at', { ascending: false }).limit(200),
    ])
    if (ms.error) throw new Error(ms.error.message)
    if (logs.error) throw new Error(logs.error.message)
    return { ms: ms.data as Membership[], logs: logs.data as WaLog[] }
  }, [])

  const ms = data?.ms ?? []
  const lists: Record<Exclude<Tab, 'log'>, Membership[]> = {
    overdue: ms.filter((x) => x.pay_status === 'overdue'),
    pending: ms.filter((x) => x.pay_status === 'pending' || x.pay_status === 'partial'),
    expiring: ms.filter((x) => x.membership_status === 'active' && x.days_left <= 7),
    expired: ms.filter((x) => x.membership_status === 'expired' && x.days_left >= -30),
  }
  const kindFor: Record<Exclude<Tab, 'log'>, 'overdue' | 'pending_fee' | 'expiry' | 'renewal'> = { overdue: 'overdue', pending: 'pending_fee', expiring: 'expiry', expired: 'renewal' }
  const logs = (data?.logs ?? []).filter((l) => status === 'all' || l.status === status)

  return (
    <>
      <PageHead title="WhatsApp notifications" sub="Send reminders and see every message that was sent or opened." />

      <div className={`notice ${waConfigured ? '' : 'warn'}`} style={{ marginBottom: 16 }}>
        {waConfigured
          ? <>WhatsApp Business API is connected. Use “Send from gym number” to send from the gym’s WhatsApp number. “Open WhatsApp” also works any time.</>
          : <>WhatsApp Business API is <b>not connected</b>, so nothing is sent automatically. “Open WhatsApp” opens a chat with the message ready and you press send.{isOwner && <> To connect it, see <Link to="/settings?tab=whatsapp">Settings, WhatsApp</Link>.</>}</>}
      </div>

      <Tabs value={tab} onChange={setTab} items={[
        { id: 'overdue', label: 'Overdue fees', count: lists.overdue.length }, { id: 'pending', label: 'Pending fees', count: lists.pending.length },
        { id: 'expiring', label: 'Expiring soon', count: lists.expiring.length }, { id: 'expired', label: 'Recently expired', count: lists.expired.length }, { id: 'log', label: 'Message log' },
      ]} />

      <div className="card flush">
        {error ? <div style={{ padding: 16 }}><ErrorBox msg={error} retry={reload} /></div> : loading && !data ? <Loading /> : tab === 'log' ? (
          <>
            <div className="row" style={{ padding: 14 }}>
              <select className="input" style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
                <option value="all">All messages</option><option value="sent">Sent</option><option value="failed">Failed</option><option value="pending">Sending</option><option value="manual_opened">Opened in WhatsApp</option>
              </select>
              <span className="muted sm-text">Opened in WhatsApp means the chat was opened. WhatsApp does not tell us whether it was then sent.</span>
            </div>
            {!logs.length ? <Empty title="No messages yet" hint="Reminders you send will be listed here." /> : (
              <div className="table-wrap"><table>
                <thead><tr><th>When</th><th>Member</th><th>Message</th><th>How</th><th>Status</th></tr></thead>
                <tbody>{logs.map((l) => (
                  <tr key={l.id}>
                    <td>{fmtDateTime(l.created_at)}</td>
                    <td><b>{l.members?.full_name ?? '—'}</b><span className="sub">{showPhone(l.phone)}</span></td>
                    <td>{KIND_LABEL[l.kind] ?? l.kind}{l.error && <span className="sub" style={{ color: 'var(--red)' }}>{l.error}</span>}</td>
                    <td>{l.channel === 'api' ? 'Gym number (API)' : 'Click to chat'}</td>
                    <td><span className={`badge ${l.status === 'pending' ? 'api_pending' : l.status}`}>{LOG_LABEL[l.status]}</span></td>
                  </tr>
                ))}</tbody></table></div>
            )}
          </>
        ) : !lists[tab].length ? <Empty title="Nobody to remind here" hint="Members who need this reminder will appear here." /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Member</th><th>Mobile</th><th>Plan</th><th className="right">Balance</th><th>Fee</th><th>{tab === 'expired' ? 'Ended' : 'Ends'}</th><th /></tr></thead>
            <tbody>{lists[tab].map((x) => (
              <tr key={x.id}>
                <td><b>{x.full_name}</b><span className="sub">{x.member_code}</span></td>
                <td className="num">{showPhone(x.phone)}</td>
                <td>{x.plan_name}</td>
                <td className="right num">{Number(x.balance) > 0 ? inr(x.balance) : '—'}</td>
                <td><PayBadge s={x.pay_status} /></td>
                <td>{fmtDate(x.end_date)}<span className="sub">{daysText(x.days_left)}</span></td>
                <td className="actions"><WaButton label="Send reminder" onSent={reload} target={{ member_id: x.member_id, name: x.full_name, phone: x.phone, consent: x.whatsapp_consent, membership_id: x.id, amount: Number(x.balance), due_date: x.due_date, end_date: x.end_date, plan: x.plan_name, kind: kindFor[tab] }} /></td>
              </tr>
            ))}</tbody></table></div>
        )}
      </div>
    </>
  )
}
