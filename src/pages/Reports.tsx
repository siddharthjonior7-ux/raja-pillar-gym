import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { rpc } from '../lib/api'
import { useAsync } from '../lib/hooks'
import { fmtDate, fmtDateTime, inr, METHOD_LABEL, monthRangeISO, MONTHS } from '../lib/format'
import { downloadCSV } from '../lib/csv'
import type { Member, Payment } from '../lib/types'
import { ErrorBox, Loading, PageHead, useToast } from '../components/ui'
import { Icon } from '../components/icons'

interface Summary {
  registered: number; active: number; expired: number; new_registrations: number; revenue: number
  outstanding_total: number; discounts_total: number; by_method: Record<string, number>; plans: { plan: string; memberships: number; billed: number }[]
}

export default function Reports() {
  const now = new Date()
  const toast = useToast()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const years = Array.from({ length: 6 }, (_, i) => now.getFullYear() - i)

  const { data, loading, error, reload } = useAsync(async () => {
    const [s, rev] = await Promise.all([
      rpc<Summary>('reports_summary', { p_year: year, p_month: month }),
      rpc<{ month: number; collected: number; payments: number }[]>('revenue_by_month', { p_year: year }),
    ])
    return { s, rev }
  }, [year, month])

  async function exportPayments() {
    const { from, to } = monthRangeISO(year, month)
    const r = await supabase.from('payments').select('*, members(full_name, member_code, phone), memberships(plan_name)').gte('paid_at', from).lt('paid_at', to).order('paid_at')
    if (r.error) return toast(r.error.message, 'error')
    const rows = r.data as Payment[]
    downloadCSV(`payments-${year}-${String(month).padStart(2, '0')}.csv`, [
      ['Date', 'Member ID', 'Name', 'Mobile', 'Plan', 'Method', 'Amount', 'Transaction ID', 'Note', 'Voided'],
      ...rows.map((p) => [fmtDateTime(p.paid_at), p.members?.member_code, p.members?.full_name, p.members?.phone, p.memberships?.plan_name, METHOD_LABEL[p.method], p.amount, p.transaction_id, p.notes, p.voided_at ? `Voided: ${p.void_reason}` : '']),
    ])
  }
  async function exportMembers() {
    const r = await supabase.from('v_members').select('*').order('member_code')
    if (r.error) return toast(r.error.message, 'error')
    downloadCSV('members.csv', [
      ['Member ID', 'Name', 'Mobile', 'Gender', 'Joined', 'Plan', 'Expiry', 'Membership', 'Fee status', 'Outstanding', 'Archived'],
      ...(r.data as Member[]).map((m) => [m.member_code, m.full_name, m.phone, m.gender, fmtDate(m.joined_on), m.latest_plan, fmtDate(m.expiry_date), m.membership_status, m.fee_status, m.outstanding, m.archived_at ? 'Yes' : '']),
    ])
  }

  if (error) return <ErrorBox msg={error} retry={reload} />
  const s = data?.s
  const rev = data?.rev ?? []
  const maxRev = Math.max(1, ...rev.map((r) => Number(r.collected)))
  const maxPlan = Math.max(1, ...(s?.plans ?? []).map((p) => p.memberships))
  const methods = Object.entries(s?.by_method ?? {})
  const methodTotal = methods.reduce((a, [, v]) => a + Number(v), 0)

  return (
    <>
      <PageHead title="Reports" sub="Revenue is counted from payments actually received, never from plan prices."
        actions={<>
          <select className="input" style={{ width: 'auto' }} value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="Month">{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
          <select className="input" style={{ width: 'auto' }} value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">{years.map((y) => <option key={y}>{y}</option>)}</select>
        </>} />
      {loading && !data ? <Loading /> : s && (
        <>
          <div className="stats" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
            <div className="stat"><div className="k">Registered members</div><div className="v">{s.registered}</div></div>
            <div className="stat" style={{ ['--c' as string]: 'var(--green)' }}><div className="k">Active</div><div className="v">{s.active}</div></div>
            <div className="stat" style={{ ['--c' as string]: '#7b828d' }}><div className="k">Expired</div><div className="v">{s.expired}</div></div>
            <div className="stat"><div className="k">New in {MONTHS[month - 1]}</div><div className="v">{s.new_registrations}</div></div>
            <div className="stat" style={{ ['--c' as string]: 'var(--green)', ['--fill' as string]: '80%' }}><div className="k">Revenue in {MONTHS[month - 1]}</div><div className="v">{inr(s.revenue)}</div></div>
            <div className="stat" style={{ ['--c' as string]: 'var(--red)', ['--fill' as string]: '60%' }}><div className="k">Total outstanding</div><div className="v">{inr(s.outstanding_total)}</div><div className="s">All unpaid balances</div></div>
            <div className="stat"><div className="k">Discounts given</div><div className="v">{inr(s.discounts_total)}</div><div className="s">Plans started in {MONTHS[month - 1]}</div></div>
          </div>

          <section className="card" style={{ marginBottom: 16 }}>
            <div className="card-head"><h2>Revenue {year}</h2></div>
            <div className="bars" role="img" aria-label={`Revenue collected each month of ${year}`}>
              {rev.map((r) => (
                <div key={r.month} className={`bar ${r.month === month ? 'cur' : ''}`}>
                  <em>{Number(r.collected) > 0 ? (Number(r.collected) >= 1000 ? Math.round(Number(r.collected) / 100) / 10 + 'k' : r.collected) : ''}</em>
                  <i style={{ height: `${(Number(r.collected) / maxRev) * 100}%` }} /><span>{MONTHS[r.month - 1].slice(0, 3)}</span>
                </div>
              ))}
            </div>
          </section>

          <div className="two-col">
            <section className="card">
              <div className="card-head"><h2>Payment methods</h2></div>
              {!methods.length ? <p className="muted">No payments in {MONTHS[month - 1]}.</p> : (
                <div className="stack">{methods.map(([k, v]) => (
                  <div key={k}><div className="row between"><span>{METHOD_LABEL[k as keyof typeof METHOD_LABEL]}</span><b className="num">{inr(v)}</b></div>
                    <div className="hbar"><i style={{ width: `${(Number(v) / Math.max(1, methodTotal)) * 100}%` }} /></div></div>
                ))}</div>
              )}
            </section>
            <section className="card">
              <div className="card-head"><h2>Plan popularity</h2></div>
              {!s.plans.length ? <p className="muted">No plans started in {MONTHS[month - 1]}.</p> : (
                <div className="stack">{s.plans.map((p) => (
                  <div key={p.plan}><div className="row between"><span>{p.plan}</span><span className="num"><b>{p.memberships}</b> · {inr(p.billed)} billed</span></div>
                    <div className="hbar"><i style={{ width: `${(p.memberships / maxPlan) * 100}%` }} /></div></div>
                ))}</div>
              )}
            </section>
          </div>

          <section className="card" style={{ marginTop: 16 }}>
            <div className="card-head"><h2>Export</h2></div>
            <div className="row wrap">
              <button className="btn" onClick={exportPayments}><Icon name="download" size={18} /> Payments for {MONTHS[month - 1]} {year}</button>
              <button className="btn" onClick={exportMembers}><Icon name="download" size={18} /> All members</button>
            </div>
            <p className="muted sm-text" style={{ marginTop: 10 }}>CSV files open directly in Excel.</p>
          </section>
        </>
      )}
    </>
  )
}
