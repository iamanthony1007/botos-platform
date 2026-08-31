import { useEffect, useState } from 'react'
import '../marketing.css'
import { usePublicScroll } from '../lib/usePublicScroll'
import { useMarketingFonts } from '../lib/useMarketingFonts'
import { AnnouncementStrip } from '../components/PublicHeader'
import { Icon, TrustChips, TrustLine, AuditCta, Stars, VerifiedBadge } from '../components/FunnelShared'
import { HeroCollage, AuditCollage } from '../components/DeviceMockups'
import ornella from '../assets/ornella.jpg'

// The funnel homepage, rebuilt 2026-08-31 from Nella's mockup
// (Mu_Ai_Website_Home_page.png). All marketing copy in this file is her
// client copy, verbatim, including its em dashes; the no-em-dash rule covers
// our prose and comments, not client-authored content rendered on her site.

// ---------- section 4: profile card ----------

// Local time is computed from Europe/Madrid, never faked (briefing 3.4).
function madridTime() {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Europe/Madrid',
  }).format(new Date()).toLowerCase()
}

function useMadridTime() {
  const [time, setTime] = useState(madridTime)
  useEffect(() => {
    const id = setInterval(() => setTime(madridTime()), 30000)
    return () => clearInterval(id)
  }, [])
  return time
}

