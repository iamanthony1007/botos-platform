import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

// Reused as-is from Landing.jsx. The constant names there are swapped at source
// (LOGO_STACKED points at the horizontal file); we intentionally match the value
// Landing's hero uses so nothing shifts visually. Do not "fix" the naming here.
const LOGO = 'https://rydkwsjwlgnivlwlvqku.supabase.co/storage/v1/object/public/assets/Logo%20horizontal.png'

const GOLD = '#D4AF37'
const INK = '#18160E'
const DARK = '#1A1A1A'

// Real conversation stages, taken verbatim from sales-bot/src/index.js
// (conversation_stage). Do not invent stage names.
const STAGES = [
  ['HOOK / ENTRY', 'The first DM. Open the conversation and earn a reply.'],
  ['GOAL', 'Find out what they actually want to achieve.'],
  ['DIAGNOSTIC', "Understand where they are now and what is in the way."],
  ['INSIGHT', 'Reframe the problem so the next step is obvious.'],
  ['PRIORITY', 'Establish why acting now matters to them.'],
  ['DECISION', 'Confirm they want to move forward.'],
  ['INVITE', 'Offer the call or the next step.'],
  ['SCHEDULE', 'Lock in a time that works.'],
  ['BOOKED', 'The call is on the calendar.'],
  ['FOLLOW-UP', 'No reply yet? Re-engage later without nagging.']
]

const CAPTIONS = [
  'A lead sends the first DM.',
  'MU AI drafts a reply in seconds and holds it for review.',
  'Your setter approves it. A human stays in the loop.',
  'The reply sends.',
  'No reply after 20 hours, so MU AI follows up on its own.'
]

// The longest caption reserves the caption block height so the card does not
// change height between stages at any viewport width.
const LONGEST_CAPTION = CAPTIONS.reduce((a, b) => (b.length > a.length ? b : a))
const CAPTION_STYLE = { fontSize: '13px', color: '#6A6A5A', lineHeight: 1.5, margin: 0 }

// Local rays component. Extracted so the SVG is not copy-pasted twice; kept in
// this file rather than refactoring Landing.jsx.
function Rays() {
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }} aria-hidden="true">
      <svg width="100%" height="100%" viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="hiw-s1"><feGaussianBlur stdDeviation="18" /></filter>
          <filter id="hiw-s2"><feGaussianBlur stdDeviation="12" /></filter>
        </defs>
        <path d="M -100 700 Q 300 350 900 50" stroke="rgba(245,242,235,0.55)" strokeWidth="140" fill="none" filter="url(#hiw-s1)" />
        <path d="M -150 650 Q 250 320 880 10" stroke="rgba(245,242,235,0.4)" strokeWidth="110" fill="none" filter="url(#hiw-s1)" />
        <path d="M -80 750 Q 350 400 950 120" stroke="rgba(245,242,235,0.45)" strokeWidth="120" fill="none" filter="url(#hiw-s1)" />
        <path d="M -200 600 Q 180 300 850 -20" stroke="rgba(245,242,235,0.3)" strokeWidth="90" fill="none" filter="url(#hiw-s1)" />
        <path d="M -50 780 Q 400 450 980 180" stroke="rgba(245,242,235,0.35)" strokeWidth="100" fill="none" filter="url(#hiw-s1)" />
        <path d="M 50 800 Q 450 500 1000 250" stroke="rgba(245,242,235,0.25)" strokeWidth="80" fill="none" filter="url(#hiw-s2)" />
        <path d="M 150 820 Q 500 540 1020 300" stroke="rgba(245,242,235,0.2)" strokeWidth="70" fill="none" filter="url(#hiw-s2)" />
        <radialGradient id="hiw-cg" cx="52%" cy="44%" r="35%">
          <stop offset="0%" stopColor="#F5F2EC" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#F5F2EC" stopOpacity="0" />
        </radialGradient>
        <rect width="800" height="600" fill="url(#hiw-cg)" />
      </svg>
    </div>
  )
}

function Bubble({ side, revealed, children }) {
  const isRight = side === 'right'
  return (
    <div
      className="hiw-reveal"
      style={{
        display: 'flex',
        justifyContent: isRight ? 'flex-end' : 'flex-start',
        opacity: revealed ? 1 : 0,
        visibility: revealed ? 'visible' : 'hidden',
        transform: revealed ? 'none' : 'translateY(8px)'
      }}
    >
      <div style={{ maxWidth: '80%' }}>{children}</div>
    </div>
  )
}

