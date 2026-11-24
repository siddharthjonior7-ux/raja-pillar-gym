// WhatsApp message texts. Pure functions, no imports.
// This file exists twice: supabase/functions/_shared/messages.ts and src/lib/messages.ts.
// Edit one, then run `npm run sync:messages` so both stay identical.

export type MessageKind = 'pending_fee' | 'overdue' | 'expiry' | 'renewal' | 'payment_confirmation'

export interface MessageData {
  name: string
  amount?: number
  dueDate?: string // YYYY-MM-DD
  endDate?: string // YYYY-MM-DD
  plan?: string
}
export interface GymInfo {
  name: string
  address: string
}

export const inr = (n: number | string | undefined) =>
  Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })

export const ddmmyyyy = (iso?: string) => {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

const sign = (g: GymInfo) => `Thank you!\n${g.name}\n${g.address}`

export function buildMessage(kind: MessageKind, d: MessageData, g: GymInfo): string {
  const hi = `Hello ${d.name}!\n\n`
  switch (kind) {
    case 'pending_fee':
      return `${hi}This is a friendly reminder from ${g.name}.\n\nYour membership fee of ₹${inr(d.amount)} is currently pending.\n\nPlease complete your payment to continue enjoying your gym membership.\n\n${sign(g)}`
    case 'overdue':
      return `${hi}This is a reminder from ${g.name}.\n\nYour membership fee of ₹${inr(d.amount)} was due on ${ddmmyyyy(d.dueDate)} and is still pending.\n\nPlease pay at the earliest so your membership is not interrupted.\n\n${sign(g)}`
    case 'expiry':
      return `${hi}Your ${g.name} membership is expiring on ${ddmmyyyy(d.endDate)}.\n\nRenew your membership to continue your fitness journey with us.\n\nThank you!\n${g.name}`
    case 'renewal':
      return `${hi}Your ${g.name} membership ended on ${ddmmyyyy(d.endDate)}.\n\nWe would love to see you back. Renew your membership and continue your fitness journey with us.\n\n${sign(g)}`
    case 'payment_confirmation':
      return `${hi}Your payment of ₹${inr(d.amount)} has been successfully recorded.\n\nMembership Plan: ${d.plan ?? ''}\nValid Until: ${ddmmyyyy(d.endDate)}\n\nThank you for being part of ${g.name}!`
  }
}

// Order of the {{1}}, {{2}}... variables in each approved WhatsApp template.
export function templateParams(kind: MessageKind, d: MessageData): string[] {
  switch (kind) {
    case 'pending_fee': return [d.name, inr(d.amount)]
    case 'overdue': return [d.name, inr(d.amount), ddmmyyyy(d.dueDate)]
    case 'expiry': return [d.name, ddmmyyyy(d.endDate)]
    case 'renewal': return [d.name, ddmmyyyy(d.endDate)]
    case 'payment_confirmation': return [d.name, inr(d.amount), d.plan ?? '', ddmmyyyy(d.endDate)]
  }
}

// Click-to-chat link. phone is the saved 10 digit Indian mobile number.
export const waLink = (phone10: string, text: string) =>
  `https://wa.me/91${phone10.replace(/\D/g, '').slice(-10)}?text=${encodeURIComponent(text)}`
