import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { rpc, errMsg, must } from '../lib/api'
import { useAsync } from '../lib/hooks'
import { cleanPhone, KIND_LABEL, showPhone } from '../lib/format'
import type { GymSettings, Invite, Plan, Pref, Profile } from '../lib/types'
import { ErrorBox, Field, Loading, PageHead, Tabs, useToast } from '../components/ui'
import { useData } from '../data'
import { useAuth } from '../auth'

type Tab = 'gym' | 'plans' | 'staff' | 'whatsapp' | 'reminders' | 'account'

export default function Settings() {
  const { isOwner } = useData()
  const [params] = useSearchParams()
  const first = (params.get('tab') as Tab) || (isOwner ? 'gym' : 'account')
  const [tab, setTab] = useState<Tab>(first)
  const items: { id: Tab; label: string }[] = isOwner
    ? [{ id: 'gym', label: 'Gym details' }, { id: 'plans', label: 'Prices and plans' }, { id: 'staff', label: 'Staff' }, { id: 'whatsapp', label: 'WhatsApp' }, { id: 'reminders', label: 'Reminders' }, { id: 'account', label: 'My account' }]
    : [{ id: 'account', label: 'My account' }]
  return (
    <>
      <PageHead title="Settings" sub={isOwner ? 'Owner settings. Receptionists cannot see this page.' : 'Pricing, staff and WhatsApp settings are managed by the owner.'} />
      <Tabs value={tab} onChange={setTab} items={items} />
      {tab === 'gym' && isOwner && <GymTab />}
      {tab === 'plans' && isOwner && <PlansTab />}
      {tab === 'staff' && isOwner && <StaffTab />}
      {tab === 'whatsapp' && isOwner && <WhatsAppTab />}
      {tab === 'reminders' && isOwner && <RemindersTab />}
      {tab === 'account' && <AccountTab />}
    </>
  )
}

// ---------- gym details ----------
function GymTab() {
  const { gym, reload } = useData()
  const toast = useToast()
  const [g, setG] = useState<GymSettings>(gym)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof GymSettings, v: string | number) => setG({ ...g, [k]: v })
  async function save() {
    if (!g.gym_name.trim() || !g.address.trim()) return toast('Gym name and address are needed for messages.', 'error')
    setBusy(true)
    try {
      must(await supabase.from('gym_settings').update({
        gym_name: g.gym_name.trim(), address: g.address.trim(), instagram: g.instagram?.replace('@', '') || null, owner_name: g.owner_name.trim(),
        owner_phone: g.owner_phone || null, owner_instagram: g.owner_instagram?.replace('@', '') || null,
        receptionist_max_discount_pct: Number(g.receptionist_max_discount_pct) || 0, default_due_days: Number(g.default_due_days) || 0, updated_at: new Date().toISOString(),
      }).eq('id', 1).select('id').single())
      await reload(); toast('Settings saved')
    } catch (e) { toast(errMsg(e), 'error') }
    setBusy(false)
  }
  return (
    <section className="card stack" style={{ maxWidth: 760 }}>
      <div className="form-grid">
        <Field label="Gym name"><input className="input" value={g.gym_name} onChange={(e) => set('gym_name', e.target.value)} /></Field>
        <Field label="Gym Instagram" hint="Shown in the footer"><input className="input" value={g.instagram ?? ''} onChange={(e) => set('instagram', e.target.value)} placeholder="username" /></Field>
        <div className="full"><Field label="Address" hint="Used at the end of WhatsApp messages"><input className="input" value={g.address} onChange={(e) => set('address', e.target.value)} /></Field></div>
        <Field label="Owner name"><input className="input" value={g.owner_name} onChange={(e) => set('owner_name', e.target.value)} /></Field>
        <Field label="Owner mobile"><input className="input" inputMode="numeric" value={g.owner_phone ?? ''} onChange={(e) => set('owner_phone', cleanPhone(e.target.value))} /></Field>
        <Field label="Owner Instagram"><input className="input" value={g.owner_instagram ?? ''} onChange={(e) => set('owner_instagram', e.target.value)} placeholder="username" /></Field>
        <Field label="Days to pay after a plan starts" hint="0 means the fee is due on the start date"><input className="input" inputMode="numeric" value={g.default_due_days} onChange={(e) => set('default_due_days', cleanPhone(e.target.value).slice(0, 2))} /></Field>
        <Field label="Receptionist discount limit (%)" hint="0 means only the owner can give discounts"><input className="input" inputMode="numeric" value={g.receptionist_max_discount_pct} onChange={(e) => set('receptionist_max_discount_pct', cleanPhone(e.target.value).slice(0, 3))} /></Field>
      </div>
      <div><button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button></div>
    </section>
  )
}

