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
// docs/funnel-site-build-report.md, and must reuse AuditInstructions'
// content for the buyer email so page and email cannot drift).
//
// The content below is transcribed verbatim from her document
// "Getting Your DM Messages to Me (Before Our Call).docx" (received
// 2026-09-01). It is client copy: edit only against a new version of hers.

function SectionTitle({ children }) {
  return (
    <h2 style={{ fontFamily: 'var(--mk-serif)', fontWeight: 600, color: 'var(--mk-ink)', fontSize: '1.2rem', margin: '26px 0 10px' }}>
      {children}
    </h2>
  )
}

function P({ children }) {
  return <p style={{ margin: '0 0 12px', fontSize: '0.92rem', lineHeight: 1.7 }}>{children}</p>
}

export function AuditInstructions() {
  return (
    <div>
      <h1 style={{ fontFamily: 'var(--mk-serif)', fontWeight: 600, color: 'var(--mk-ink)', fontSize: '1.45rem', lineHeight: 1.3, margin: '0 0 12px' }}>
        Getting Your DM Messages to Me (Before Our Call)
      </h1>
      <P>
        Takes about 2 minutes on your end. No passwords, no login shared, no one added
        to your account. You&#39;re just requesting a copy of your own DM messages from
        Instagram and sending me the file, nothing else.
      </P>

      <SectionTitle>Step by step (exporting messages only, not your full Instagram data)</SectionTitle>
      <ol className="mk-ty-steps">
        <li>Open Instagram (app or desktop) and go to <strong>Settings</strong></li>
        <li>Tap <strong>Meta Accounts Center</strong> (near the top)</li>
        <li>Tap <strong>Your information and permissions</strong></li>
        <li>Tap <strong>Export your information</strong> (may show as &quot;Download your information&quot;)</li>
        <li>Select your Instagram account</li>
        <li>Choose <strong>&quot;Some of your information&quot;</strong>, this is the important part, do not choose the full account export</li>
        <li>When the category list appears, select <strong>only Messages</strong>. Deselect everything else, posts, stories, photos, none of that is needed</li>
        <li>Pick a date range, last 90 days is usually enough for the audit, or all time if you want the fullest picture</li>
        <li>Choose format: <strong>JSON</strong> (this is the one I need, don&#39;t pick HTML)</li>
        <li>Request the download</li>
      </ol>
      <P>
        Instagram will email you a download link. This usually takes a few hours,
        sometimes up to 48. Download the ZIP file when it arrives, it will contain
        your DM history only, and send it to me.
      </P>
      <P>
        <strong>Video walkthrough for exporting your DM messages specifically:</strong>{' '}
        <a
          className="mk-ty-link"
          href="https://www.youtube.com/watch?v=xBL9AwQ3IyU"
          target="_blank"
          rel="noopener noreferrer"
        >
          https://www.youtube.com/watch?v=xBL9AwQ3IyU
        </a>
      </P>

      <SectionTitle>What happens after you send it</SectionTitle>
      <P>
        I go through your real conversations and put together your DM Revenue Audit:
        your revenue leakage number, the specific patterns causing lost bookings, a
        rewritten script based on your own conversations, and a few fixes you can use
        immediately.
      </P>
      <P>
        Once that&#39;s done, we&#39;ll get on a short call so I can walk you through
        exactly what I found and what I&#39;d recommend from there. That call happens
        after the analysis, not before, so by the time we talk, I already know your
        business and we can go straight into what actually matters.
      </P>
    </div>
  )
}

export default function AuditThankYou() {
  usePublicScroll()
  useMarketingFonts()
  const navigate = useNavigate()

  return (
    <div className="mk-page mk-page--blush">
      <PublicHeader right="home" />
      <main className="mk-container">
        <div className="mk-card mk-ty-card" style={{ textAlign: 'left', maxWidth: 720 }}>
          <div style={{ textAlign: 'center' }}>
            <span style={{ width: 58, height: 58, borderRadius: '50%', background: 'var(--mk-pink-soft)', color: 'var(--mk-pink-deep)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px' }}>
              <Icon name="check" size={28} strokeWidth={3} />
            </span>
            <h1 className="mk-h2" style={{ marginBottom: 10 }}>Thank you!</h1>
            <p className="mk-body-lg" style={{ margin: '0 0 34px' }}>
              Your DM Revenue Audit order is confirmed. Everything you need to do next
              is right here on this page.
            </p>
          </div>

          <div style={{ borderTop: '1px solid var(--mk-border)', paddingTop: 28 }}>
            <AuditInstructions />
          </div>

          <div style={{ textAlign: 'center', marginTop: 30 }}>
            <button className="mk-btn mk-btn--pill" onClick={() => navigate('/')}>
              Back to Home
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
