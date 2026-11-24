import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/hooks'
import { daysText, fmtDate, inr, showPhone } from '../lib/format'
import type { Member, Membership } from '../lib/types'
import { Empty, ErrorBox, Loading, PageHead, PayBadge, SearchBox, Tabs } from '../components/ui'
import { RenewModal } from '../components/forms'
import { WaButton } from '../components/WhatsAppModal'

type Tab = 'd7' | 'd30' | 'active' | 'expired' | 'history'

export default function Renewals() {
  const [tab, setTab] = useState<Tab>('d7')
  const [q, setQ] = useState('')
  const [renew, setRenew] = useState<Membership | null>(null)

  const { data, loading, error, reload } = useAsync(async () => {
    const [cur, hist] = await Promise.all([
      supabase.from('v_memberships').select('*').is('archived_at', null).eq('is_latest', true).neq('membership_status', 'cancelled').order('end_date').limit(1000),
      supabase.from('v_memberships').select('*').eq('kind', 'renewal').order('created_at', { ascending: false }).limit(25),
    ])
    if (cur.error) throw new Error(cur.error.message)
    if (hist.error) throw new Error(hist.error.message)
    return { cur: cur.data as Membership[], hist: hist.data as Membership[] }
  }, [])

  const all = data?.cur ?? []
  const lists: Record<Exclude<Tab, 'history'>, Membership[]> = {
    d7: all.filter((x) => x.membership_status === 'active' && x.days_left <= 7),
    d30: all.filter((x) => x.membership_status === 'active' && x.days_left > 7 && x.days_left <= 30),
    active: all.filter((x) => x.membership_status === 'active'),
    expired: all.filter((x) => x.membership_status === 'expired').sort((a, b) => (a.end_date < b.end_date ? 1 : -1)),
  }
  const s = q.trim().toLowerCase()
  const shown = tab === 'history' ? [] : lists[tab].filter((x) => !s || `${x.full_name} ${x.phone} ${x.member_code}`.toLowerCase().includes(s))

  const asMember = (x: Membership): Pick<Member, 'id' | 'full_name' | 'member_code' | 'gender' | 'phone' | 'whatsapp_consent'> =>
    ({ id: x.member_id, full_name: x.full_name, member_code: x.member_code, gender: x.gender, phone: x.phone, whatsapp_consent: x.whatsapp_consent })

  return (
    <>
      <PageHead title="Renewals" sub="Renewing adds a new membership. The old plan and its payments stay in the member’s history." />
      <Tabs value={tab} onChange={setTab} items={[
        { id: 'd7', label: 'Expiring in 7 days', count: lists.d7.length }, { id: 'd30', label: 'Expiring in 30 days', count: lists.d30.length },
        { id: 'active', label: 'Active', count: lists.active.length }, { id: 'expired', label: 'Expired', count: lists.expired.length }, { id: 'history', label: 'Renewal history' },
      ]} />
      {tab !== 'history' && <div className="row" style={{ marginBottom: 14 }}><SearchBox value={q} onChange={setQ} placeholder="Search by name, mobile or member ID" /></div>}

      <div className="card flush">
        {error ? <div style={{ padding: 16 }}><ErrorBox msg={error} retry={reload} /></div> : loading && !data ? <Loading /> : tab === 'history' ? (
          !data?.hist.length ? <Empty title="No renewals yet" hint="Renewals you record will be listed here." /> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Member</th><th>New plan</th><th>New period</th><th className="right">Amount</th><th>Payment</th></tr></thead>
              <tbody>{data.hist.map((x) => (
                <tr key={x.id}><td><b>{x.full_name}</b><span className="sub">{x.member_code}</span></td><td>{x.plan_name}</td>
                  <td>{fmtDate(x.start_date)} to {fmtDate(x.end_date)}</td><td className="right num">{inr(x.final_amount)}</td><td><PayBadge s={x.pay_status} /></td></tr>
              ))}</tbody></table></div>
          )
        ) : !shown.length ? (
          <Empty title={s ? 'No member matches your search' : tab === 'expired' ? 'No expired memberships' : 'Nobody here right now'} />
        ) : (
          <div className="table-wrap"><table>
            <thead><tr><th>Member</th><th>Mobile</th><th>Plan</th><th>{tab === 'expired' ? 'Ended' : 'Ends'}</th><th>Fee</th><th /></tr></thead>
            <tbody>{shown.map((x) => (
              <tr key={x.id}>
                <td><b>{x.full_name}</b><span className="sub">{x.member_code}</span></td>
                <td className="num">{showPhone(x.phone)}</td>
                <td>{x.plan_name}</td>
                <td>{fmtDate(x.end_date)}<span className="sub">{daysText(x.days_left)}</span></td>
                <td><PayBadge s={x.pay_status} /></td>
                <td className="actions">
                  <button className="btn sm primary" onClick={() => setRenew(x)}>Renew</button>{' '}
                  <WaButton label="" target={{ member_id: x.member_id, name: x.full_name, phone: x.phone, consent: x.whatsapp_consent, membership_id: x.id, end_date: x.end_date, plan: x.plan_name, kind: x.membership_status === 'expired' ? 'renewal' : 'expiry' }} />
                </td>
              </tr>
            ))}</tbody></table></div>
        )}
      </div>
      {renew && <RenewModal member={asMember(renew)} expiry={renew.end_date} onClose={() => setRenew(null)} onDone={reload} />}
    </>
  )
}