function DmThread() {
  const [stage, setStage] = useState(1)
  const atEnd = stage >= 5

  // Reply bubble visual state resolves from pending draft to approved to sent.
  const replyPending = stage === 2
  const replyApproved = stage >= 3

  const replyBubbleStyle = replyPending
    ? { background: '#FBF7EA', border: `1.5px dashed ${GOLD}`, color: '#3A3A2A' }
    : { background: DARK, border: `1.5px solid ${DARK}`, color: '#fff' }

  return (
    <div
      role="group"
      aria-label="Interactive demo: how MU AI handles a DM"
      style={{
        background: '#fff', border: '1px solid #E8E6DE', borderRadius: '16px',
        boxShadow: '0 4px 24px rgba(0,0,0,.07)', padding: '18px', maxWidth: '460px',
        margin: '0 auto', width: '100%'
      }}
    >
      {/* Thread header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', paddingBottom: '14px', borderBottom: '1px solid #EFEDE6' }}>
        <div style={{
          width: '38px', height: '38px', borderRadius: '50%', background: '#EAE6DA',
          color: '#7A7460', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '13px', fontWeight: 700, flexShrink: 0
        }}>MG</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: DARK }}>@mike.plays.golf</div>
          <div style={{ fontSize: '12px', color: '#9A9A8A' }}>Instagram DM</div>
        </div>
      </div>

      {/* Messages. Every bubble is always in the DOM so the container reserves its
          height from the start and the page never jumps; bubbles reveal in place. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px 2px 4px' }}>

        <Bubble side="left" revealed={stage >= 1}>
          <div style={{ background: '#fff', border: '1px solid #E8E6DE', borderRadius: '14px', padding: '10px 14px', fontSize: '14px', color: DARK, lineHeight: 1.5 }}>
            Saw your reel on fixing a slice. Do you do 1:1 coaching?
          </div>
          <div style={{ fontSize: '11px', color: '#9A9A8A', marginTop: '4px' }}>9:14 AM</div>
        </Bubble>

        <Bubble side="right" revealed={stage >= 2}>
          <div className="hiw-reply" style={{ borderRadius: '14px', padding: '10px 14px', fontSize: '14px', lineHeight: 1.5, ...replyBubbleStyle }}>
            Appreciate you reaching out. Yeah, I run 1:1 programs built around your actual swing. What is your biggest miss right now, the slice or the distance off the tee?
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px', marginTop: '5px', minHeight: '22px' }}>
            {replyPending && (
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#8A6D1B', background: '#F3E7C4', borderRadius: '999px', padding: '2px 9px' }}>
                Draft, awaiting review
              </span>
            )}
            {replyApproved && stage < 4 && (
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#2E7D46', background: '#E6F4EA', borderRadius: '999px', padding: '2px 9px' }}>
                Approved
              </span>
            )}
            {stage >= 4 && (
              <span style={{ fontSize: '11px', color: '#9A9A8A' }}>Sent, 9:15 AM</span>
            )}
          </div>
        </Bubble>

        <Bubble side="right" revealed={stage >= 5}>
          <div style={{ background: DARK, border: `1.5px solid ${DARK}`, color: '#fff', borderRadius: '14px', padding: '10px 14px', fontSize: '14px', lineHeight: 1.5 }}>
            Still keen to get that slice sorted? Send me a quick swing video and I will point you to the fastest win.
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px', marginTop: '5px' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: '#7A6A2A', background: '#F3E7C4', borderRadius: '999px', padding: '2px 9px' }}>
              Automatic follow up
            </span>
            <span style={{ fontSize: '11px', color: '#9A9A8A' }}>Next day, 8:02 AM</span>
          </div>
        </Bubble>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginTop: '10px' }}>
        <span style={{ fontSize: '12px', color: '#9A9A8A', fontWeight: 500 }}>Step {stage} of 5</span>
        {atEnd ? (
          <button className="hiw-btn-ghost" onClick={() => setStage(1)}>Replay</button>
        ) : (
          <button className="hiw-btn-ghost" onClick={() => setStage(s => Math.min(5, s + 1))}>Next</button>
        )}
      </div>

      <div style={{ position: 'relative', margin: '12px 2px 0' }}>
        {/* Invisible spacer reserves the tallest caption height at any width. */}
        <p aria-hidden="true" style={{ ...CAPTION_STYLE, visibility: 'hidden' }}>{LONGEST_CAPTION}</p>
        <p aria-live="polite" style={{ ...CAPTION_STYLE, position: 'absolute', top: 0, left: 0, right: 0 }}>
          {CAPTIONS[stage - 1]}
        </p>
      </div>
    </div>
  )
}

