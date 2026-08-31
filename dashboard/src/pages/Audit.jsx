import '../marketing.css'
import { usePublicScroll } from '../lib/usePublicScroll'
import { useMarketingFonts } from '../lib/useMarketingFonts'
import PublicHeader from '../components/PublicHeader'
import { Icon } from '../components/FunnelShared'
import { AuditPapers } from '../components/DeviceMockups'
import ornella from '../assets/ornella.jpg'

// The $97 DM Revenue Audit page, built 2026-08-31 from the right page of
// Nella's Call_to_Action_buttons_where_they_lead_to.png mockup. All marketing
// copy is her client copy, verbatim, em dashes included.

// TODO(STRIPE): Nella supplies the Stripe Payment Link. Paste it here and the
// button goes live; that is the entire change. Until then the button renders
// disabled as "Checkout coming soon" so the preview stays honest. The Payment
// Link's success URL must be set (on Stripe's side, by Nella) to:
//   https://getmu.co/audit/thank-you
// No payment code and no Stripe keys live on our side; Stripe hosts checkout.
const STRIPE_PAYMENT_LINK = ''

const INCLUDED = [
  { title: 'Revenue Leakage Analysis', text: "Find out where potential sales opportunities are being lost inside your DMs (and what's causing it)." },
  { title: 'Conversation Breakdown', text: "See the exact stages where prospects stop responding, lose interest, or don't move toward a call." },
  { title: 'Real Conversation Examples', text: "Get examples from your DMs showing what worked, what didn't, and what I'd do differently." },
  { title: 'Response & Objection Analysis', text: "Identify key questions, objections, or missed moments — with examples of how I'd handle them." },
  { title: 'DM Performance Review', text: "Whether you're managing your DMs or have a setter, I'll find the biggest opportunities to improve." },
  { title: 'Priority Fixes', text: 'The 2–3 highest-impact changes I recommend making first to increase booked calls and revenue.' },
  { title: 'Findings & Strategy Call', text: "We'll go through the audit together, break down the biggest opportunities, and map out exactly what to do next." },
]

const WALKAWAY = [
  'A full DM audit report (45+ pages)',
  'Clear, actionable next steps',
  'Real examples from your DMs',
  'A tailored strategy for your business',
  'A 1:1 strategy call (30 mins)',
]

function PinkCheck({ size = 26 }) {
  return (
    <span style={{ width: size, height: size, borderRadius: '50%', background: 'var(--mk-pink-soft)', color: 'var(--mk-pink-deep)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
      <Icon name="check" size={size * 0.5} strokeWidth={3} />
    </span>
  )
}

export default function Audit() {
  usePublicScroll()
  useMarketingFonts()

  const live = Boolean(STRIPE_PAYMENT_LINK)

  return (
    <div className="mk-page mk-page--blush">
      <PublicHeader right="home" />

      <main className="mk-container">
        {/* hero */}
        <div className="mk-audit-hero">
          <div>
            <span className="mk-badge mk-badge--outline">DM Audit</span>
            <h1 className="mk-h1" style={{ marginTop: 20 }}>Get Your DM Revenue Audit &#8212; $97</h1>
            <p className="mk-body-lg" style={{ margin: '0 0 26px', fontSize: 'clamp(1rem, 1.8vw, 1.15rem)' }}>
              Find out exactly where you&#39;re losing sales in your DMs and get a clear
              plan to fix it and know exactly how to fix it.
            </p>

            <div className="mk-card mk-price-card">
              <div className="mk-price-row">
                <span className="mk-price-label">
                  <span style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--mk-pink)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--mk-pink)' }} />
                  </span>
                  One-time payment
                </span>
                <span className="mk-price-amount">$97.00 USD</span>
              </div>
              {live ? (
                <a className="mk-btn mk-btn--pill" style={{ width: '100%' }} href={STRIPE_PAYMENT_LINK}>
                  Pay $97 and Get My Audit
                  <Icon name="arrow-right" size={17} strokeWidth={2.4} />
                </a>
              ) : (
                <button className="mk-btn mk-btn--pill" style={{ width: '100%' }} disabled>
                  Checkout coming soon
                </button>
              )}
              <div className="mk-price-secure">
                Secure checkout powered by <span className="mk-stripe-word">stripe</span>
              </div>
            </div>

            <div className="mk-chips" style={{ marginTop: 22, gap: '12px 26px' }}>
              {[
                { icon: 'shield', label: 'In-Depth Analysis' },
                { icon: 'clock', label: 'Delivered in 72 Hours' },
                { icon: 'star', label: 'Actionable Strategy' },
              ].map(c => (
                <span className="mk-chip" key={c.label} style={{ fontSize: '0.86rem' }}>
                  <Icon name={c.icon} size={17} strokeWidth={2} style={{ color: 'var(--mk-pink)' }} />
                  {c.label}
                </span>
              ))}
            </div>
          </div>

          <div className="mk-split-visual">
            <AuditPapers />
          </div>
        </div>

        {/* what's included */}
        <div className="mk-included mk-section--tight">
          <div>
            <h2 className="mk-h2" style={{ marginBottom: 22 }}>What&#39;s Included</h2>
            {INCLUDED.map(item => (
              <div className="mk-inc-item" key={item.title}>
                <PinkCheck />
                <div>
                  <div className="mk-inc-title">{item.title}</div>
                  <div className="mk-inc-text">{item.text}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="mk-panel mk-walkaway" style={{ background: 'var(--mk-pink-wash)' }}>
            <div className="mk-walkaway-title">You&#39;ll walk away with...</div>
            {WALKAWAY.map(w => (
              <div className="mk-walk-item" key={w}>
                <span style={{ color: 'var(--mk-pink)', flex: 'none', paddingTop: 2 }}><Icon name="check" size={16} strokeWidth={3} /></span>
                {w}
              </div>
            ))}
            <hr className="mk-walk-hr" />
            <div className="mk-walk-credit">
              The DM audit cost will be credited back in full if you choose to work with me.
            </div>
            <div className="mk-walk-note">
              Your $97 investment goes toward your full DM management or strategy package.
            </div>
          </div>
        </div>

        {/* outro */}
        <div className="mk-panel mk-audit-outro" style={{ marginBottom: 40 }}>
          <img
            src={ornella} alt="Ornella K." loading="lazy" width="72" height="72"
            style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', flex: 'none' }}
          />
          <div style={{ flex: '1 1 260px' }}>
            <div style={{ fontWeight: 700, color: 'var(--mk-ink)', fontSize: '1.02rem', marginBottom: 4 }}>
              Let&#39;s turn your DMs into booked calls.
            </div>
            <div style={{ fontSize: '0.9rem', color: 'var(--mk-body)', lineHeight: 1.6 }}>
              This audit is the first step to a more consistent<br />and profitable DM strategy.
            </div>
          </div>
          <div style={{ textAlign: 'center', flex: 'none' }}>
            <div className="mk-signature">Ornella K. <span style={{ fontSize: '1rem' }}>&#9825;</span></div>
            <div className="mk-signature-role">DM Expert</div>
          </div>
        </div>
      </main>
    </div>
  )
}
