import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { must } from '../lib/api'
import { useAsync, useDebounced } from '../lib/hooks'
import { fmtDate, inr, showPhone } from '../lib/format'
import { downloadCSV } from '../lib/csv'
import type { Member } from '../lib/types'
import { Empty, ErrorBox, Loading, MemBadge, PageHead, PayBadge, SearchBox, Tabs } from '../components/ui'
import { Icon } from '../components/icons'
import { RegisterModal } from '../components/forms'
import { MemberProfile } from '../components/MemberProfile'
import { useData } from '../data'

type Filter = 'all' | 'active' | 'expired' | 'paid' | 'unpaid' | 'archived'
const PAGE = 100

export default function Members() {
  const { isOwner } = useData()
  const [params, setParams] = useSearchParams()
  const [filter, setFilter] = useState<Filter>((params.get('filter') as Filter) || 'all')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'joined' | 'expiry' | 'name'>('joined')
  const [limit, setLimit] = useState(PAGE)
  const [adding, setAdding] = useState(params.get('add') === '1')
  const [openId, setOpenId] = useState<string | null>(null)
  const dq = useDebounced(q.trim().replace(/[,()%*]/g, ' '), 250)

  const { data, loading, error, reload } = useAsync(async () => {
    let query = supabase.from('v_members').select('*', { count: 'exact' })
    if (filter === 'archived') query = query.not('archived_at', 'is', null)
    else query = query.is('archived_at', null)
    if (filter === 'active') query = query.eq('membership_status', 'active')
    if (filter === 'expired') query = query.eq('membership_status', 'expired')
    if (filter === 'paid') query = query.eq('fee_status', 'paid')
    if (filter === 'unpaid') query = query.in('fee_status', ['pending', 'partial', 'overdue'])
    if (dq) query = query.or(`full_name.ilike.%${dq}%,phone.ilike.%${dq}%,member_code.ilike.%${dq}%`)
    if (sort === 'joined') query = query.order('joined_on', { ascending: false }).order('created_at', { ascending: false })
    if (sort === 'expiry') query = query.order('expiry_date', { ascending: true, nullsFirst: false })
    if (sort === 'name') query = query.order('full_name', { ascending: true })
    const res = await query.range(0, limit - 1)
    if (res.error) throw new Error(res.error.message)
    return { rows: (res.data as Member[]) ?? [], total: res.count ?? 0 }
  }, [filter, dq, sort, limit])

  const counts = useAsync(async () => {
    const r = await supabase.from('v_members').select('membership_status, fee_status, archived_at')
    const rows = must(r) as Pick<Member, 'membership_status' | 'fee_status' | 'archived_at'>[]
    const live = rows.filter((x) => !x.archived_at)
    return {
      all: live.length, active: live.filter((x) => x.membership_status === 'active').length,
      expired: live.filter((x) => x.membership_status === 'expired').length, paid: live.filter((x) => x.fee_status === 'paid').length,
      unpaid: live.filter((x) => x.fee_status !== 'paid').length, archived: rows.length - live.length,
    }
  }, [])
  const c = counts.data

  function exportCsv() {
    if (!data) return
    downloadCSV('members.csv', [
      ['Member ID', 'Name', 'Mobile', 'Gender', 'Joined', 'Plan', 'Expiry', 'Membership', 'Fee status', 'Outstanding'],
      ...data.rows.map((m) => [m.member_code, m.full_name, m.phone, m.gender, fmtDate(m.joined_on), m.latest_plan, fmtDate(m.expiry_date), m.membership_status, m.fee_status, m.outstanding]),
    ])
  }
  const refresh = () => { reload(); counts.reload() }

  return (
    <>
      <PageHead title="Members" sub="Everyone who has joined. Membership and fee status are tracked separately."
        actions={<>
          {isOwner && <button className="btn" onClick={exportCsv} disabled={!data?.rows.length}><Icon name="download" size={18} /> Export CSV</button>}
          <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={18} /> Add new member</button>
        </>} />

      <Tabs value={filter} onChange={(v) => { setFilter(v); setLimit(PAGE); setParams({}) }} items={[
        { id: 'all', label: 'All', count: c?.all }, { id: 'active', label: 'Active', count: c?.active }, { id: 'expired', label: 'Expired', count: c?.expired },
        { id: 'paid', label: 'Paid', count: c?.paid }, { id: 'unpaid', label: 'Unpaid', count: c?.unpaid }, { id: 'archived', label: 'Archived', count: c?.archived },
      ]} />

      <div className="row wrap" style={{ marginBottom: 14 }}>
        <SearchBox value={q} onChange={setQ} placeholder="Search by name, mobile or member ID" />
        <select className="input" style={{ width: 'auto' }} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort by">
          <option value="joined">Newest first</option><option value="expiry">Expiry date</option><option value="name">Name A to Z</option>
        </select>
      </div>

      <div className="card flush">
        {error ? <div style={{ padding: 16 }}><ErrorBox msg={error} retry={reload} /></div>
          : loading && !data ? <Loading />
          : !data?.rows.length ? (
            <Empty title={dq ? 'No member matches your search' : 'No members here yet'} hint={dq ? 'Check the spelling or try the mobile number.' : filter === 'all' ? 'Add your first member to start tracking fees.' : 'Nothing in this list right now.'}
              action={!dq && filter === 'all' ? <button className="btn primary" onClick={() => setAdding(true)}>Add new member</button> : undefined} />
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Member</th><th>Mobile</th><th>Plan</th><th>Expires</th><th>Membership</th><th>Fee</th><th className="right">Due</th></tr></thead>
                <tbody>
                  {data.rows.map((m) => (
                    <tr key={m.id} className="click" onClick={() => setOpenId(m.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpenId(m.id)}>
                      <td><b>{m.full_name}</b><span className="sub">{m.member_code}</span></td>
                      <td className="num">{showPhone(m.phone)}</td>
                      <td>{m.latest_plan ?? '—'}</td>
                      <td>{fmtDate(m.expiry_date)}</td>
                      <td><MemBadge s={m.membership_status} /></td>
                      <td><PayBadge s={m.fee_status} /></td>
                      <td className="right num">{Number(m.outstanding) > 0 ? inr(m.outstanding) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>
      {data && data.total > data.rows.length && (
        <div className="row" style={{ justifyContent: 'center', marginTop: 14 }}>
          <button className="btn" onClick={() => setLimit(limit + PAGE)}>Show more ({data.rows.length} of {data.total})</button>
        </div>
      )}

      {adding && <RegisterModal onClose={() => { setAdding(false); setParams({}) }} onDone={refresh} />}
      {openId && <MemberProfile memberId={openId} onClose={() => setOpenId(null)} onChanged={refresh} />}
    </>
  )
}
