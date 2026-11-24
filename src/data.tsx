import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { rpc } from './lib/api'
import { useAuth } from './auth'
import type { GymSettings, Plan } from './lib/types'

interface DataState {
  gym: GymSettings
  plans: Plan[]
  waConfigured: boolean
  isOwner: boolean
  reload: () => Promise<void>
}
const Ctx = createContext<DataState>(null as never)
export const useData = () => useContext(Ctx)

const FALLBACK: GymSettings = {
  gym_name: 'PILLAR FITNESS', address: 'Kothri, Madhya Pradesh, India', instagram: 'raja_pillar8', owner_name: 'Raja Pillar',
  owner_phone: '8319917857', owner_instagram: 'raja_pillar8', receptionist_max_discount_pct: 0, default_due_days: 0,
}

// Settings, plans and WhatsApp status are needed on almost every screen, so they load once here.
export function DataProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const [gym, setGym] = useState<GymSettings>(FALLBACK)
  const [plans, setPlans] = useState<Plan[]>([])
  const [waConfigured, setWa] = useState(false)

  const reload = useCallback(async () => {
    const [g, p, w] = await Promise.all([
      supabase.from('gym_settings').select('*').eq('id', 1).maybeSingle(),
      supabase.from('plans').select('*').order('months'),
      rpc<{ configured: boolean }>('whatsapp_status').catch(() => ({ configured: false })),
    ])
    if (g.data) setGym(g.data as GymSettings)
    setPlans((p.data as Plan[]) ?? [])
    setWa(Boolean(w.configured))
  }, [])

  useEffect(() => { reload() }, [reload])

  return <Ctx.Provider value={{ gym, plans, waConfigured, isOwner: profile?.role === 'owner', reload }}>{children}</Ctx.Provider>
}
