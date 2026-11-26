// Runs the real migration in an in-memory Postgres and checks the business rules.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'

const db = new PGlite()
let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('PASS', name) } else { fail++; console.log('FAIL', name, extra) }
}
const q = async (sql, params) => (await db.query(sql, params)).rows
const as = async (uid, fn) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`)
  try { return await fn() } finally { await db.exec('reset role') }
}
const fails = async (fn) => { try { await fn(); return null } catch (e) { return String(e.message) } }
const rpc = (name, args = []) => q(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as r`, args).then(r => r[0].r)

// ---- minimal stand-ins for what Supabase already provides
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, phone text, raw_user_meta_data jsonb);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated;
`)
await db.exec(readFileSync(new URL('../supabase/migrations/001_pillar_fitness.sql', import.meta.url), 'utf8'))
console.log('migration applied')

// ---- people
await q(`insert into staff_invites (full_name, email, role) values ('Owner', 'owner@example.com', 'owner')`)
const owner = (await q(`insert into auth.users (email) values ('owner@example.com') returning id`))[0].id
const stranger = (await q(`insert into auth.users (email) values ('random@example.com') returning id`))[0].id
ok('invited owner email becomes owner', (await q(`select role from profiles where id=$1`, [owner]))[0].role === 'owner')
ok('uninvited sign-up gets no role', (await q(`select role from profiles where id=$1`, [stranger]))[0].role === 'none')

await as(owner, () => rpc('invite_staff', ['Desk', 'desk@example.com', null, 'receptionist']))
const desk = (await q(`insert into auth.users (email) values ('desk@example.com') returning id`))[0].id
ok('invited email becomes receptionist', (await q(`select role from profiles where id=$1`, [desk]))[0].role === 'receptionist')

const reg = (o) => rpc('register_member', [JSON.stringify(o)])

// TEST 1-3: prices come from the plans table
const r1 = await as(desk, () => reg({ full_name: 'Test Man One', phone: '+91 98765 43210', gender: 'men', plan_months: 1 }))
ok('T1 1 month = ₹1000', Number(r1.final_amount) === 1000, JSON.stringify(r1))
const r2 = await as(desk, () => reg({ full_name: 'Test Woman', phone: '9876543211', gender: 'women', plan_months: 3 }))
ok('T2 3 months = ₹2500', Number(r2.final_amount) === 2500, JSON.stringify(r2))
// price edit by owner: set men 3 months to 2600 and make sure old membership keeps 2500
await as(owner, () => q(`update plans set price_men = 2600 where months = 3`))
const r3 = await as(desk, () => reg({ full_name: 'Test Man Three', phone: '9876543212', gender: 'men', plan_months: 3 }))
ok('T3 new price used after owner edits plan', Number(r3.final_amount) === 2600)
ok('T3 old member keeps original price',
  Number((await q(`select final_amount from memberships where id=$1`, [r2.membership_id]))[0].final_amount) === 2500)
await as(owner, () => q(`update plans set price_men = 2500 where months = 3`))
// owner can add a 6 month plan
await as(owner, () => q(`insert into plans (months, name, price_men, price_women) values (6, '6 Months', 4500, 4500)`))
const r6 = await as(desk, () => reg({ full_name: 'Six Month', phone: '9876543219', gender: 'men', plan_months: 6 }))
ok('owner-added 6 month plan works', Number(r6.final_amount) === 4500)

// TEST 4: no email needed. phone normalised
const m1 = (await q(`select * from members where id=$1`, [r1.member_id]))[0]
ok('T4 registered with mobile only, phone normalised', m1.phone === '9876543210' && /^PF-\d{4}$/.test(m1.member_code), JSON.stringify(m1))
ok('bad mobile rejected', !!(await as(desk, () => fails(() => reg({ full_name: 'Bad', phone: '12345', gender: 'men', plan_months: 1 })))))
ok('duplicate form submit does not create 2 members', await as(desk, async () => {
  const o = { full_name: 'Twice', phone: '9876543220', gender: 'men', plan_months: 1, request_key: 'k1' }
  await reg(o); await reg(o)
  return (await q(`select count(*)::int c from members where phone='9876543220'`))[0].c === 1
}))

// expiry date: 1 month from today ends the day before the same date next month
const ms1 = (await q(`select start_date::text as start_date, end_date::text as end_date from memberships where id=$1`, [r1.membership_id]))[0]
const exp = (await q(`select ((start_date + interval '1 month')::date - 1)::text as e from memberships where id=$1`, [r1.membership_id]))[0].e
ok('expiry = start + 1 month - 1 day', ms1.end_date === exp)

// TEST 5: dashboard counts
const d = await as(desk, () => rpc('dashboard_stats'))
ok('T5 total registered', d.total_members === 5, JSON.stringify(d))
ok('T5 active members', d.active_members === 5)

// TEST 6: unpaid shows as pending fees
const pend = await as(desk, () => q(`select * from v_memberships where member_id=$1`, [r1.member_id]))
ok('T6 unpaid member is pending, balance 1000', pend[0].pay_status === 'pending' && Number(pend[0].balance) === 1000)
ok('T6 pending total on dashboard', Number(d.pending_total) === 1000 + 2500 + 2600 + 4500 + 1000, JSON.stringify(d))

// TEST 7: payment changes status and revenue
const p1 = await as(desk, () => rpc('record_payment', [r1.membership_id, 1000, 'upi', 'UTR123', null, 'idem-1']))
ok('T7 paid in full, balance 0', Number(p1.balance) === 0)
const d2 = await as(desk, () => rpc('dashboard_stats'))
ok('T7 revenue up by 1000', Number(d2.paid_this_month) === 1000, JSON.stringify(d2))
ok('T7 status paid', (await as(desk, () => q(`select pay_status from v_memberships where id=$1`, [r1.membership_id])))[0].pay_status === 'paid')
ok('same click twice is not counted twice',
  await as(desk, async () => { await rpc('record_payment', [r1.membership_id, 1000, 'upi', 'UTR123', null, 'idem-1']);
    return Number((await q(`select sum(amount) s from payments where voided_at is null`))[0].s) === 1000 }))
ok('cannot pay more than balance',
  !!(await as(desk, () => fails(() => rpc('record_payment', [r1.membership_id, 1, 'cash', null, null, 'idem-x'])))))
ok('active membership does not mean paid', d2.active_members === 5 && Number(d2.pending_total) > 0)

// TEST 8: partial payment
const p2 = await as(desk, () => rpc('record_payment', [r2.membership_id, 1000, 'cash', null, null, 'idem-2']))
ok('T8 partial leaves ₹1500', Number(p2.balance) === 1500)
ok('T8 status partial', (await as(desk, () => q(`select pay_status from v_memberships where id=$1`, [r2.membership_id])))[0].pay_status === 'partial')
ok('same UPI transaction id cannot be used twice',
  !!(await as(desk, () => fails(() => rpc('record_payment', [r2.membership_id, 500, 'upi', 'utr123', null, 'idem-3'])))))
await as(desk, () => rpc('record_payment', [r2.membership_id, 1500, 'cash', null, null, 'idem-4']))
ok('remaining balance clears it', (await as(desk, () => q(`select pay_status from v_memberships where id=$1`, [r2.membership_id])))[0].pay_status === 'paid')

// overdue: due date in the past, unpaid
await as(desk, () => q(`update memberships set due_date = public.gym_today() - 3 where id=$1`, [r3.membership_id]))
ok('past due date shows overdue', (await as(desk, () => q(`select pay_status from v_memberships where id=$1`, [r3.membership_id])))[0].pay_status === 'overdue')

// TEST 9: renewal keeps history
const before = (await q(`select count(*)::int c from payments`))[0].c
const ren = await as(desk, () => rpc('renew_membership', [JSON.stringify({ member_id: r1.member_id, plan_months: 1, payment: { amount: 500, method: 'cash', idempotency_key: 'ren-1' } })]))
ok('T9 renewal starts after old one ends', String(ren.start_date) > String(ms1.end_date), JSON.stringify(ren))
ok('T9 two memberships on file',
  (await q(`select count(*)::int c from memberships where member_id=$1`, [r1.member_id]))[0].c === 2)
ok('T9 old payment untouched, new one added',
  (await q(`select count(*)::int c from payments`))[0].c === before + 1 &&
  Number((await q(`select amount from payments where idempotency_key='idem-1'`))[0].amount) === 1000)
ok('T9 renewal history saved', (await q(`select count(*)::int c from renewal_history`))[0].c === 1)
ok('cannot renew into an overlapping period',
  !!(await as(desk, () => fails(() => rpc('renew_membership', [JSON.stringify({ member_id: r1.member_id, plan_months: 1, start_date: String(ms1.start_date) })])))))

// discounts
ok('receptionist cannot discount by default', !!(await as(desk, () => fails(() => reg({ full_name: 'Disc', phone: '9876543230', gender: 'men', plan_months: 1, discount: 100 })))))
const rd = await as(owner, () => reg({ full_name: 'Disc Owner', phone: '9876543231', gender: 'men', plan_months: 3, discount: 300 }))
const rdm = (await q(`select original_price, discount, final_amount from memberships where id=$1`, [rd.membership_id]))[0]
ok('discount stored separately', Number(rdm.original_price) === 2500 && Number(rdm.discount) === 300 && Number(rdm.final_amount) === 2200)
await as(owner, () => q(`update gym_settings set receptionist_max_discount_pct = 10`))
ok('receptionist can discount within owner limit', !!(await as(desk, () => reg({ full_name: 'Disc Two', phone: '9876543232', gender: 'men', plan_months: 1, discount: 100 }))))
ok('receptionist blocked above the limit', !!(await as(desk, () => fails(() => reg({ full_name: 'Disc Three', phone: '9876543233', gender: 'men', plan_months: 1, discount: 101 })))))

// TEST 12: permissions
ok('T12 receptionist cannot read reports', !!(await as(desk, () => fails(() => rpc('reports_summary', [2026, 11])))))
ok('T12 owner can read reports', (await as(owner, () => rpc('reports_summary', [2026, 11]))).registered >= 6)
ok('T12 receptionist cannot change prices', (await as(desk, () => q(`update plans set price_men = 1 where months = 1 returning id`))).length === 0)
ok('T12 receptionist cannot archive', !!(await as(desk, () => fails(() => rpc('archive_member', [r1.member_id])))))
ok('T12 receptionist cannot void payments', !!(await as(desk, () => fails(() => rpc('void_payment', [p1.payment_id, 'oops'])))))
ok('T12 receptionist cannot add staff', !!(await as(desk, () => fails(() => rpc('invite_staff', ['x', 'x@x.com', null, 'owner'])))))
ok('T12 receptionist cannot edit payment rows', !!(await as(desk, () => fails(() => q(`update payments set amount = 1`)))))
ok('T12 nobody can insert payments directly', !!(await as(desk, () => fails(() => q(`insert into payments (membership_id, member_id, amount, method) values ($1,$2,1,'cash')`, [r1.membership_id, r1.member_id])))))
ok('T12 receptionist cannot read WhatsApp secrets', !!(await as(desk, () => fails(() => q(`select * from whatsapp_secrets`)))))
ok('T12 owner cannot read WhatsApp secrets either', !!(await as(owner, () => fails(() => q(`select access_token from whatsapp_secrets`)))))
await as(owner, () => rpc('set_whatsapp_credentials', ['12345', '999', 'SECRET-TOKEN', 'v23.0']))
const ws = await as(desk, () => rpc('whatsapp_status'))
ok('whatsapp status never leaks the token', ws.configured === true && !JSON.stringify(ws).includes('SECRET') && ws.phone_number_id === null, JSON.stringify(ws))
ok('stranger sees nothing', (await as(stranger, () => q(`select * from members`))).length === 0)
ok('stranger cannot use app functions', !!(await as(stranger, () => fails(() => rpc('dashboard_stats')))))
ok('stranger cannot register members', !!(await as(stranger, () => fails(() => reg({ full_name: 'Hack', phone: '9876543299', gender: 'men', plan_months: 1 })))))
ok('logged-out visitor cannot read members', await (async () => { await db.exec('set role anon'); const e = await fails(() => q('select * from members')); await db.exec('reset role'); return !!e })())

// void, archive, history stays
await as(owner, () => rpc('void_payment', [p1.payment_id, 'entered by mistake']))
ok('voided payment no longer counted',
  Number((await as(owner, () => rpc('dashboard_stats'))).paid_this_month) === 1000 + 1500 + 500)
ok('payment row still in history', (await q(`select count(*)::int c from payments where id=$1`, [p1.payment_id]))[0].c === 1)
await as(owner, () => rpc('archive_member', [r2.member_id]))
ok('archived member leaves counts but keeps payments',
  (await as(owner, () => rpc('dashboard_stats'))).archived_members === 1 &&
  (await q(`select count(*)::int c from payments where member_id=$1`, [r2.member_id]))[0].c === 2)

// last owner guard
ok('cannot remove the last owner', !!(await as(owner, () => fails(() => rpc('set_staff_access', [owner, 'receptionist', true])))))

// reminders candidates
await as(owner, () => q(`update notification_preferences set auto_enabled = true`))
const cands = await q(`select * from public.reminder_candidates('overdue')`)
ok('overdue reminder picks the overdue member', cands.length === 1 && cands[0].member_id === r3.member_id, JSON.stringify(cands))
await q(`insert into whatsapp_logs (member_id, membership_id, kind, channel, status, phone) values ($1,$2,'overdue','api','sent','9876543212')`, [r3.member_id, r3.membership_id])
ok('same member is not messaged again within the window', (await q(`select * from public.reminder_candidates('overdue')`)).length === 0)
ok('payment confirmations picked up once', (await q(`select * from public.reminder_candidates('payment_confirmation')`)).length >= 1)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
