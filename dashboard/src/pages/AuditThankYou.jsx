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
// Per Nella's 2026-08-31 answer, this page IS the delivery mechanism: it
// renders her full audit instructions so fulfilment works from day one,
// before any email automation exists (that automation is Phase 2, scoped in
// docs/funnel-site-build-report.md).
//
// TODO(INSTRUCTIONS): populate AUDIT_INSTRUCTIONS from the audit-instructions
// docx Anthony is forwarding, verbatim; it has not arrived yet. Each entry is
// one section: { title, paragraphs: [..], bullets: [..] } (either list may be
// omitted). Until it lands the page renders the confirmation shell alone, so
// nothing invented ever ships. Filling the array below is the entire change.
const AUDIT_INSTRUCTIONS = []

function InstructionsSection({ section, index }) {
  return (
    <div style={{ marginBottom: 26 }}>
      <h2 style={{ fontFamily: 'var(--mk-serif)', fontWeight: 600, color: 'var(--mk-ink)', fontSize: '1.25rem', margin: '0 0 10px', display: 'flex', gap: 12, alignItems: 'baseline' }}>
        <span style={{ color: 'var(--mk-pink)', fontSize: '1rem', fontWeight: 700, flex: 'none' }}>{index + 1}.</span>
        {section.title}
      </h2>
      {(section.paragraphs || []).map((p, i) => (
        <p key={i} style={{ margin: '0 0 10px', fontSize: '0.92rem', lineHeight: 1.7 }}>{p}</p>
      ))}
      {section.bullets && (
        <ul style={{ margin: '0 0 10px', paddingLeft: 22, fontSize: '0.92rem', lineHeight: 1.7 }}>
          {section.bullets.map((b, i) => <li key={i}>{b}</li>)}
        </ul>
      )}
    </div>
  )
}

export default function AuditThankYou() {
  usePublicScroll()
  useMarketingFonts()
  const navigate = useNavigate()

  const hasInstructions = AUDIT_INSTRUCTIONS.length > 0

  return (
    <div className="mk-page mk-page--blush">
      <PublicHeader right="home" />
      <main className="mk-container">
        <div className="mk-card mk-ty-card" style={hasInstructions ? { textAlign: 'left', maxWidth: 720 } : undefined}>
          <div style={{ textAlign: 'center' }}>
            <span style={{ width: 58, height: 58, borderRadius: '50%', background: 'var(--mk-pink-soft)', color: 'var(--mk-pink-deep)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px' }}>
              <Icon name="check" size={28} strokeWidth={3} />
            </span>
            <h1 className="mk-h2" style={{ marginBottom: 10 }}>Thank you!</h1>
            <p className="mk-body-lg" style={{ margin: hasInstructions ? '0 0 34px' : '0 0 26px' }}>
              {hasInstructions
                ? 'Your DM Revenue Audit order is confirmed. Everything you need to do next is right here on this page.'
                : 'Your DM Revenue Audit order is confirmed. A receipt is on its way to your email, along with what happens next.'}
            </p>
          </div>

          {hasInstructions && (
            <div style={{ borderTop: '1px solid var(--mk-border)', paddingTop: 28 }}>
              {AUDIT_INSTRUCTIONS.map((s, i) => (
                <InstructionsSection key={s.title} section={s} index={i} />
              ))}
            </div>
          )}

          <div style={{ textAlign: 'center' }}>
            <button className="mk-btn mk-btn--pill" onClick={() => navigate('/')}>
              Back to Home
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