function ProfileCard() {
  const time = useMadridTime()
  return (
    <section className="mk-section--tight">
      <div className="mk-container">
        <div className="mk-panel" style={{ display: 'flex', flexWrap: 'wrap', gap: 'clamp(18px, 3vw, 34px)', alignItems: 'center', padding: 'clamp(20px, 3vw, 32px)' }}>
          <div style={{ position: 'relative', flex: 'none' }}>
            <img
              src={ornella} alt="Ornella K." loading="lazy" width="112" height="112"
              style={{ width: 'clamp(88px, 10vw, 112px)', height: 'clamp(88px, 10vw, 112px)', borderRadius: '50%', objectFit: 'cover', display: 'block' }}
            />
            <span style={{ position: 'absolute', top: 4, left: 4, width: 16, height: 16, borderRadius: '50%', background: 'var(--mk-green)', border: '2.5px solid #fff' }} />
          </div>
          <div style={{ flex: '1 1 240px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontFamily: 'var(--mk-serif)', fontWeight: 600, fontSize: '1.5rem', color: 'var(--mk-ink)' }}>Ornella K.</span>
              <VerifiedBadge />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: '0.86rem', color: 'var(--mk-body)', marginTop: 4, flexWrap: 'wrap' }}>
              <Icon name="pin" size={14} strokeWidth={2} style={{ color: 'var(--mk-muted)' }} />
              Malaga, Spain
              <span style={{ color: 'var(--mk-muted)' }}>&#8226;</span>
              {time} local time
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: '0.86rem', color: 'var(--mk-body)', marginTop: 4 }}>
              <Icon name="zap" size={14} strokeWidth={2} style={{ color: 'var(--mk-amber)' }} />
              Available now
            </div>
            <div style={{ display: 'flex', gap: 18, marginTop: 12, flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: '0.85rem', fontWeight: 600, color: 'var(--mk-ink)' }}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--mk-blue)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                  <Icon name="check" size={11} strokeWidth={3} />
                </span>
                100% Job Success
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: '0.85rem', fontWeight: 600, color: 'var(--mk-ink)' }}>
                <span style={{ color: 'var(--mk-pink)' }}><Icon name="shield" size={18} strokeWidth={2} /></span>
                Top Rated Plus
              </span>
            </div>
          </div>
          <div style={{ flex: '1 1 300px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 24px', borderLeft: '1px solid var(--mk-border)', paddingLeft: 'clamp(16px, 3vw, 34px)' }}>
            {[
              { v: '$20K+', l: 'Total Earnings', pink: true },
              { v: '10', l: 'Total Jobs', pink: true },
              { v: '890', l: 'Total Hours Worked', pink: true },
              { v: 'Top 3%', l: 'of talent on Upwork', pink: true },
            ].map(s => (
              <div key={s.l}>
                <div style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--mk-pink)', lineHeight: 1.2 }}>{s.v}</div>
                <div style={{ fontSize: '0.82rem', color: 'var(--mk-body)' }}>{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

// ---------- section 5: pain grid ----------

const PAINS = [
  { icon: 'message', text: 'Leads go unanswered or get slow replies.' },
  { icon: 'user-check', text: "Good leads aren't qualified properly." },
  { icon: 'clock', text: 'Follow-ups are inconsistent.' },
  { icon: 'x-circle', text: 'Conversations go cold or die.' },
  { icon: 'calendar', text: 'Less booked calls, less revenue.' },
  { icon: 'frown', text: 'You (or your team) are overwhelmed.' },
]

function SoundFamiliar() {
  return (
    <section className="mk-section">
      <div className="mk-container" style={{ textAlign: 'center' }}>
        <h2 className="mk-h2">Sound familiar?</h2>
        <p style={{ margin: 0, color: 'var(--mk-body)' }}>Leads are coming in... but results aren&#39;t.</p>
        <div className="mk-pain-grid">
          {PAINS.map(p => (
            <div className="mk-pain" key={p.text}>
              <span className="mk-pain-icon"><Icon name={p.icon} size={30} strokeWidth={1.6} /></span>
              <span className="mk-pain-text">{p.text}</span>
            </div>
          ))}
        </div>
        <div className="mk-callout" style={{ textAlign: 'left' }}>
          <span style={{ color: 'var(--mk-amber)', flex: 'none', paddingTop: 2 }}><Icon name="warning" size={22} strokeWidth={2} /></span>
          <span>
            If you have a hunch that you have good leads but aren&#39;t getting enough calls,
            it&#39;s not a lead problem, it&#39;s a <strong style={{ color: 'var(--mk-pink-text)' }}>DM process problem.</strong>
          </span>
        </div>
      </div>
    </section>
  )
}

// ---------- section 6: revenue calculator ----------

// Formula per the briefing: leads x (percent / 100) x average sale.
// Defaults 100 / 60% / $2,000 = $120,000. Inputs sanitize to digits, so the
// math can never see NaN; empty fields simply compute as zero.
const fmtUsd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const fmtNum = new Intl.NumberFormat('en-US')

// Secondary line under the headline result, per Nella's 2026-08-31 answer:
// the realistically recoverable share of the leakage. The copy derives its
// percentage from this constant, so changing the rate keeps them in step.
const RECOVERY_RATE = 0.25

function digitsOnly(s, max) {
  const n = s.replace(/[^0-9]/g, '').slice(0, 9)
  if (n === '') return ''
  return String(Math.min(Number(n), max))
}

function Calculator() {
  const [leads, setLeads] = useState('100')
  const [pct, setPct] = useState('60')
  const [sale, setSale] = useState('2000')

  const lost = Number(leads || 0) * (Number(pct || 0) / 100) * Number(sale || 0)

  const field = (label, value, onChange, { prefix, suffix, max, ariaLabel }) => (
    <div className="mk-calc-field">
      <div className="mk-calc-label">{label}</div>
      <div className="mk-calc-inputwrap">
        {prefix && <span className="mk-calc-affix" style={{ left: 14 }}>{prefix}</span>}
        <input
          className="mk-input"
          style={{ paddingLeft: prefix ? 30 : 16, paddingRight: suffix ? 34 : 16 }}
          inputMode="numeric"
          aria-label={ariaLabel}
          value={value === '' ? '' : fmtNum.format(Number(value))}
          onChange={e => onChange(digitsOnly(e.target.value, max))}
        />
        {suffix && <span className="mk-calc-affix" style={{ right: 14 }}>{suffix}</span>}
      </div>
    </div>
  )

  return (
    <section className="mk-section--tight">
      <div className="mk-container">
        <div className="mk-panel mk-calc">
          <div>
            <h2 className="mk-h3" style={{ fontSize: 'clamp(1.4rem, 2.6vw, 1.8rem)' }}>
              How much <span className="mk-accent">revenue</span> is your{' '}
              <span className="mk-accent">DM leakage</span> costing you?
            </h2>
            <p style={{ margin: '10px 0 0', fontSize: '0.9rem' }}>See your potential lost revenue in just 30 seconds.</p>
          </div>
          <div>
            <div className="mk-calc-row">
              {field('New leads in DMs per month', leads, setLeads, { max: 1000000, ariaLabel: 'New leads in DMs per month' })}
              <span className="mk-calc-op" aria-hidden="true">&#215;</span>
              {field('% not converting to booked call', pct, setPct, { suffix: '%', max: 100, ariaLabel: 'Percent not converting to booked call' })}
              <span className="mk-calc-op" aria-hidden="true">&#215;</span>
              {field('Your average sale', sale, setSale, { prefix: '$', max: 10000000, ariaLabel: 'Your average sale in dollars' })}
              <span className="mk-calc-op" aria-hidden="true">=</span>
              <div className="mk-calc-field mk-calc-field--result">
                <div className="mk-calc-label">Potential revenue you&#39;re losing</div>
                <div className="mk-calc-result-value" aria-live="polite">
                  {fmtUsd.format(Math.round(lost))}
                  <div className="mk-calc-result-unit">/month</div>
                </div>
              </div>
            </div>
            <div className="mk-calc-recover">
              Realistically recoverable: <strong>{fmtUsd.format(Math.round(lost * RECOVERY_RATE))}/month</strong>, based
              on winning back just {Math.round(RECOVERY_RATE * 100)}% of those lost conversations.
            </div>
            <div className="mk-calc-hint">
              <Icon name="refresh" size={16} strokeWidth={2.2} />
              Adjust the numbers to see your potential lost revenue
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ---------- section 8: what you get ----------

const GET_CARDS = [
  { icon: 'search', title: 'Full DM Funnel Audit', text: "Complete review of your DMs and identify where you're losing leads." },
  { icon: 'bar-chart', title: 'Revenue Leakage Report', text: "See exactly how much revenue you're leaking (and how much it's costing you)." },
  { icon: 'target', title: 'Action Plan', text: 'Step-by-step plan to fix the leaks and start booking more calls.' },
  { icon: 'video', title: 'DM Performance Review', text: "I'll review your team's responses, messaging and follow-up flow." },
  // Figure confirmed by Nella 2026-08-31: the credit matches the $97 price,
  // not the mockup's $297.
  { icon: 'gift', title: '$97 Credit', text: 'This audit cost will be credited toward our full offer if we work together.' },
  // Card six replaced per Nella's 2026-08-31 answer (was "100% Actionable").
  { icon: 'phone', title: 'A Strategy Call', text: "I'll break down what the issue is so you know exactly what to do next." },
]

function WhatYouGet() {
  return (
    <section className="mk-section--tight">
      <div className="mk-container">
        <h2 className="mk-h2" style={{ textAlign: 'center' }}>What you get with your DM Revenue Audit</h2>
        <div className="mk-get-grid">
          {GET_CARDS.map(c => (
            <div className="mk-get-card" key={c.title}>
              <span className="mk-get-icon"><Icon name={c.icon} size={30} strokeWidth={1.7} /></span>
              <div className="mk-get-title">{c.title}</div>
              <div className="mk-get-text">{c.text}</div>
            </div>
          ))}
        </div>
        <div className="mk-creditline">
          <span style={{ color: 'var(--mk-stars)' }}><Icon name="star" size={16} strokeWidth={0} style={{ fill: 'currentColor' }} /></span>
          Audit cost will be used as a credit toward our full DM Booking System.
        </div>
      </div>
    </section>
  )
}

// ---------- section 10: testimonials ----------

// Verbatim from the mockup, highlight spans included. Quotes are arrays of
// [text, highlighted] segments so the yellow marks land exactly as drawn.
const TESTIMONIALS = [
  {
    role: 'Sales Expert for High Performance Business',
    dates: 'Jan 26, 2026 - Jul 15, 2026',
    quote: [
      ['"', false],
      ['Nella is the only person who has actually helped us generate a sale.', true],
      [' Her approach ', false],
      ['works,', true],
      [' and I’m genuinely grateful for the contribution she made."', false],
      ['\nI would happily hire Nella again in a heartbeat when we have the workload to support it."', false],
    ],
  },
  {
    role: 'DM Sales Process Optimization Specialist',
    dates: 'Jan 14, 2026 - May 4, 2026',
    quote: [
      ['"', false],
      ['Nella really helped move our sales process forward in a meaningful way', true],
      [' and am looking ', false],
      ['forward', true],
      [' to collaborating again with her in ', false],
      ['the future.', true],
      ['"', false],
      ['\nReally appreciated her ability to hop in and be effective immediately, participate and lead calls, help set the overall strategy."', false],
    ],
  },
  {
    role: 'Instagram DM Setter (Warm Leads, Scripted, Low-Ticket Challenge + Group Coaching)',
    dates: 'Mar 12, 2026 - Mar 23, 2026',
    quote: [
      ['"', false],
      ['Nella is incredibly helpful. She spent so much time and energy listening to what I needed. Her expertise is unmatched, and her processes are highly converting. And she’s pretty cool.', true],
      ['"', false],
    ],
  },
  {
    role: 'Trial Booking & Membership Sales',
    dates: 'Aug 14, 2025 - Aug 28, 2025',
    quote: [
      ['"', false],
      ['Extremely professional and did her work to the best degree possible. We learned a lot with her and would love to have her on our team long term.', true],
      ['"', false],
    ],
  },
]

function Testimonials() {
  return (
    <section className="mk-section--tight">
      <div className="mk-container">
        <div className="mk-testi-grid">
          {TESTIMONIALS.map(t => (
            <div className="mk-testi" key={t.role}>
              <div className="mk-testi-toprow">
                <Stars gold size="0.9rem" />
                <span className="mk-testi-score">5.0</span>
              </div>
              <div className="mk-testi-role">{t.role}</div>
              <div className="mk-testi-dates">{t.dates}</div>
              <div className="mk-testi-quote">
                {t.quote.map(([text, hl], i) =>
                  text.startsWith('\n')
                    ? <span key={i}><br />{hl ? <mark>{text.slice(1)}</mark> : text.slice(1)}</span>
                    : (hl ? <mark key={i}>{text}</mark> : <span key={i}>{text}</span>)
                )}
              </div>
              <div className="mk-testi-tag">&#8212; Endorsed by client</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ---------- page ----------

export default function Landing() {
  usePublicScroll()
  useMarketingFonts()

  return (
    <div className="mk-page">
      <AnnouncementStrip />

      <main>

      {/* 2. hero */}
      <section className="mk-hero">
        <div className="mk-container mk-split">
          <div>
            <span className="mk-badge">
              <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--mk-pink)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                <Icon name="star" size={11} strokeWidth={0} style={{ fill: 'currentColor' }} />
              </span>
              Top Rated Plus on Upwork
            </span>
            <h1 className="mk-h1" style={{ marginTop: 20 }}>
              There are clinics getting only <span className="mk-accent">20 DMs</span> a day and
              making <span className="mk-accent">$50K</span> a month.
            </h1>
            <p className="mk-serif-italic" style={{ fontSize: 'clamp(1.2rem, 2.4vw, 1.55rem)', lineHeight: 1.4, color: 'var(--mk-ink)', margin: '0 0 26px' }}>
              <span className="mk-accent">So why</span> are some clinics converting and{' '}
              <span className="mk-accent">yours isn&#39;t?</span>
            </p>
            <AuditCta />
            <div style={{ marginTop: 20 }}><TrustChips /></div>
            <div style={{ marginTop: 22 }}>
              <TrustLine>Trusted by businesses to turn conversations into booked calls.</TrustLine>
            </div>
          </div>
          <div className="mk-hero-visual mk-split-visual">
            <HeroCollage />
          </div>
        </div>
      </section>

      {/* 3. you have leads */}
      <section className="mk-section--tight">
        <div className="mk-container mk-split mk-split--visual-first-mobile">
          <div className="mk-split-visual">
            <div className="mk-panel" style={{ padding: 'clamp(18px, 3vw, 30px)' }}>
              <AuditCollage />
            </div>
          </div>
          <div>
            <h2 className="mk-h2">You have leads in your DMs.</h2>
            <p className="mk-serif-italic" style={{ fontSize: 'clamp(1.15rem, 2.2vw, 1.5rem)', lineHeight: 1.4, color: 'var(--mk-pink-text)', margin: '0 0 18px' }}>
              You just aren&#39;t prioritizing the right ones{' '}
              <span style={{ color: 'var(--mk-ink)' }}>consistently.</span>
            </p>
            <p className="mk-body-lg" style={{ margin: '0 0 24px' }}>
              Most conversations look the same on the surface, but the ones that get turned
              into real buyers have subtle signals most people miss.
            </p>
            <AuditCta />
            <div style={{ marginTop: 20 }}><TrustChips /></div>
            <div style={{ marginTop: 22 }}>
              <TrustLine>Trusted by businesses to turn conversations into booked calls.</TrustLine>
            </div>
          </div>
        </div>
      </section>

      {/* 4. profile card */}
      <ProfileCard />

      {/* 5. sound familiar */}
      <SoundFamiliar />

      {/* 6. calculator */}
      <Calculator />

      {/* 7. i'll audit your DMs */}
      <section className="mk-section">
        <div className="mk-container mk-split mk-split--visual-first-mobile">
          <div className="mk-split-visual">
            <AuditCollage />
          </div>
          <div>
            <h2 className="mk-h2">I&#39;ll audit your DMs and show you exactly what&#39;s costing you sales.</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '18px 0 26px' }}>
              {[
                'I review your DM conversations',
                "I identify where you're losing leads",
                'I show you what to fix (clearly)',
                'I give you a prioritized action plan',
                "You'll know exactly what to do next",
              ].map(item => (
                <span key={item} style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600, color: 'var(--mk-ink)', fontSize: '0.98rem' }}>
                  <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--mk-pink)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flex: 'none' }}>
                    <Icon name="check" size={12} strokeWidth={3} />
                  </span>
                  {item}
                </span>
              ))}
            </div>
            <AuditCta />
            <div style={{ marginTop: 20 }}><TrustChips /></div>
            <div style={{ marginTop: 22 }}>
              <TrustLine>
                <span className="mk-accent">50+</span> businesses have fixed their DMs and increased their bookings.
              </TrustLine>
            </div>
          </div>
        </div>
      </section>

      {/* 8 + 9. what you get, credit note */}
      <WhatYouGet />

      {/* 10. testimonials */}
      <Testimonials />

      {/* 11. footer cta strip */}
      <section className="mk-footer-cta">
        <div className="mk-container mk-footer-grid">
          <span style={{ color: 'var(--mk-pink)' }}><Icon name="calendar" size={40} strokeWidth={1.6} /></span>
          <div className="mk-footer-heading">
            Stop leaving money in your DMs.<br />
            Let&#39;s turn your conversations into booked appointments.
          </div>
          <AuditCta />
          <TrustChips stack />
        </div>
      </section>

      </main>

      <div className="mk-copyright">MU AI &copy; 2026</div>
    </div>
  )
}
