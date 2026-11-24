import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { must, rpc } from '../lib/api'
import { useAsync } from '../lib/hooks'
import { daysText, fmtDate, inr, METHOD_LABEL, MONTHS, plural } from '../lib/format'
import type { DashStats, Member, Membership, Payment } from '../lib/types'
import { Empty, ErrorBox, Loading, PageHead, PayBadge } from '../components/ui'
import { Icon } from '../components/icons'
import { WaButton } from '../components/WhatsAppModal'
import { MemberProfile } from '../components/MemberProfile'
import { useData } from '../data'

function Stat({ k, v, s, color, fill }: { k: string; v: string | number; s?: string; color?: string; fill?: number }) {
  return (
    <div className="stat" style={{ ['--c' as string]: color, ['--fill' as string]: `${Math.max(8, Math.min(100, fill ?? 30))}%` }}>
      <div className="k">{k}</div><div className="v">{v}</div>{s && <div className="s">{s}</div>}
    </div>
  )
}

export default function Dashboard() {
  const nav = useNavigate()
  const { isOwner, gym } = useData()
  const [openId, setOpenId] = useState<string | null>(null)
  const year = new Date().getFullYear()

  const { data, loading, error, reload } = useAsync(async () => {
    const [stats, recent, unpaid, exp, pays, rev] = await Promise.all([
      rpc<DashStats>('dashboard_stats'),
      supabase.from('v_members').select('*').is('archived_at', null).order('created_at', { ascending: false }).limit(5),
      supabase.from('v_memberships').select('*').is('archived_at', null).in('pay_status', ['pending', 'partial', 'overdue']).order('due_date').limit(6),
      supabase.from('v_memberships').select('*').is('archived_at', null).eq('membership_status', 'active').eq('is_latest', true).lte('days_left', 30).order('end_date'),
      supabase.from('payments').select('*, members(full_name, member_code, phone)').is('voided_at', null).order('paid_at', { ascending: false }).limit(6),
      isOwner ? rpc<{ month: number; collected: number }[]>('revenue_by_month', { p_year: year }) : Promise.resolve(null),
    ])
    return {
      stats, recent: must(recent) as Member[], unpaid: must(unpaid) as Membership[],
      exp: must(exp) as Membership[], pays: must(pays) as Payment[], rev,
    }
  }, [])

  if (error) return <ErrorBox msg={error} retry={reload} />
  if (loading && !data) return <Loading />
  const { stats: s, recent, unpaid, exp, pays, rev } = data!
  const exp7 = exp.filter((x) => x.days_left <= 7)
  const exp30 = exp.filter((x) => x.days_left > 7)
  const total = Math.max(1, s.total_members)
  const maxRev = Math.max(1, ...(rev ?? []).map((r) => Number(r.collected)))
  const curMonth = new Date().getMonth() + 1

  return (
    <>
      <PageHead title="Dashboard" sub={`${gym.gym_name}, today’s picture.`} />

      <div className="stats">
        <Stat k="Registered members" v={s.total_members} s={`${s.new_this_month} new this month`} fill={100} />
        <Stat k="Active memberships" v={s.active_members} s="Membership is valid today" color="var(--green)" fill={(s.active_members / total) * 100} />
        <Stat k="Expired memberships" v={s.expired_members} s="Plan has ended" color="#7b828d" fill={(s.expired_members / total) * 100} />
        <Stat k="Fees paid this month" v={inr(s.paid_this_month)} s={plural(Number(s.payments_this_month), 'payment')} color="var(--green)" fill={(Number(s.paid_this_month) / Math.max(1, Number(s.total_collection))) * 100} />
        <Stat k="Fees pending" v={inr(s.pending_total)} s={`${plural(Number(s.pending_members), 'member')} owe fees`} color="var(--red)" fill={(Number(s.pending_total) / Math.max(1, Number(s.total_collection))) * 100} />
        <Stat k="Total collection" v={inr(s.total_collection)} s="Paid plus pending" color="var(--ink-3)" fill={100} />
      </div>

      <div className="quick">
        <button className="btn primary" onClick={() => nav('/members?add=1')}><Icon name="plus" size={18} /> Add new member</button>
        <button className="btn dark" onClick={() => nav('/fees?pay=1')}><Icon name="rupee" size={18} /> Record payment</button>
        <button className="btn" onClick={() => nav('/fees?filter=pending')}><Icon name="alert" size={18} /> View pending fees</button>
        <button className="btn" onClick={() => nav('/members')}><Icon name="users" size={18} /> View all members</button>
      </div>

      <div className="two-col">
        <section className="card">
          <div className="card-head"><h2>Members with unpaid fees</h2><Link to="/fees?filter=pending">See all</Link></div>
          {unpaid.length === 0 ? <Empty title="All fees are paid" hint="No pending balances right now." /> : (
            <div className="list">
              {unpaid.map((x) => (
                <div className="item" key={x.id}>
                  <div className="who"><b><button className="linkbtn" style={{ padding: 0, color: 'inherit' }} onClick={() => setOpenId(x.member_id)}>{x.full_name}</button></b><span>{x.plan_name} · due {fmtDate(x.due_date)}</span></div>
                  <div className="row"><div style={{ textAlign: 'right' }}><b className="num">{inr(x.balance)}</b><br /><PayBadge s={x.pay_status} /></div>
                    <WaButton label="" className="btn sm wa" onSent={reload} target={{ member_id: x.member_id, name: x.full_name, phone: x.phone, consent: x.whatsapp_consent, membership_id: x.id, amount: Number(x.balance), due_date: x.due_date, end_date: x.end_date, plan: x.plan_name, kind: x.pay_status === 'overdue' ? 'overdue' : 'pending_fee' }} /></div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-head"><h2>Expiring in 7 days</h2><span className="badge pending">{exp7.length}</span></div>
          {exp7.length === 0 ? <Empty title="Nobody expiring this week" /> : (
            <div className="list">
              {exp7.map((x) => (
                <div className="item" key={x.id}>
                  <div className="who"><b><button className="linkbtn" style={{ padding: 0, color: 'inherit' }} onClick={() => setOpenId(x.member_id)}>{x.full_name}</button></b><span>{x.plan_name} · {fmtDate(x.end_date)} ({daysText(x.days_left)})</span></div>
                  <WaButton label="" className="btn sm wa" onSent={reload} target={{ member_id: x.member_id, name: x.full_name, phone: x.phone, consent: x.whatsapp_consent, membership_id: x.id, end_date: x.end_date, plan: x.plan_name, kind: 'expiry' }} />
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="two-col">
        <section className="card">
          <div className="card-head"><h2>Expiring in 30 days</h2><span className="badge partial">{exp30.length}</span></div>
          {exp30.length === 0 ? <Empty title="Nobody else expiring this month" /> : (
            <div className="list">
              {exp30.slice(0, 6).map((x) => (
                <div className="item" key={x.id}>
                  <div className="who"><b>{x.full_name}</b><span>{x.plan_name} · ends {fmtDate(x.end_date)}</span></div>
                  <span className="muted sm-text">{daysText(x.days_left)}</span>
                </div>
              ))}
              {exp30.length > 6 && <Link to="/renewals" className="sm-text" style={{ paddingTop: 10 }}>See all {exp30.length} in Renewals</Link>}
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-head"><h2>Recently registered</h2><Link to="/members">All members</Link></div>
          {recent.length === 0 ? <Empty title="No members yet" hint="Use Add new member to register the first one." /> : (
            <div className="list">
              {recent.map((x) => (
                <div className="item" key={x.id}>
                  <div className="who"><b><button className="linkbtn" style={{ padding: 0, color: 'inherit' }} onClick={() => setOpenId(x.id)}>{x.full_name}</button></b><span>{x.member_code} · joined {fmtDate(x.joined_on)}</span></div>
                  <span className="muted sm-text">{x.latest_plan}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="two-col">
        <section className="card">
          <div className="card-head"><h2>Recent payments</h2></div>
          {pays.length === 0 ? <Empty title="No payments yet" /> : (
            <div className="list">
              {pays.map((p) => (
                <div className="item" key={p.id}>
                  <div className="who"><b>{p.members?.full_name}</b><span>{METHOD_LABEL[p.method]} · {fmtDate(p.paid_at.slice(0, 10))}</span></div>
                  <b className="num">{inr(p.amount)}</b>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-head"><h2>Monthly revenue {isOwner ? year : ''}</h2></div>
          {isOwner && rev ? (
            <div className="bars" role="img" aria-label="Revenue collected each month">
              {rev.map((r) => (
                <div key={r.month} className={`bar ${r.month === curMonth ? 'cur' : ''}`}>
                  <em>{Number(r.collected) > 0 ? (Number(r.collected) >= 1000 ? Math.round(Number(r.collected) / 100) / 10 + 'k' : r.collected) : ''}</em>
                  <i style={{ height: `${(Number(r.collected) / maxRev) * 100}%` }} /><span>{MONTHS[r.month - 1].slice(0, 3)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="stack"><div className="stat" style={{ ['--fill' as string]: '70%', ['--c' as string]: 'var(--green)' }}><div className="k">Collected this month</div><div className="v">{inr(s.paid_this_month)}</div></div>
              <p className="muted sm-text">The yearly chart is visible to the owner.</p></div>
          )}
        </section>
      </div>

      {openId && <MemberProfile memberId={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
    </>
  )
}
