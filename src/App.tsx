import { useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './auth'
import { DataProvider, useData } from './data'
import { isConfigured } from './lib/supabase'
import { Icon, PillarMark } from './components/icons'
import { Loading } from './components/ui'
import Login, { ResetPassword } from './pages/Login'
import Dashboard from './pages/Dashboard'
import Members from './pages/Members'
import Fees from './pages/Fees'
import Plans from './pages/Plans'
import Renewals from './pages/Renewals'
import WhatsApp from './pages/WhatsApp'
import Reports from './pages/Reports'
import Settings from './pages/Settings'

const NAV = [
  { to: '/', label: 'Dashboard', icon: 'home', end: true },
  { to: '/members', label: 'Members', icon: 'users' },
  { to: '/fees', label: 'Fee Management', icon: 'rupee' },
  { to: '/plans', label: 'Membership Plans', icon: 'tag' },
  { to: '/renewals', label: 'Renewals', icon: 'refresh' },
  { to: '/whatsapp', label: 'WhatsApp', icon: 'chat' },
  { to: '/reports', label: 'Reports', icon: 'chart', owner: true },
  { to: '/settings', label: 'Settings', icon: 'gear' },
]

function Shell() {
  const { profile, signOut } = useAuth()
  const { gym, isOwner } = useData()
  const [open, setOpen] = useState(false)
  const loc = useLocation()
  const items = NAV.filter((n) => !n.owner || isOwner)
  return (
    <div className="shell">
      <div className="topbar">
        <button className="icon-btn" onClick={() => setOpen(true)} aria-label="Open menu"><Icon name="more" /></button>
        <b>{gym.gym_name}</b>
        <span style={{ width: 40 }} />
      </div>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <PillarMark size={42} />
          <div><b>{gym.gym_name}</b><small>Kothri, MP</small></div>
        </div>
        <nav className="nav" aria-label="Main">
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setOpen(false)} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon name={n.icon} /> {n.label}
            </NavLink>
          ))}
          <button onClick={signOut} style={{ marginTop: 'auto' }}><Icon name="logout" /> Log out</button>
        </nav>
        <div className="side-foot">
          <b>{profile?.full_name || profile?.email || (profile?.phone ? '+91 ' + profile.phone : 'Signed in')}</b>
          {profile?.role === 'owner' ? 'Owner' : 'Receptionist'}
        </div>
      </aside>
      <main className="main" key={loc.pathname}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/members" element={<Members />} />
          <Route path="/fees" element={<Fees />} />
          <Route path="/plans" element={<Plans />} />
          <Route path="/renewals" element={<Renewals />} />
          <Route path="/whatsapp" element={<WhatsApp />} />
          <Route path="/reports" element={isOwner ? <Reports /> : <Navigate to="/" replace />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <footer className="footer">
          <span>{gym.gym_name}, {gym.address}</span>
          {gym.instagram && <a href={`https://instagram.com/${gym.instagram.replace('@', '')}`} target="_blank" rel="noreferrer">Instagram @{gym.instagram.replace('@', '')}</a>}
          {gym.owner_instagram && <a href={`https://instagram.com/${gym.owner_instagram.replace('@', '')}`} target="_blank" rel="noreferrer">Owner @{gym.owner_instagram.replace('@', '')}</a>}
        </footer>
      </main>
    </div>
  )
}

function NoAccess() {
  const { profile, session, signOut } = useAuth()
  return (
    <div className="login-form" style={{ minHeight: '100%' }}>
      <div className="login-card">
        <PillarMark size={52} />
        <h2>Waiting for access</h2>
        <p className="muted">
          You are signed in as <b>{profile?.email || (profile?.phone ? '+91 ' + profile.phone : session?.user.email)}</b>, but the owner has not given this
          account access yet. Ask the gym owner to add your mobile number or email under Settings, then sign in again.
        </p>
        <button className="btn dark" onClick={signOut}>Log out</button>
      </div>
    </div>
  )
}

export default function App() {
  const { session, profile, loading, recovery } = useAuth()
  if (!isConfigured) {
    return (
      <div className="login-form" style={{ minHeight: '100%' }}>
        <div className="login-card">
          <h2>Setup needed</h2>
          <p>Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to the <code>.env</code> file, then restart. See README step 4.</p>
        </div>
      </div>
    )
  }
  if (loading) return <Loading text="Opening Pillar Fitness…" />
  if (recovery && session) return <ResetPassword />
  if (!session) return <Login />
  if (!profile || profile.role === 'none' || !profile.active) return <NoAccess />
  return <DataProvider><Shell /></DataProvider>
}
