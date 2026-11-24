import { Link } from 'react-router-dom'
import { inr } from '../lib/format'
import { useData } from '../data'
import { Empty, PageHead } from '../components/ui'

export default function Plans() {
  const { plans, isOwner } = useData()
  const active = plans.filter((p) => p.active)
  const one = active.find((p) => p.months === 1)

  return (
    <>
      <PageHead title="Membership plans" sub="Prices shown here are what new members and renewals are charged."
        actions={isOwner ? <Link className="btn dark" to="/settings?tab=plans">Change prices</Link> : undefined} />
      {!active.length ? <Empty title="No plans yet" hint="The owner can add plans in Settings." /> : (
        <div className="grid3">
          {active.map((p) => {
            const rows = [{ who: 'Men', price: Number(p.price_men), one: one ? Number(one.price_men) : null }, { who: 'Women', price: Number(p.price_women), one: one ? Number(one.price_women) : null }]
            return (
              <section className="card" key={p.id}>
                <h2>{p.name}</h2>
                <div className="stack" style={{ marginTop: 14 }}>
                  {rows.map((r) => {
                    const save = r.one && p.months > 1 ? r.one * p.months - r.price : 0
                    return (
                      <div key={r.who}>
                        <div className="row between"><span className="muted">{r.who}</span><b style={{ fontFamily: 'var(--display)', fontSize: '1.9rem' }}>{inr(r.price)}</b></div>
                        <div className="muted sm-text">{inr(Math.round(r.price / p.months))} a month{save > 0 ? ` · you save ${inr(save)} compared with paying monthly` : ''}</div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      )}
      <p className="muted sm-text" style={{ marginTop: 16 }}>Members keep the price they originally paid, even after prices change.</p>
    </>
  )
}
