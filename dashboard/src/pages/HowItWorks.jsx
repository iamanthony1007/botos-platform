import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import PublicHeader from '../components/PublicHeader'
import { usePublicScroll } from '../lib/usePublicScroll'
import { LearnComparison } from '../components/MarketingSections'
import { FLOW_STEPS } from '../lib/marketingCopy'

const GOLD = 'var(--acc)'
const INK = '#18160E'
const DARK = 'var(--tx)'

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

const CAPTIONS = FLOW_STEPS

// The longest caption reserves the caption block height so the card does not
// change height between stages at any viewport width.
const LONGEST_CAPTION = CAPTIONS.reduce((a, b) => (b.length > a.length ? b : a))
const CAPTION_STYLE = { fontSize: '13px', color: 'var(--tx2)', lineHeight: 1.5, margin: 0 }

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
        background: '#fff', border: '1px solid var(--bdr)', borderRadius: 'var(--rlg)',
        boxShadow: 'var(--shm)', padding: '18px', maxWidth: '460px',
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
          <div style={{ fontSize: '12px', color: 'var(--tx3)' }}>Instagram DM</div>
        </div>
      </div>

      {/* Messages. Every bubble is always in the DOM so the container reserves its
          height from the start and the page never jumps; bubbles reveal in place. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px 2px 4px' }}>

        <Bubble side="left" revealed={stage >= 1}>
          <div style={{ background: '#fff', border: '1px solid var(--bdr)', borderRadius: '14px', padding: '10px 14px', fontSize: '14px', color: DARK, lineHeight: 1.5 }}>
            Saw your reel on fixing a slice. Do you do 1:1 coaching?
          </div>
          <div style={{ fontSize: '11px', color: 'var(--tx3)', marginTop: '4px' }}>9:14 AM</div>
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
              <span style={{ fontSize: '11px', color: 'var(--tx3)' }}>Sent, 9:15 AM</span>
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
            <span style={{ fontSize: '11px', color: 'var(--tx3)' }}>Next day, 8:02 AM</span>
          </div>
        </Bubble>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginTop: '10px' }}>
        <span style={{ fontSize: '12px', color: 'var(--tx3)', fontWeight: 500 }}>Step {stage} of 5</span>
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

// Click-to-load video facade. Nothing is requested from YouTube until the
// visitor clicks play: faster first load (the embed pulls a heavy player that
// would otherwise load below the fold on every visit) and no YouTube contact
// before consent, which matches the privacy rationale for youtube-nocookie.
function VideoEmbed() {
  const [playing, setPlaying] = useState(false)
  const warmed = useRef(false)

  // Warm the connection to YouTube on pointer/focus intent, so the click to play
  // does not also pay for DNS + TLS + TCP. Still nothing loads until intent, so
  // page load stays clean and privacy-respecting.
  function warm() {
    if (warmed.current) return
    warmed.current = true
    for (const href of ['https://www.youtube-nocookie.com', 'https://www.google.com', 'https://i.ytimg.com']) {
      const l = document.createElement('link')
      l.rel = 'preconnect'
      l.href = href
      l.crossOrigin = 'anonymous'
      document.head.appendChild(l)
    }
  }

  return (
    <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0, borderRadius: '12px', overflow: 'hidden', background: '#18160E' }}>
      {playing ? (
        <iframe
          src="https://www.youtube-nocookie.com/embed/AAkVdHX6gGw?rel=0&modestbranding=1&autoplay=1&playsinline=1"
          title="How MU AI works"
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 0 }}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      ) : (
        <button
          className="hiw-videobtn"
          onMouseEnter={warm}
          onFocus={warm}
          onClick={() => setPlaying(true)}
          aria-label="Play video: How MU AI works"
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none',
            cursor: 'pointer', background: 'linear-gradient(135deg, #2A2620 0%, #18160E 100%)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '14px'
          }}
        >
          <span aria-hidden="true" style={{
            width: '64px', height: '64px', borderRadius: '50%', background: 'var(--acc)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 6px 24px rgba(0,0,0,0.4)'
          }}>
            <span style={{
              width: 0, height: 0, borderStyle: 'solid', borderWidth: '11px 0 11px 18px',
              borderColor: 'transparent transparent transparent #18160E', marginLeft: '4px'
            }} />
          </span>
          <span style={{ color: '#F5F2EC', fontSize: '15px', fontWeight: 600, letterSpacing: '.01em' }}>
            Watch how MU AI works
          </span>
        </button>
      )}
    </div>
  )
}

export default function HowItWorks() {
  const navigate = useNavigate()
  usePublicScroll()

  return (
    <>
      <PublicHeader />
      <div className="hiw" style={{ background: 'var(--bg)', minHeight: '100vh', fontFamily: "'Inter', sans-serif", overflowX: 'hidden' }}>
      <style>{`
        .hiw *, .hiw *::before, .hiw *::after { box-sizing: border-box; }
        .hiw-reveal { transition: opacity .24s ease, transform .24s ease; }
        .hiw-reply { transition: background-color .24s ease, color .24s ease, border-color .24s ease; }
        .hiw button:focus-visible, .hiw a:focus-visible {
          outline: 2px solid ${DARK}; outline-offset: 2px; border-radius: 6px;
        }
        .hiw-btn-ghost {
          background: #fff; border: 1.5px solid var(--bdr); color: ${DARK};
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
        .hiw-lead { font-size: 17px; color: var(--tx2); line-height: 1.7; }
        .hiw-stagegrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 14px; }
        .hiw-tourgrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; }
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
          <div className="hiw-eyebrow">How it works</div>
          <h1 className="hiw-h1" style={{ maxWidth: '640px' }}>Your DMs, answered in minutes.</h1>
          <p className="hiw-lead" style={{ maxWidth: '520px', margin: '0 auto' }}>
            MU AI reads every Instagram DM, drafts a reply in your voice, and holds it for your setter to approve before it ever sends.
          </p>
        </div>
      </div>

      {/* Section 2: The video */}
      <div className="hiw-section" style={{ maxWidth: '860px' }}>
        <div style={{ background: '#fff', border: '1px solid var(--bdr)', borderRadius: 'var(--rlg)', boxShadow: 'var(--shm)', padding: '18px' }}>
          <VideoEmbed />
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

      {/* Section 4: the shared Without/With comparison (components/MarketingSections) */}
      <LearnComparison />

      {/* Section 5: How it qualifies, the real pipeline */}
      <div className="hiw-section">
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div className="hiw-eyebrow" style={{ marginBottom: '12px' }}>How it qualifies</div>
          <h2 className="hiw-h2">Every chat moves through the same stages.</h2>
        </div>
        <div className="hiw-stagegrid">
          {STAGES.map(([name, line], i) => (
            <div key={name} style={{ background: '#fff', border: '1px solid var(--bdr)', borderRadius: '12px', padding: '16px' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: GOLD, marginBottom: '8px' }}>
                {String(i + 1).padStart(2, '0')}
              </div>
              <div style={{ fontSize: '12.5px', fontWeight: 700, letterSpacing: '.04em', color: DARK, marginBottom: '6px' }}>{name}</div>
              <div style={{ fontSize: '13px', color: 'var(--tx2)', lineHeight: 1.5 }}>{line}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Section 5b: Inside the platform, a tour of the real screens */}
      <div className="hiw-section">
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div className="hiw-eyebrow" style={{ marginBottom: '12px' }}>Inside the platform</div>
          <h2 className="hiw-h2">The screens your team works in.</h2>
          <p className="hiw-lead" style={{ maxWidth: '540px', margin: '8px auto 0' }}>
            MU AI does the drafting. Your setter runs the show from one place.
          </p>
        </div>

        <div className="hiw-learn">
          {/* Closest to Booking, the dashboard's flagship widget */}
          <div style={{ background: '#fff', border: '1px solid var(--bdr)', borderRadius: 'var(--rlg)', padding: '22px' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: GOLD, marginBottom: '4px' }}>Dashboard</div>
            <div style={{ fontFamily: "'Playfair Display', 'Georgia', serif", fontSize: '18px', fontWeight: 700, color: INK, marginBottom: '14px' }}>Closest to Booking</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
              {[
                ['1', '@mike.plays.golf', 'SCHEDULE', 'High'],
                ['2', '@sarah.golfs', 'INVITE', 'High'],
                ['3', '@tourbound.tom', 'DECISION', 'Medium']
              ].map(([n, who, stg, intent]) => (
                <div key={n} style={{ display: 'flex', alignItems: 'center', gap: '9px', padding: '8px 10px', background: n === '1' ? 'var(--accl)' : '#F7F6F1', borderRadius: '9px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--tx3)', width: '12px', flexShrink: 0 }}>{n}</span>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: DARK, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{who}</span>
                  <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '.03em', color: 'var(--tx2)', flexShrink: 0 }}>{stg}</span>
                  <span style={{ fontSize: '10px', fontWeight: 700, color: intent === 'High' ? '#2E7D46' : '#8A6D1B', background: intent === 'High' ? '#E6F4EA' : '#F3E7C4', borderRadius: '999px', padding: '2px 8px', flexShrink: 0 }}>{intent}</span>
                </div>
              ))}
            </div>
            <p style={{ fontSize: '13px', color: 'var(--tx2)', lineHeight: 1.6, margin: '14px 0 0' }}>
              Every active lead ranked by intent, stage, and recent activity, so your setter always knows who to work next.
            </p>
          </div>

          {/* Active Conversations, the review inbox */}
          <div style={{ background: '#fff', border: '1px solid var(--bdr)', borderRadius: 'var(--rlg)', padding: '22px' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: GOLD, marginBottom: '4px' }}>Active Conversations</div>
            <div style={{ fontFamily: "'Playfair Display', 'Georgia', serif", fontSize: '18px', fontWeight: 700, color: INK, marginBottom: '14px' }}>Reviewed before it sends</div>
            <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '8px' }}>
              <div style={{ background: '#fff', border: '1px solid var(--bdr)', borderRadius: '12px', padding: '8px 12px', fontSize: '13px', color: DARK, maxWidth: '82%', lineHeight: 1.45 }}>
                Do you guarantee results?
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' }}>
              <div style={{ background: 'var(--accl)', border: `1.5px dashed ${GOLD}`, borderRadius: '12px', padding: '8px 12px', fontSize: '13px', color: '#3A3A2A', maxWidth: '82%', lineHeight: 1.45 }}>
                I cannot promise a number, but I can promise a plan built around your swing.
                <div style={{ marginTop: '6px', fontSize: '10px', fontWeight: 700, letterSpacing: '.03em', color: '#8A6D1B' }}>AI DRAFT</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: DARK, background: GOLD, borderRadius: '8px', padding: '6px 15px' }}>Approve</span>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--tx2)', border: '1px solid var(--bdr)', borderRadius: '8px', padding: '6px 15px' }}>Edit</span>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--tx2)', border: '1px solid var(--bdr)', borderRadius: '8px', padding: '6px 15px' }}>Discard</span>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--tx2)', lineHeight: 1.6, margin: '14px 0 0' }}>
              Every DM arrives with a drafted reply. Your setter approves, edits, or discards it. Nothing reaches a lead without a human.
            </p>
          </div>
        </div>

        {/* The rest of the platform, compact and factual */}
        <div className="hiw-tourgrid" style={{ marginTop: '14px' }}>
          {[
            ['Knowledge Base', 'Upload your PDFs and docs. The AI answers from them in every reply.'],
            ['AI Learning Log', 'Every correction your setter makes is saved and reused on similar chats.'],
            ['Analytics', 'A conversion funnel and stage-by-stage drop-off show where leads are won or lost.'],
            ['AI Behavior', 'Shape how the AI talks in plain English. No prompt engineering.'],
            ['Conversation Simulator', 'Test the bot safely and replay past conversations before anything goes live.'],
            ['Team', 'Invite setters and control who can see and do what.']
          ].map(([name, line]) => (
            <div key={name} style={{ background: '#fff', border: '1px solid var(--bdr)', borderRadius: '12px', padding: '16px' }}>
              <div style={{ fontSize: '13.5px', fontWeight: 700, color: DARK, marginBottom: '6px' }}>{name}</div>
              <div style={{ fontSize: '13px', color: 'var(--tx2)', lineHeight: 1.5 }}>{line}</div>
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
    </>
  )
}