export default function HowItWorks() {
  const navigate = useNavigate()

  return (
    <div className="hiw" style={{ background: '#F5F5F0', minHeight: '100vh', fontFamily: "'Inter', sans-serif", overflowX: 'hidden' }}>
      <style>{`
        .hiw *, .hiw *::before, .hiw *::after { box-sizing: border-box; }
        .hiw-reveal { transition: opacity .24s ease, transform .24s ease; }
        .hiw-reply { transition: background-color .24s ease, color .24s ease, border-color .24s ease; }
        .hiw button:focus-visible, .hiw a:focus-visible {
          outline: 2px solid ${DARK}; outline-offset: 2px; border-radius: 6px;
        }
        .hiw-btn-ghost {
          background: #fff; border: 1.5px solid #E0DDD2; color: ${DARK};
          font-family: 'Inter', sans-serif; font-size: 14px; font-weight: 600;
          padding: 9px 22px; border-radius: 9px; cursor: pointer; transition: border-color .15s ease;
        }
        .hiw-btn-ghost:hover { border-color: ${GOLD}; }
        .hiw-cta {
          background: ${GOLD}; color: ${DARK}; border: none; font-family: 'Inter', sans-serif;
          font-size: 16px; font-weight: 700; padding: 15px 38px; border-radius: 10px;
          cursor: pointer; box-shadow: 0 4px 20px rgba(160,110,0,0.25); letter-spacing: .01em;
        }
        .hiw-hero { padding: 40px 40px 60px; }
        .hiw-section { padding: 60px 40px; max-width: 980px; margin: 0 auto; }
        .hiw-h1 { font-family: 'Playfair Display', 'Georgia', serif; font-weight: 700; color: ${INK};
          font-size: clamp(30px, 7.5vw, 48px); line-height: 1.12; margin: 0 0 16px; }
        .hiw-h2 { font-family: 'Playfair Display', 'Georgia', serif; font-weight: 700; color: ${INK};
          font-size: clamp(23px, 5vw, 32px); line-height: 1.2; margin: 0 0 10px; }
        .hiw-eyebrow { font-size: 12px; letter-spacing: .16em; text-transform: uppercase;
          font-weight: 500; color: rgba(40,35,25,0.6); margin-bottom: 20px; }
        .hiw-lead { font-size: 17px; color: #6A6A5A; line-height: 1.7; }
        .hiw-stagegrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 14px; }
        .hiw-learn { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; align-items: stretch; }
        @media (max-width: 720px) { .hiw-learn { grid-template-columns: 1fr; } }
        @media (max-width: 560px) {
          .hiw-hero { padding: 32px 20px 44px; }
          .hiw-section { padding: 44px 20px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .hiw-reveal, .hiw-reply, .hiw-btn-ghost { transition: none; }
        }
      `}</style>

      {/* Section 1: Hero, on the landing atmosphere */}
      <div style={{ position: 'relative', background: '#B8B0A0', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 55% 45%, #DDD8C8 0%, #C8C0A8 35%, #B0A890 60%, #9A9078 85%, #807868 100%)' }} />
        <Rays />
        <div className="hiw-hero" style={{ position: 'relative', zIndex: 1, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <button
            onClick={() => navigate('/')}
            aria-label="Back to home"
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', marginBottom: '10px' }}
          >
            <img src={LOGO} alt="MU AI" style={{ width: 'min(200px, 62vw)', height: 'auto', display: 'block' }} />
          </button>
          <div className="hiw-eyebrow">How it works</div>
          <h1 className="hiw-h1" style={{ maxWidth: '640px' }}>Your DMs, answered in minutes.</h1>
          <p className="hiw-lead" style={{ maxWidth: '520px', margin: '0 auto' }}>
            MU AI reads every Instagram DM, drafts a reply in your voice, and holds it for your setter to approve before it ever sends.
          </p>
        </div>
      </div>

      {/* Section 2: The video */}
      <div className="hiw-section" style={{ maxWidth: '860px' }}>
        <div style={{ background: '#fff', border: '1px solid #E8E6DE', borderRadius: '16px', boxShadow: '0 4px 24px rgba(0,0,0,.07)', padding: '18px' }}>
          <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0, borderRadius: '12px', overflow: 'hidden' }}>
            <iframe
              src="https://www.youtube-nocookie.com/embed/AAkVdHX6gGw?rel=0&modestbranding=1"
              title="How MU AI works"
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 0 }}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>
      </div>

      {/* Section 3: The interactive DM thread, the signature element */}
      <div className="hiw-section">
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div className="hiw-eyebrow" style={{ marginBottom: '12px' }}>See it work</div>
          <h2 className="hiw-h2">Walk through one conversation.</h2>
          <p className="hiw-lead" style={{ maxWidth: '520px', margin: '8px auto 0' }}>
            This is how a single DM moves through MU AI. Step through it at your own pace.
          </p>
        </div>
        <DmThread />
      </div>

      {/* Section 4: How it learns, one concrete before and after */}
      <div className="hiw-section">
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div className="hiw-eyebrow" style={{ marginBottom: '12px' }}>How it learns</div>
          <h2 className="hiw-h2">Correct it once. It remembers.</h2>
        </div>
        <div className="hiw-learn">
          <div style={{ background: '#fff', border: '1px solid #E8E6DE', borderRadius: '16px', padding: '22px' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#C0392B', marginBottom: '14px' }}>Got it wrong</div>
            <div style={{ fontSize: '13px', color: '#9A9A8A', marginBottom: '6px' }}>Lead</div>
            <div style={{ background: '#F7F6F1', borderRadius: '12px', padding: '10px 14px', fontSize: '14px', color: DARK, lineHeight: 1.5, marginBottom: '12px' }}>
              Do you guarantee results?
            </div>
            <div style={{ fontSize: '13px', color: '#9A9A8A', marginBottom: '6px' }}>Old reply</div>
            <div style={{ background: '#FDF0EE', border: '1px solid #F5C6C0', borderRadius: '12px', padding: '10px 14px', fontSize: '14px', color: '#7A2E28', lineHeight: 1.5 }}>
              Absolutely, you will see results in 30 days, guaranteed.
            </div>
          </div>
          <div style={{ background: '#fff', border: '1px solid #E8E6DE', borderRadius: '16px', padding: '22px' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#2E7D46', marginBottom: '14px' }}>Answered like the coach</div>
            <div style={{ fontSize: '13px', color: '#9A9A8A', marginBottom: '6px' }}>Lead</div>
            <div style={{ background: '#F7F6F1', borderRadius: '12px', padding: '10px 14px', fontSize: '14px', color: DARK, lineHeight: 1.5, marginBottom: '12px' }}>
              Do you guarantee results?
            </div>
            <div style={{ fontSize: '13px', color: '#9A9A8A', marginBottom: '6px' }}>New reply</div>
            <div style={{ background: DARK, borderRadius: '12px', padding: '10px 14px', fontSize: '14px', color: '#fff', lineHeight: 1.5 }}>
              I cannot promise a number, that depends on the work you put in. What I can promise is a plan built around your swing and honest feedback every week.
            </div>
          </div>
        </div>
        <p style={{ textAlign: 'center', fontSize: '14px', color: '#6A6A5A', lineHeight: 1.6, maxWidth: '620px', margin: '22px auto 0' }}>
          A setter corrected this once. MU AI saved the correction and now handles the same question the coach's way on later conversations.
        </p>
      </div>

      {/* Section 5: How it qualifies, the real pipeline */}
      <div className="hiw-section">
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div className="hiw-eyebrow" style={{ marginBottom: '12px' }}>How it qualifies</div>
          <h2 className="hiw-h2">Every chat moves through the same stages.</h2>
        </div>
        <div className="hiw-stagegrid">
          {STAGES.map(([name, line], i) => (
            <div key={name} style={{ background: '#fff', border: '1px solid #E8E6DE', borderRadius: '12px', padding: '16px' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: GOLD, marginBottom: '8px' }}>
                {String(i + 1).padStart(2, '0')}
              </div>
              <div style={{ fontSize: '12.5px', fontWeight: 700, letterSpacing: '.04em', color: DARK, marginBottom: '6px' }}>{name}</div>
              <div style={{ fontSize: '13px', color: '#6A6A5A', lineHeight: 1.5 }}>{line}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Section 6: Close, one CTA */}
      <div className="hiw-section" style={{ textAlign: 'center', paddingBottom: '20px' }}>
        <h2 className="hiw-h2" style={{ maxWidth: '560px', margin: '0 auto 20px' }}>
          Answer every lead in minutes, with a human on every send.
        </h2>
        <button className="hiw-cta" onClick={() => navigate('/waitlist')}>Join the Waitlist</button>
      </div>

      <div style={{ textAlign: 'center', padding: '18px', fontSize: '12px', color: 'rgba(40,35,25,0.4)' }}>
        MU AI &copy; 2026
      </div>
    </div>
  )
}
