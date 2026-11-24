import type { MemStatus, PayStatus, Method } from './types'

export const inr = (n: number | string | null | undefined) =>
  '₹' + Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })

export const fmtDate = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—')

export const fmtDateTime = (ts?: string | null) =>
  ts
    ? new Date(ts).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
      })
    : '—'

export const todayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

const pad = (n: number) => String(n).padStart(2, '0')
export const addDays = (iso: string, days: number) => {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}
// same rule as the database: start + N months, minus one day
export const membershipEnd = (startISO: string, months: number) => {
  const [y, m, d] = startISO.split('-').map(Number)
  const total = m - 1 + months
  const ty = y + Math.floor(total / 12)
  const tm = total % 12
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate()
  return addDays(`${ty}-${pad(tm + 1)}-${pad(Math.min(d, last))}`, -1)
}

export const monthRangeISO = (year: number, month: number) => {
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 }
  return {
    from: `${year}-${pad(month)}-01T00:00:00+05:30`,
    to: `${next.y}-${pad(next.m)}-01T00:00:00+05:30`,
  }
}
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export const cleanPhone = (v: string) => {
  let d = v.replace(/\D/g, '')
  if (d.length > 10 && d.startsWith('91')) d = d.slice(2)
  if (d.length > 10 && d.startsWith('0')) d = d.slice(1)
  return d.slice(0, 10)
}
export const validPhone = (v: string) => /^[6-9]\d{9}$/.test(v)
export const showPhone = (v: string) => `+91 ${v.slice(0, 5)} ${v.slice(5)}`

export const PAY_LABEL: Record<PayStatus, string> = {
  paid: 'Paid', pending: 'Pending', partial: 'Partially paid', overdue: 'Overdue', cancelled: 'Cancelled',
}
export const MEM_LABEL: Record<MemStatus, string> = {
  active: 'Active', expired: 'Expired', upcoming: 'Starts soon', none: 'No plan', cancelled: 'Cancelled',
}
export const METHOD_LABEL: Record<Method, string> = { cash: 'Cash', upi: 'UPI', bank_transfer: 'Bank transfer', other: 'Other' }
export const KIND_LABEL: Record<string, string> = {
  pending_fee: 'Pending fee', overdue: 'Overdue fee', expiry: 'Expiry reminder', renewal: 'Renewal reminder', payment_confirmation: 'Payment confirmation',
}

export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`
export const daysText = (d: number) => (d < 0 ? `ended ${plural(-d, 'day')} ago` : d === 0 ? 'ends today' : `${plural(d, 'day')} left`)
