import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAsync, useDebounced } from '../lib/hooks'
import { fmtDate, fmtDateTime, inr, METHOD_LABEL, monthRangeISO, MONTHS, showPhone } from '../lib/format'
import { downloadCSV } from '../lib/csv'
import type { Membership, Payment } from '../lib/types'
import { Empty, ErrorBox, Loading, Modal, PageHead, PayBadge, SearchBox, Tabs } from '../components/ui'
import { PaymentModal } from '../components/forms'
import { WaButton } from '../components/WhatsAppModal'
import { MemberProfile } from '../components/MemberProfile'
import { Icon } from '../components/icons'

type View = 'unpaid' | 'paid' | 'all' | 'history'

export default function Fees() {
  const [params, setParams] = useSearchParams()
  const [view, setView] = useState<View>(params.get('filter') === 'pending' ? 'unpaid' : 'unpaid')
  const [q, setQ] = useState('')
  const dq = useDebounced(q.trim().replace(/[,()%*]/g, ' '), 250)
  const [pay, setPay] = useState<Membership | null>(null)
  const [picker, setPicker] = useState(params.get('pay') === '1')
  const [openId, setOpenId] = useState<string | null>(null)
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)

  const fees = useAsync(async () => {
    if (view === 'history') return [] as Membership[]
    let query = supabase.from('v_memberships').select('*').is('archived_at', null).neq('pay_status', 'cancelled')
    if (view === 'unpaid') query = query.in('pay_status', ['pending', 'partial', 'overdue'])
    if (view === 'paid') query = query.eq('pay_status', 'paid')
    if (dq) query = query.or(`full_name.ilike.%${dq}%,phone.ilike.%${dq}%,member_code.ilike.%${dq}%`)
    const r = await query.order('due_date', { ascending: true }).limit(500)
    if (r.error) throw new Error(r.error.message)
    return r.data as Membership[]
  }, [view, dq])

  const history = useAsync(async () => {
    if (view !== 'history') return [] as Payment[]
    const { from, to } = monthRangeISO(year, month)
    let query = supabase.from('payments').select('*, members(full_name, member_code, phone), memberships(plan_name)').gte('paid_at', from).lt('paid_at', to)
    const r = await query.order('paid_at', { ascending: false }).limit(1000)
    if (r.error) throw new Error(r.error.message)
    let rows = r.data as Payment[]
    if (dq) {
      const s = dq.toLowerCase()
      rows = rows.filter((p) => `${p.members?.full_name} ${p.members?.phone} ${p.members?.member_code}`.toLowerCase().includes(s))
    }
    return rows
  }, [view, year, month, dq])

  const reloadAll = () => { fees.reload(); history.reload() }
  const rows = fees.data ?? []
  const totalPaid = rows.reduce((a, r) => a + Number(r.amount_paid), 0)
  const totalOut = rows.filter((r) => r.pay_status !== 'paid').reduce((a, r) => a + Number(r.balance), 0)
  const hist = history.data ?? []
  const histTotal = hist.filter((p) => !p.voided_at).reduce((a, p) => a + Number(p.amount), 0)
  const byMethod = hist.filter((p) => !p.voided_at).reduce<Record<string, number>>((a, p) => ({ ...a, [p.method]: (a[p.method] ?? 0) + Number(p.amount) }), {})

  const years = Array.from({ length: 6 }, (_, i) => now.getFullYear() - i)

  return (
    <>
      <PageHead title="Fee management" sub="Who has paid, who owes, and every payment on record."
        actions={<button className="btn primary" onClick={() => setPicker(true)}><Icon name="rupee" size={18} /> Record payment</button>} />

      <Tabs value={view} onChange={(v) => { setView(v); setParams({}) }} items={[
        { id: 'unpaid', label: 'Pending fees' }, { id: 'paid', label: 'Paid' }, { id: 'all', label: 'All fees' }, { id: 'history', label: 'Payment history' },
      ]} />

      <div className="row wrap" style={{ marginBottom: 14 }}>
        <SearchBox value={q} onChange={setQ} placeholder="Search by name, mobile or member ID" />
        {view === 'history' && (
          <>
            <select className="input" style={{ width: 'auto' }} value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="Month">
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
            <select className="input" style={{ width: 'auto' }} value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">
              {years.map((y) => <option key={y}>{y}</option>)}
            </select>
            <button className="btn" disabled={!hist.length} onClick={() => downloadCSV(`payments-${year}-${String(month).padStart(2, '0')}.csv`, [
              ['Date', 'Member ID', 'Name', 'Mobile', 'Plan', 'Method', 'Amount', 'Transaction ID', 'Note', 'Voided'],
              ...hist.map((p) => [fmtDateTime(p.paid_at), p.members?.member_code, p.members?.full_name, p.members?.phone, p.memberships?.plan_name, METHOD_LABEL[p.method], p.amount, p.transaction_id, p.notes, p.voided_at ? `Voided: ${p.void_reason}` : '']),
            ])}><Icon name="download" size={18} /> CSV</button>
          </>
        )}
      </div>

      {view !== 'history' ? (
        <>
          <div className="grid3" style={{ marginBottom: 14 }}>
            <div className="stat" style={{ ['--c' as string]: 'var(--green)', ['--fill' as string]: '60%' }}><div className="k">Collected on these fees</div><div className="v">{inr(totalPaid)}</div></div>
            <div className="stat" style={{ ['--c' as string]: 'var(--red)', ['--fill' as string]: '60%' }}><div className="k">Outstanding</div><div className="v">{inr(totalOut)}</div></div>
            <div className="stat"><div className="k">Fee records shown</div><div className="v">{rows.length}</div></div>
          </div>
          <div className="card flush">
            {fees.error ? <div style={{ padding: 16 }}><ErrorBox msg={fees.error} retry={fees.reload} /></div>
              : fees.loading && !fees.data ? <Loading />
              : !rows.length ? <Empty title={view === 'unpaid' ? 'No pending fees' : 'Nothing to show'} hint={dq ? 'No fee record matches your search.' : view === 'unpaid' ? 'Every member who owes money will appear here.' : undefined} />
              : (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Member</th><th>Mobile</th><th>Plan</th><th className="right">Amount due</th><th className="right">Paid</th><th>Status</th><th>Due date</th><th>Last payment</th><th /></tr></thead>
                    <tbody>
                      {rows.map((x) => (
                        <tr key={x.id}>
                          <td><b><button className="linkbtn" style={{ padding: 0, color: 'inherit' }} onClick={() => setOpenId(x.member_id)}>{x.full_name}</button></b><span className="sub">{x.member_code}</span></td>
                          <td className="num">{showPhone(x.phone)}</td>
                          <td>{x.plan_name}<span className="sub">{fmtDate(x.start_date)} to {fmtDate(x.end_date)}</span></td>
                          <td className="right num">{inr(x.final_amount)}{Number(x.balance) > 0 && Number(x.amount_paid) > 0 && <span className="sub">{inr(x.balance)} left</span>}</td>
                          <td className="right num">{inr(x.amount_paid)}</td>
                          <td><PayBadge s={x.pay_status} /></td>
                          <td>{fmtDate(x.due_date)}</td>
                          <td>{x.last_paid_at ? fmtDate(x.last_paid_at.slice(0, 10)) : '—'}</td>
                          <td className="actions">
                            {x.pay_status !== 'paid' && <button className="btn sm primary" onClick={() => setPay(x)}>Record payment</button>}{' '}
                            <WaButton label="" onSent={reloadAll} target={{ member_id: x.member_id, name: x.full_name, phone: x.phone, consent: x.whatsapp_consent, membership_id: x.id, amount: Number(x.balance), due_date: x.due_date, end_date: x.end_date, plan: x.plan_name, kind: x.pay_status === 'overdue' ? 'overdue' : x.pay_status === 'paid' ? 'expiry' : 'pending_fee' }} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </div>
        </>
      ) : (
        <>
          <div className="grid3" style={{ marginBottom: 14 }}>
            <div className="stat" style={{ ['--c' as string]: 'var(--green)', ['--fill' as string]: '70%' }}><div className="k">Collected in {MONTHS[month - 1]} {year}</div><div className="v">{inr(histTotal)}</div></div>
            <div className="stat"><div className="k">Payments</div><div className="v">{hist.filter((p) => !p.voided_at).length}</div></div>
            <div className="stat"><div className="k">By method</div><div className="s" style={{ fontSize: '.9rem', color: 'var(--text)' }}>{Object.keys(byMethod).length ? Object.entries(byMethod).map(([k, v]) => `${METHOD_LABEL[k as keyof typeof METHOD_LABEL]} ${inr(v)}`).join(' · ') : '—'}</div></div>
          </div>
          <div className="card flush">
            {history.error ? <div style={{ padding: 16 }}><ErrorBox msg={history.error} retry={history.reload} /></div>
              : history.loading && !history.data ? <Loading />
              : !hist.length ? <Empty title="No payments in this month" />
              : (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Date and time</th><th>Member</th><th>Plan</th><th>Method</th><th className="right">Amount</th></tr></thead>
                    <tbody>
                      {hist.map((p) => (
                        <tr key={p.id} style={p.voided_at ? { opacity: .55 } : undefined}>
                          <td>{fmtDateTime(p.paid_at)}{p.transaction_id && <span className="sub">Txn {p.transaction_id}</span>}</td>
                          <td><b>{p.members?.full_name}</b><span className="sub">{p.members?.member_code}</span></td>
                          <td>{p.memberships?.plan_name}</td>
                          <td>{METHOD_LABEL[p.method]}</td>
                          <td className="right num">{p.voided_at ? <s>{inr(p.amount)}</s> : inr(p.amount)}{p.voided_at && <span className="sub">Voided</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </div>
        </>
      )}

      {pay && <PaymentModal ms={pay} onClose={() => setPay(null)} onDone={reloadAll} />}
      {picker && <PickMember onClose={() => { setPicker(false); setParams({}) }} onPick={(m) => { setPicker(false); setParams({}); setPay(m) }} />}
      {openId && <MemberProfile memberId={openId} onClose={() => setOpenId(null)} onChanged={reloadAll} />}
    </>
  )
}

function PickMember({ onClose, onPick }: { onClose: () => void; onPick: (m: Membership) => void }) {
  const [q, setQ] = useState('')
  const dq = useDebounced(q.trim().replace(/[,()%*]/g, ' '), 200)
  const { data, loading, error } = useAsync(async () => {
    let query = supabase.from('v_memberships').select('*').is('archived_at', null).in('pay_status', ['pending', 'partial', 'overdue'])
    if (dq) query = query.or(`full_name.ilike.%${dq}%,phone.ilike.%${dq}%,member_code.ilike.%${dq}%`)
    const r = await query.order('due_date').limit(30)
    if (r.error) throw new Error(r.error.message)
    return r.data as Membership[]
  }, [dq])
  return (
    <Modal title="Record payment for…" onClose={onClose}>
      <div className="stack">
        <SearchBox value={q} onChange={setQ} placeholder="Search by name, mobile or member ID" />
        {error ? <ErrorBox msg={error} /> : loading && !data ? <Loading /> : !data?.length ? <Empty title="No member with a balance found" hint="Only memberships with money still due are listed. To collect for a new plan, renew or register the member first." /> : (
          <div className="list">
            {data.map((x) => (
              <button key={x.id} className="item" style={{ background: 'none', border: 0, borderBottom: '1px solid #eceef1', textAlign: 'left', cursor: 'pointer', minHeight: 56 }} onClick={() => onPick(x)}>
                <div className="who"><b>{x.full_name}</b><span>{x.member_code} · {x.plan_name}</span></div>
                <div style={{ textAlign: 'right' }}><b className="num">{inr(x.balance)}</b><br /><PayBadge s={x.pay_status} /></div>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
