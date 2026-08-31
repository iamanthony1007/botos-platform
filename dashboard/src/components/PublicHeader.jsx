import { useNavigate } from 'react-router-dom'

// The golden rabbit icon, wordmark removed, per Nella's instruction. This is
// the repo's own icon asset (favicon.png is the rabbit alone); the rabbit
// drawn in the mockups and the mockup "Moo" wordmark are NOT used.
const RABBIT = '/favicon.png'

function ArrowRight() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="4" y1="12" x2="20" y2="12" /><polyline points="13 5 20 12 13 19" />
    </svg>
  )
}

function ArrowLeft() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="20" y1="12" x2="4" y2="12" /><polyline points="11 5 4 12 11 19" />
    </svg>
  )
}

// Shared header for the public funnel pages (waitlist, audit, thank-you).
// The homepage uses AnnouncementStrip alone, matching its mockup, which has
// no logo row. Log in stays reachable but understated, per the briefing.
//
// right:
//   'waitlist'  renders JOIN THE WAITLIST -> /waitlist (mockup's own header CTA)
//   'form'      renders JOIN THE WAITLIST scrolling to #save-your-spot
//               (used on /waitlist itself, where routing to /waitlist is a no-op)
//   'home'      renders BACK TO HOME -> /
export default function PublicHeader({ right = 'waitlist' }) {
  const navigate = useNavigate()

  function scrollToForm() {
    const el = document.getElementById('save-your-spot')
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <header className="mk-header">
      <button className="mk-logo-btn" onClick={() => navigate('/')} aria-label="Home">
        <img src={RABBIT} alt="" />
      </button>
      <div className="mk-header-right">
        <button className="mk-login-link" onClick={() => navigate('/login')}>Log in</button>
        {right === 'waitlist' && (
          <button className="mk-header-cta" onClick={() => navigate('/waitlist')}>
            Join the Waitlist <ArrowRight />
          </button>
        )}
        {right === 'form' && (
          <button className="mk-header-cta" onClick={scrollToForm}>
            Join the Waitlist <ArrowRight />
          </button>
        )}
        {right === 'home' && (
          <button className="mk-header-cta mk-header-back" onClick={() => navigate('/')}>
            <ArrowLeft /> Back to Home
          </button>
        )}
      </div>
    </header>
  )
}

// The homepage announcement strip: mockup's top bar. The CTA routes to
// /waitlist; Log in sits at the far edge so it stays reachable without
// competing with the strip message.
export function AnnouncementStrip() {
  const navigate = useNavigate()
  return (
    <div className="mk-strip">
      <span aria-hidden="true" style={{ color: 'var(--mk-pink)', fontSize: '0.9rem' }}>&#10022;</span>
      <span className="mk-strip-text">Turn your existing DMs into more sales.</span>
      <button className="mk-strip-cta" onClick={() => navigate('/waitlist')}>
        Join the Waitlist <ArrowRight />
      </button>
      <button className="mk-login-link mk-strip-login" onClick={() => navigate('/login')}>
        Log in
      </button>
    </div>
  )
}