// ---------- plans ----------
function PlansTab() {
  const { plans, reload } = useData()
  const toast = useToast()
  const [edit, setEdit] = useState<Record<string, { m: string; w: string }>>({})
  const [add, setAdd] = useState({ months: '', m: '', w: '' })
  const [busy, setBusy] = useState(false)

  async function savePlan(p: Plan) {
    const e = edit[p.id]; if (!e) return
    setBusy(true)
    try {
      must(await supabase.from('plans').update({ price_men: Number(e.m), price_women: Number(e.w) }).eq('id', p.id).select('id').single())
      await reload(); setEdit((s) => { const n = { ...s }; delete n[p.id]; return n }); toast(`${p.name} prices saved`)
    } catch (er) { toast(errMsg(er), 'error') }
    setBusy(false)
  }
  async function toggle(p: Plan) {
    try { must(await supabase.from('plans').update({ active: !p.active }).eq('id', p.id).select('id').single()); await reload() } catch (e) { toast(errMsg(e), 'error') }
  }
  async function create() {
    const months = Number(add.months)
    if (!months || months < 1 || months > 36) return toast('Enter the number of months, from 1 to 36.', 'error')
    if (plans.some((p) => p.months === months)) return toast(`A ${months} month plan already exists.`, 'error')
    if (add.m === '' || add.w === '') return toast('Enter the price for men and women.', 'error')
    setBusy(true)
    try {
      must(await supabase.from('plans').insert({ months, name: months === 1 ? '1 Month' : `${months} Months`, price_men: Number(add.m), price_women: Number(add.w) }).select('id').single())
      await reload(); setAdd({ months: '', m: '', w: '' }); toast('Plan added')
    } catch (e) { toast(errMsg(e), 'error') }
    setBusy(false)
  }

  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <div className="notice">Changing a price affects new members and renewals only. Members who already paid keep the price they were charged.</div>
      <div className="card flush table-wrap">
        <table>
          <thead><tr><th>Plan</th><th>Men (₹)</th><th>Women (₹)</th><th /></tr></thead>
          <tbody>
            {plans.map((p) => {
              const e = edit[p.id] ?? { m: String(Number(p.price_men)), w: String(Number(p.price_women)) }
              const dirty = edit[p.id] !== undefined
              return (
                <tr key={p.id} style={!p.active ? { opacity: .55 } : undefined}>
                  <td><b>{p.name}</b>{!p.active && <span className="sub">Hidden</span>}</td>
                  <td><input className="input" style={{ minWidth: 100 }} inputMode="numeric" value={e.m} aria-label={`${p.name} price for men`} onChange={(ev) => setEdit({ ...edit, [p.id]: { ...e, m: ev.target.value.replace(/\D/g, '') } })} /></td>
                  <td><input className="input" style={{ minWidth: 100 }} inputMode="numeric" value={e.w} aria-label={`${p.name} price for women`} onChange={(ev) => setEdit({ ...edit, [p.id]: { ...e, w: ev.target.value.replace(/\D/g, '') } })} /></td>
                  <td className="actions">
                    {dirty && <button className="btn sm primary" disabled={busy} onClick={() => savePlan(p)}>Save</button>}{' '}
                    <button className="btn sm ghost" onClick={() => toggle(p)}>{p.active ? 'Hide' : 'Show'}</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <section className="card stack">
        <h3>Add a plan</h3>
        <div className="form-grid">
          <Field label="Months"><input className="input" inputMode="numeric" value={add.months} onChange={(e) => setAdd({ ...add, months: e.target.value.replace(/\D/g, '').slice(0, 2) })} placeholder="6" /></Field>
          <span />
          <Field label="Price for men (₹)"><input className="input" inputMode="numeric" value={add.m} onChange={(e) => setAdd({ ...add, m: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field label="Price for women (₹)"><input className="input" inputMode="numeric" value={add.w} onChange={(e) => setAdd({ ...add, w: e.target.value.replace(/\D/g, '') })} /></Field>
        </div>
        <div><button className="btn dark" onClick={create} disabled={busy}>Add plan</button></div>
      </section>
    </div>
  )
}

// ---------- staff ----------
function StaffTab() {
  const { profile } = useAuth()
  const toast = useToast()
  const [f, setF] = useState({ name: '', email: '', phone: '', role: 'receptionist' })
  const [busy, setBusy] = useState(false)
  const { data, loading, error, reload } = useAsync(async () => {
    const [p, i] = await Promise.all([supabase.from('profiles').select('*').order('created_at'), supabase.from('staff_invites').select('*').is('claimed_by', null).order('created_at')])
    return { people: must(p) as Profile[], invites: must(i) as Invite[] }
  }, [])

  async function invite() {
    setBusy(true)
    try {
      await rpc('invite_staff', { p_name: f.name, p_email: f.email, p_phone: f.phone, p_role: f.role })
      toast('Staff member added. They can now sign in with that mobile number or email.'); setF({ name: '', email: '', phone: '', role: 'receptionist' }); reload()
    } catch (e) { toast(errMsg(e), 'error') }
    setBusy(false)
  }
  async function access(p: Profile, role: string, active: boolean) {
    try { await rpc('set_staff_access', { p_user: p.id, p_role: role, p_active: active }); toast('Access updated'); reload() } catch (e) { toast(errMsg(e), 'error') }
  }
  if (error) return <ErrorBox msg={error} retry={reload} />
  if (loading && !data) return <Loading />
  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <section className="card stack">
        <h3>Add staff</h3>
        <p className="muted sm-text">Enter the mobile number or email the person will sign in with. Only people added here can open the app.</p>
        <div className="form-grid">
          <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Role"><select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="receptionist">Receptionist</option><option value="owner">Owner</option></select></Field>
          <Field label="Mobile number"><input className="input" inputMode="numeric" value={f.phone} onChange={(e) => setF({ ...f, phone: cleanPhone(e.target.value) })} /></Field>
          <Field label="Email"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        </div>
        <div><button className="btn dark" onClick={invite} disabled={busy || (!f.phone && !f.email)}>Add staff</button></div>
      </section>

      <section className="card flush table-wrap">
        <table>
          <thead><tr><th>Person</th><th>Role</th><th>Access</th><th /></tr></thead>
          <tbody>
            {data!.people.map((p) => (
              <tr key={p.id}>
                <td><b>{p.full_name || p.email || (p.phone ? showPhone(p.phone) : 'Unnamed')}</b><span className="sub">{[p.email, p.phone && showPhone(p.phone)].filter(Boolean).join(' · ')}</span></td>
                <td>
                  <select className="input" value={p.role} disabled={p.id === profile?.id} aria-label="Role" onChange={(e) => access(p, e.target.value, p.active)}>
                    <option value="owner">Owner</option><option value="receptionist">Receptionist</option><option value="none">No access</option>
                  </select>
                </td>
                <td><span className={`badge ${p.active && p.role !== 'none' ? 'active' : 'cancelled'}`}>{p.active && p.role !== 'none' ? 'Allowed' : 'Blocked'}</span></td>
                <td className="actions">{p.id !== profile?.id && <button className="btn sm ghost" onClick={() => access(p, p.role, !p.active)}>{p.active ? 'Block' : 'Allow'}</button>}</td>
              </tr>
            ))}
            {data!.invites.map((i) => (
              <tr key={i.id}>
                <td><b>{i.full_name || 'Invited'}</b><span className="sub">{[i.email, i.phone && showPhone(i.phone)].filter(Boolean).join(' · ')}</span></td>
                <td>{i.role === 'owner' ? 'Owner' : 'Receptionist'}</td>
                <td><span className="badge partial">Not signed in yet</span></td>
                <td className="actions"><button className="btn sm ghost" onClick={() => rpc('remove_invite', { p_invite: i.id }).then(reload).catch((e) => toast(errMsg(e), 'error'))}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

// ---------- WhatsApp credentials ----------
function WhatsAppTab() {
  const { waConfigured, reload } = useData()
  const toast = useToast()
  const status = useAsync(() => rpc<{ configured: boolean; phone_number_id: string | null; business_account_id: string | null; api_version: string }>('whatsapp_status'), [waConfigured])
  const [f, setF] = useState({ phone: '', waba: '', token: '', ver: 'v23.0' })
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (status.data) setF((x) => ({ ...x, phone: status.data!.phone_number_id ?? '', waba: status.data!.business_account_id ?? '', ver: status.data!.api_version || 'v23.0' })) }, [status.data])

  async function save() {
    if (!f.phone.trim()) return toast('Enter the Phone Number ID.', 'error')
    if (!f.token.trim() && !status.data?.configured) return toast('Enter the access token.', 'error')
    setBusy(true)
    try {
      await rpc('set_whatsapp_credentials', { p_phone_number_id: f.phone, p_waba_id: f.waba, p_access_token: f.token, p_api_version: f.ver })
      setF((x) => ({ ...x, token: '' })); await reload(); status.reload(); toast('WhatsApp credentials saved')
    } catch (e) { toast(errMsg(e), 'error') }
    setBusy(false)
  }
  async function clear() {
    if (!confirm('Disconnect WhatsApp Business API? Click-to-chat reminders keep working.')) return
    try { await rpc('clear_whatsapp_credentials'); await reload(); status.reload(); setF({ phone: '', waba: '', token: '', ver: 'v23.0' }); toast('WhatsApp disconnected') } catch (e) { toast(errMsg(e), 'error') }
  }

  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <div className={`notice ${waConfigured ? '' : 'warn'}`}>
        {waConfigured ? <b>WhatsApp Business API is connected.</b> : <><b>Not connected.</b> Reminders work today with click-to-chat: the app opens WhatsApp with the message ready and you press send.</>}
      </div>
      <section className="card stack">
        <h3>WhatsApp Business Platform (Cloud API)</h3>
        <p className="muted sm-text">You need a Meta developer app with the WhatsApp product, a verified business number, and approved message templates. Get these three values from Meta’s API setup page. The token is stored on the server and is never shown again or sent to anyone’s browser.</p>
        <div className="form-grid">
          <Field label="Phone Number ID"><input className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value.trim() })} autoComplete="off" /></Field>
          <Field label="WhatsApp Business Account ID"><input className="input" value={f.waba} onChange={(e) => setF({ ...f, waba: e.target.value.trim() })} autoComplete="off" /></Field>
          <div className="full"><Field label="Permanent access token" hint={waConfigured ? 'A token is saved. Leave empty to keep it.' : 'Create a permanent token with a System User in Meta Business settings.'}>
            <input className="input" type="password" value={f.token} onChange={(e) => setF({ ...f, token: e.target.value })} autoComplete="new-password" placeholder={waConfigured ? '••••••••••••' : ''} /></Field></div>
          <Field label="API version"><input className="input" value={f.ver} onChange={(e) => setF({ ...f, ver: e.target.value.trim() })} /></Field>
        </div>
        <div className="row wrap">
          <button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save credentials'}</button>
          {waConfigured && <button className="btn ghost" onClick={clear}>Disconnect</button>}
        </div>
      </section>
    </div>
  )
}

// ---------- reminder preferences ----------
function RemindersTab() {
  const { waConfigured } = useData()
  const toast = useToast()
  const { data, loading, error, reload } = useAsync(async () => must(await supabase.from('notification_preferences').select('*').order('kind')) as Pref[], [])
  const [rows, setRows] = useState<Pref[]>([])
  useEffect(() => { if (data) setRows(data) }, [data])
  const order = ['payment_confirmation', 'pending_fee', 'overdue', 'expiry', 'renewal']
  const sorted = [...rows].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))

  async function save(p: Pref) {
    try {
      must(await supabase.from('notification_preferences').update({ auto_enabled: p.auto_enabled, offset_days: Number(p.offset_days), repeat_every_days: Math.max(1, Number(p.repeat_every_days)), template_name: p.template_name || null, template_language: p.template_language || 'en' }).eq('kind', p.kind).select('kind').single())
      toast(`${p.label} saved`); reload()
    } catch (e) { toast(errMsg(e), 'error') }
  }
  const patch = (kind: string, v: Partial<Pref>) => setRows(rows.map((r) => (r.kind === kind ? { ...r, ...v } : r)))
  const help: Record<string, string> = {
    payment_confirmation: 'Sent after a payment is recorded.',
    pending_fee: 'Days before the due date to start reminding. Use 0 to start on the due date.',
    overdue: 'Sent when a fee is past its due date.',
    expiry: 'Days before the plan ends.',
    renewal: 'Days after the plan has ended (up to 30 days).',
  }
  if (error) return <ErrorBox msg={error} retry={reload} />
  if (loading && !data) return <Loading />
  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <div className={`notice ${waConfigured ? '' : 'warn'}`}>
        {waConfigured
          ? <>Switch on the messages you want sent automatically. Automatic sending also needs the daily schedule from README step 6. Each member gets a reminder at most once per “repeat” period.</>
          : <>These switches only matter once WhatsApp Business API is connected. Until then, nothing is sent automatically and these settings have no effect.</>}
      </div>
      {sorted.map((p) => (
        <section className="card stack" key={p.kind}>
          <div className="row between"><h3>{KIND_LABEL[p.kind]}</h3>
            <label className="check"><input type="checkbox" checked={p.auto_enabled} onChange={(e) => patch(p.kind, { auto_enabled: e.target.checked })} /><span>Send automatically</span></label></div>
          <p className="muted sm-text">{help[p.kind]}</p>
          <div className="form-grid">
            {p.kind !== 'payment_confirmation' && p.kind !== 'overdue' && <Field label="Days"><input className="input" inputMode="numeric" value={p.offset_days} onChange={(e) => patch(p.kind, { offset_days: cleanPhone(e.target.value).slice(0, 2) as never })} /></Field>}
            <Field label="Do not repeat within (days)"><input className="input" inputMode="numeric" value={p.repeat_every_days} onChange={(e) => patch(p.kind, { repeat_every_days: cleanPhone(e.target.value).slice(0, 3) as never })} /></Field>
            <Field label="Approved template name" hint="Needed to message members first. Leave empty to send plain text, which WhatsApp only delivers inside a 24 hour chat window."><input className="input" value={p.template_name ?? ''} onChange={(e) => patch(p.kind, { template_name: e.target.value.trim() })} /></Field>
            <Field label="Template language"><input className="input" value={p.template_language} onChange={(e) => patch(p.kind, { template_language: e.target.value.trim() })} /></Field>
          </div>
          <div><button className="btn dark" onClick={() => save(p)}>Save</button></div>
        </section>
      ))}
    </div>
  )
}

// ---------- my account ----------
function AccountTab() {
  const { profile, session, signOut } = useAuth()
  return (
    <section className="card stack" style={{ maxWidth: 560 }}>
      <dl className="kv">
        <dt>Name</dt><dd>{profile?.full_name || '—'}</dd>
        <dt>Role</dt><dd>{profile?.role === 'owner' ? 'Owner' : 'Receptionist'}</dd>
        <dt>Mobile</dt><dd>{profile?.phone ? showPhone(profile.phone) : '—'}</dd>
        <dt>Email</dt><dd>{profile?.email || session?.user.email || '—'}</dd>
      </dl>
      <div><button className="btn" onClick={signOut}>Log out</button></div>
    </section>
  )
}
