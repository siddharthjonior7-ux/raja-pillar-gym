import { FormEvent, useState } from 'react'
import { supabase } from '../lib/supabase'
import { errMsg } from '../lib/api'
import { Field, ErrorBox } from '../components/ui'
import { PillarMark } from '../components/icons'
import { useAuth } from '../auth'

function Art() {
  return (
    <section className="login-art">
      <div className="row" style={{ position: 'relative' }}>
        <PillarMark size={44} />
        <span className="muted" style={{ color: '#8c93a0' }}>Kothri, Madhya Pradesh</span>
      </div>
      <div>
        <h1>PILLAR<br />FITNESS</h1>
        <p>Members, fees and reminders for the front desk. Everything saved, every rupee counted.</p>
      </div>
      <div className="cols" aria-hidden="true">
        <div className="col" style={{ height: 150 }} />
        <div className="col hot" style={{ height: 250 }} />
        <div className="col" style={{ height: 190 }} />
        <div className="col" style={{ height: 120 }} />
      </div>
    </section>
  )
}

type EmailMode = 'login' | 'signup' | 'forgot'

export default function Login() {
  return (
    <div className="login">
      <Art />
      <section className="login-form">
        <div className="login-card">
          <h2>Log in</h2>
          <EmailLogin />
          <p className="muted sm-text">Only people added by the owner can use this app. Gym members never need to log in.</p>
        </div>
      </section>
    </div>
  )
}

function EmailLogin() {
  const [m, setM] = useState<EmailMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setErr(null); setInfo(null)
    if (!/^\S+@\S+\.\S+$/.test(email)) return setErr('Enter a valid email address.')
    if (m !== 'forgot' && password.length < 8) return setErr('Password must be at least 8 characters.')
    setBusy(true)
    try {
      if (m === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else if (m === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } })
        if (error) throw error
        if (!data.session) setInfo('Check your email and open the confirmation link, then log in here.')
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
        if (error) throw error
        setInfo('If this email has an account, a reset link is on its way.')
      }
    } catch (e) {
      const msg = errMsg(e)
      setErr(/invalid login/i.test(msg) ? 'Wrong email or password.' : /already registered/i.test(msg) ? 'This email already has an account. Log in instead.' : /confirm/i.test(msg) ? 'Confirm your email first. Check your inbox.' : msg)
    }
    setBusy(false)
  }

  return (
    <form className="stack" onSubmit={submit}>
      {m === 'signup' && <Field label="Your name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>}
      <Field label="Email"><input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      {m !== 'forgot' && (
        <Field label="Password" hint={m === 'signup' ? 'At least 8 characters' : undefined}>
          <input className="input" type="password" autoComplete={m === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
      )}
      {err && <ErrorBox msg={err} />}
      {info && <div className="notice">{info}</div>}
      <button className="btn primary block" disabled={busy}>
        {busy ? 'Please wait…' : m === 'login' ? 'Log in' : m === 'signup' ? 'Create account' : 'Send reset link'}
      </button>
      {m === 'login' && <button type="button" className="linkbtn" onClick={() => { setM('forgot'); setErr(null) }}>Forgot password?</button>}
      <button type="button" className="linkbtn" onClick={() => { setM(m === 'signup' ? 'login' : m === 'login' ? 'signup' : 'login'); setErr(null); setInfo(null) }}>
        {m === 'login' ? 'New here? Create an account' : 'Back to log in'}
      </button>
    </form>
  )
}

export function ResetPassword() {
  const { clearRecovery } = useAuth()
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function save(e: FormEvent) {
    e.preventDefault()
    if (pw.length < 8) return setErr('Password must be at least 8 characters.')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) return setErr(errMsg(error))
    clearRecovery()
  }
  return (
    <div className="login">
      <Art />
      <section className="login-form">
        <form className="login-card" onSubmit={save}>
          <h2>Choose a new password</h2>
          <Field label="New password" error={err}><input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus /></Field>
          <button className="btn primary block" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
        </form>
      </section>
    </div>
  )
}
