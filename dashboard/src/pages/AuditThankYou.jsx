import { useNavigate } from 'react-router-dom'
import '../marketing.css'
import { usePublicScroll } from '../lib/usePublicScroll'
import { useMarketingFonts } from '../lib/useMarketingFonts'
import PublicHeader from '../components/PublicHeader'
import { Icon } from '../components/FunnelShared'

// Post-purchase page for the DM Revenue Audit. Stripe's Payment Link sends
// buyers here (success URL https://getmu.co/audit/thank-you, configured on
// Stripe's side).
//
// SHELL ONLY, deliberately: what happens after purchase (intake form, booking
// link, or email-only) is pending Nella's fulfilment answer. The copy below is
// provisional and kept to what is always true: the order went through and
// Stripe emails a receipt. Do not add an intake or booking element here until
// her answer arrives (briefing 5).
export default function AuditThankYou() {
  usePublicScroll()
  useMarketingFonts()
  const navigate = useNavigate()

  return (
    <div className="mk-page mk-page--blush">
      <PublicHeader right="home" />
      <div className="mk-container">
        <div className="mk-card mk-ty-card">
          <span style={{ width: 58, height: 58, borderRadius: '50%', background: 'var(--mk-pink-soft)', color: 'var(--mk-pink-deep)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px' }}>
            <Icon name="check" size={28} strokeWidth={3} />
          </span>
          <h1 className="mk-h2" style={{ marginBottom: 10 }}>Thank you!</h1>
          <p className="mk-body-lg" style={{ margin: '0 0 26px' }}>
            Your DM Revenue Audit order is confirmed. A receipt is on its way to
            your email, along with what happens next.
          </p>
          <button className="mk-btn mk-btn--pill" onClick={() => navigate('/')}>
            Back to Home
          </button>
        </div>
      </div>
    </div>
  )
}
