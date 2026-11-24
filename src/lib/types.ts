export type Gender = 'men' | 'women'
export type PayStatus = 'paid' | 'pending' | 'partial' | 'overdue' | 'cancelled'
export type MemStatus = 'active' | 'expired' | 'upcoming' | 'none' | 'cancelled'
export type Method = 'cash' | 'upi' | 'bank_transfer' | 'other'
export type Role = 'owner' | 'receptionist' | 'none'

export interface Profile { id: string; full_name: string | null; email: string | null; phone: string | null; role: Role; active: boolean }
export interface Invite { id: string; full_name: string | null; email: string | null; phone: string | null; role: Role; claimed_by: string | null }

export interface GymSettings {
  gym_name: string; address: string; instagram: string | null; owner_name: string; owner_phone: string | null
  owner_instagram: string | null; receptionist_max_discount_pct: number; default_due_days: number
}
export interface Plan { id: string; months: number; name: string; price_men: number; price_women: number; active: boolean }

export interface Member {
  id: string; member_code: string; full_name: string; phone: string; gender: Gender; age: number | null
  address: string | null; emergency_contact: string | null; notes: string | null; joined_on: string
  whatsapp_consent: boolean; archived_at: string | null; created_at: string
  expiry_date: string | null; latest_plan: string | null; membership_status: MemStatus
  outstanding: number; fee_status: Exclude<PayStatus, 'cancelled'>
}
export interface Membership {
  id: string; member_id: string; member_code: string; full_name: string; phone: string; gender: Gender
  archived_at: string | null; plan_months: number; plan_name: string; kind: 'new' | 'renewal'
  start_date: string; end_date: string; original_price: number; discount: number; final_amount: number
  due_date: string; cancelled_at: string | null; created_at: string
  amount_paid: number; balance: number; last_paid_at: string | null
  membership_status: MemStatus; pay_status: PayStatus; days_left: number; is_latest: boolean; whatsapp_consent: boolean
}
export interface Payment {
  id: string; membership_id: string; member_id: string; amount: number; method: Method; paid_at: string
  transaction_id: string | null; notes: string | null; voided_at: string | null; void_reason: string | null
  members?: { full_name: string; member_code: string; phone: string } | null
  memberships?: { plan_name: string } | null
}
export interface Pref {
  kind: 'pending_fee' | 'overdue' | 'expiry' | 'renewal' | 'payment_confirmation'; label: string
  auto_enabled: boolean; offset_days: number; repeat_every_days: number; template_name: string | null; template_language: string
}
export interface WaLog {
  id: string; member_id: string | null; kind: string; channel: 'api' | 'manual'
  status: 'pending' | 'sent' | 'failed' | 'manual_opened'; phone: string; message_body: string | null
  error: string | null; created_at: string; members?: { full_name: string; member_code: string } | null
}
export interface DashStats {
  total_members: number; archived_members: number; active_members: number; upcoming_members: number
  expired_members: number; new_this_month: number; paid_this_month: number; payments_this_month: number
  pending_total: number; pending_members: number; total_collection: number
}
