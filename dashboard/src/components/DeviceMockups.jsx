import { Icon, PersonGlyph } from './FunnelShared'

// Coded illustrative device screens for the funnel pages, rebuilt from the
// mockups as HTML/CSS per the briefing: no dashboard screenshots, no sliced
// PNGs. Every name and number below is fictional illustrative content from
// Nella's mockups; nothing is fetched, nothing resolves to a real account.

// Small inline sparkline, pink, dot-terminated, like the mockup stat cards.
function Sparkline({ points = '0,26 14,18 26,22 40,10 52,16 66,6 80,12 96,2' }) {
  const dots = points.split(' ').map(p => p.split(',').map(Number))
  return (
    <svg viewBox="0 0 100 30" style={{ width: '100%', height: 30, marginTop: 8, overflow: 'visible' }} aria-hidden="true">
      <polyline points={points} fill="none" stroke="var(--mk-pink)" strokeWidth="1.6" strokeLinejoin="round" />
      {dots.filter((_, i) => i % 2 === 1).map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="2" fill="var(--mk-pink)" />
      ))}
    </svg>
  )
}

function MiniAvatar({ bg = 'linear-gradient(135deg, #f0a8c4, #d96a95)', size = 22 }) {
  return (
    <span style={{ width: size, height: size, borderRadius: '50%', background: bg, flex: 'none', display: 'inline-block', overflow: 'hidden' }} aria-hidden="true">
      <PersonGlyph />
    </span>
  )
}

const ROW_FILLS = [
  'linear-gradient(135deg, #f0a8c4, #d96a95)',
  'linear-gradient(135deg, #e8c9a8, #c99263)',
  'linear-gradient(135deg, #d9a8e8, #a86ac9)',
  'linear-gradient(135deg, #f4bfae, #dd8368)',
  'linear-gradient(135deg, #a8cbe8, #6a92c9)',
]

// Phone: the Med Spa DM thread from the hero mockup.
export function PhoneChat({ style }) {
  return (
    <div className="mk-phone" style={style} aria-hidden="true">
      <div className="mk-phone-screen">
        <div className="mk-chat-head">
          <MiniAvatar size="10cqw" />
          <div>
            <div className="mk-chat-name">Med Spa Account</div>
            <div className="mk-chat-sub">Active now</div>
          </div>
        </div>
        <div className="mk-chat-body">
          <div className="mk-bubble mk-bubble--in">Hi! I&#39;m interested</div>
          <div className="mk-bubble mk-bubble--in">Perfect! Can I ask what your main goal is?</div>
          <div className="mk-bubble mk-bubble--out">I want to smooth forehead lines.</div>
          <div className="mk-bubble mk-bubble--in">Great! How soon are you looking to come in?</div>
          <div className="mk-bubble mk-bubble--out">As soon as possible!</div>
        </div>
        <div className="mk-chat-input">
          <span>Type a message...</span>
          <Icon name="arrow-right" size={11} strokeWidth={2.4} style={{ color: 'var(--mk-pink)' }} />
        </div>
        <div className="mk-phone-homebar" />
      </div>
    </div>
  )
}

// Laptop: the Conversations inbox panel from the hero mockup.
const CONV_ROWS = [
  { handle: 'jessica.aesthetics', note: 'Wants to book', intent: 'High Intent', tone: 'high' },
  { handle: 'rachel.thomas', note: 'Question', intent: 'High Intent', tone: 'high' },
  { handle: 'sophia.browne', note: 'Pricing', intent: 'Medium Intent', tone: 'medium' },
  { handle: 'jenna.co', note: 'Wants to book', intent: 'Booked', tone: 'booked' },
  { handle: 'laura.wellness', note: 'New lead', intent: 'High Intent', tone: 'high' },
]

export function ConversationsPanel() {
  return (
    <div className="mk-laptop" aria-hidden="true">
      <div className="mk-laptop-screen mk-conv">
        <div className="mk-conv-topbar">
          <span className="mk-conv-title">Conversations</span>
          <Icon name="refresh" size={12} strokeWidth={2.2} style={{ color: 'var(--mk-muted)' }} />
        </div>
        <div className="mk-conv-tabs">
          {['All', 'Unread', 'High Intent', 'Booked', 'Closed'].map((t, i) => (
            <span key={t} className={i === 0 ? 'mk-conv-tab mk-conv-tab--on' : 'mk-conv-tab'}>{t}</span>
          ))}
        </div>
        {CONV_ROWS.map((r, i) => (
          <div className="mk-conv-row" key={r.handle}>
            <MiniAvatar bg={ROW_FILLS[i]} size="6.4cqw" />
            <div>
              <div className="mk-conv-handle">{r.handle}</div>
              <div className="mk-conv-note">{r.note}</div>
            </div>
            <span className={`mk-intent mk-intent--${r.tone}`}>{r.intent}</span>
          </div>
        ))}
      </div>
      <div className="mk-laptop-base" />
    </div>
  )
}

export function StatCard({ label, sub, value, delta, spark, iconName }) {
  return (
    <div className="mk-stat">
      <div className="mk-stat-label">{label}</div>
      {sub && <div className="mk-stat-sub">{sub}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="mk-stat-value">{value}</span>
        {delta && <span className="mk-stat-delta">{delta}</span>}
        {iconName && (
          <span style={{ marginLeft: 'auto', color: 'var(--mk-pink)', background: 'var(--mk-pink-soft)', borderRadius: '50%', width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={iconName} size={14} strokeWidth={2.2} />
          </span>
        )}
      </div>
      {spark && <Sparkline />}
    </div>
  )
}

// The hero collage: phone thread over the conversations laptop, stat cards
// around them. Positions collapse to a stacked grid on mobile (see CSS).
export function HeroCollage() {
  return (
    <div className="mk-collage" role="img" aria-label="Illustration of DM conversations turning into booked appointments">
      <div className="mk-collage-laptop"><ConversationsPanel /></div>
      <div className="mk-collage-phone"><PhoneChat /></div>
      <div className="mk-collage-stat mk-collage-stat--1" aria-hidden="true">
        <StatCard label="Conversations Booked" sub="This Month" value="392" spark />
      </div>
      <div className="mk-collage-stat mk-collage-stat--2" aria-hidden="true">
        <StatCard label="Lost Revenue" value="$43,600" iconName="zap" />
      </div>
      <div className="mk-collage-stat mk-collage-stat--3" aria-hidden="true">
        <StatCard label="Appointments Booked" sub="This Month" value="37" spark />
      </div>
      <div className="mk-collage-stat mk-collage-stat--4" aria-hidden="true">
        <StatCard label="Revenue Generated" sub="This Month" value="$24,700" delta="+32%" spark />
      </div>
    </div>
  )
}

// Laptop: the DM Audit Overview screen (sections 3 and 7 of the homepage).
const AUDIT_ROWS = ['Conversation Flow', 'Response Time', 'Qualification', 'Follow-ups', 'Call Booking', 'Closing Approach']
const AUDIT_FINDINGS = ['Slow response time', 'Under-value proposition', 'Low qualification rate', 'Opportunities not nurtured', 'Weak closing']

export function AuditOverviewLaptop() {
  return (
    <div className="mk-laptop" aria-hidden="true">
      <div className="mk-laptop-screen">
        <div className="mk-audit-head">
          <MiniAvatar bg={ROW_FILLS[2]} size="5.6cqw" />
          <span className="mk-audit-title">DM Audit Overview</span>
        </div>
        <div className="mk-audit-cols">
          <div>
            {AUDIT_ROWS.map(r => <div className="mk-audit-rowlabel" key={r}>{r}</div>)}
          </div>
          <div>
            <div className="mk-audit-colhead">Key Findings</div>
            {AUDIT_FINDINGS.map(f => (
              <div className="mk-finding" key={f}>
                <Icon name="x-circle" size={13} strokeWidth={2.2} style={{ color: 'var(--mk-pink)', flex: 'none' }} />
                {f}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mk-laptop-base" />
    </div>
  )
}

// Phone: the Revenue Leakage panel.
export function LeakagePhone({ style }) {
  return (
    <div className="mk-phone" style={style} aria-hidden="true">
      <div className="mk-phone-screen mk-leak">
        <div>
          <div className="mk-leak-title">Revenue Leakage</div>
          <div className="mk-leak-sub">This Month</div>
        </div>
        <hr className="mk-leak-hr" />
        <div>
          <div className="mk-leak-metric-label">Potential Lost Revenue</div>
          <div className="mk-leak-metric-value">$24,700<span style={{ fontSize: '4.6cqw', color: 'var(--mk-muted)', fontWeight: 500 }}> /month</span></div>
        </div>
        <hr className="mk-leak-hr" />
        <div>
          <div className="mk-leak-metric-label">Lost Opportunities</div>
          <div className="mk-leak-metric-value">37</div>
          <div className="mk-leak-sub">This month</div>
        </div>
        <hr className="mk-leak-hr" />
        <div>
          <div className="mk-leak-title" style={{ fontSize: '5.4cqw' }}>Fix These 3 Things</div>
          <div className="mk-leak-list">
            1. Better Qualification<br />
            2. Value-First Messaging<br />
            3. Consistent Follow-ups
          </div>
        </div>
        <hr className="mk-leak-hr" />
        <div>
          <div className="mk-leak-metric-label">Potential Recovery</div>
          <div className="mk-leak-recover">$18K+/month</div>
          <div className="mk-leak-sub">with improvements</div>
        </div>
        <div className="mk-phone-homebar" />
      </div>
    </div>
  )
}

// The audit-overview collage used twice on the homepage.
export function AuditCollage() {
  return (
    <div className="mk-collage-audit" role="img" aria-label="Illustration of a DM audit overview with a revenue leakage report">
      <div className="mk-collage-audit-laptop"><AuditOverviewLaptop /></div>
      <div className="mk-collage-audit-phone"><LeakagePhone /></div>
    </div>
  )
}

// Phone: the Messages inbox from the waitlist mockup.
const MSG_ROWS = [
  { text: 'Hey! I’d love to book a consult...', sub: 'rosewell.spa', time: '10m' },
  { text: 'Are you available this week?', sub: 'glowtheory.co', time: '15m' },
  { text: 'What are your pricing options?', sub: 'lumiere.skin', time: '1h' },
  { text: 'Can you tell me more about...', sub: 'velvetaesthetic', time: '2h' },
  { text: 'I’m interested – what’s next?', sub: 'thebrowatelier', time: '3h' },
]

export function MessagesPhone({ style }) {
  return (
    <div className="mk-phone" style={style} aria-hidden="true">
      <div className="mk-phone-screen">
        <div className="mk-msgs-head">
          <span className="mk-msgs-title">Messages</span>
          <Icon name="search" size={12} strokeWidth={2.2} style={{ color: 'var(--mk-muted)' }} />
        </div>
        <div className="mk-stories">
          {['rosewell', 'glowtheory', 'lumiere', 'velvet'].map((n, i) => (
            <span className="mk-story" key={n}>
              <span className="mk-story-ring"><div style={{ background: ROW_FILLS[i], overflow: 'hidden' }}><PersonGlyph /></div></span>
              <span className="mk-story-name">{n}</span>
            </span>
          ))}
        </div>
        {MSG_ROWS.map((m, i) => (
          <div className="mk-msg-row" key={m.sub}>
            <MiniAvatar bg={ROW_FILLS[(i + 1) % 5]} size="11cqw" />
            <div>
              <div className="mk-msg-text">{m.text}</div>
              <div className="mk-msg-sub">{m.sub}</div>
            </div>
            <span className="mk-msg-time">{m.time}</span>
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <div className="mk-phone-homebar" />
      </div>
    </div>
  )
}

// Tablet: the audit-page chat, recolored into the site palette per the
// briefing (mockup showed blue bubbles; the funnel site is rose).
export function TabletChat({ style }) {
  return (
    <div className="mk-tablet" style={style} aria-hidden="true">
      <div className="mk-tablet-screen">
        <div className="mk-chat-body">
          <div className="mk-bubble mk-bubble--in">Hey! I&#39;d love to book a consult...</div>
          <div className="mk-bubble mk-bubble--out">Can you tell me more about your services?</div>
          <div className="mk-bubble mk-bubble--out">I&#39;m interested, what are your prices?</div>
          <div className="mk-bubble mk-bubble--in" style={{ color: 'var(--mk-muted)' }}>
            <span style={{ letterSpacing: 2 }}>&#8226;&#8226;&#8226;</span>&nbsp;Typing...
          </div>
        </div>
      </div>
    </div>
  )
}

// Stylised audit paperwork for the audit-page collage. Abstract line blocks,
// not readable fake documents.
export function AuditPapers() {
  return (
    <div className="mk-collage-papers" role="img" aria-label="Illustration of a DM audit report with a chat and notes">
      <div className="mk-paper mk-collage-paper1" aria-hidden="true">
        <div className="mk-paper-title">DM AUDIT</div>
        {[0, 1, 2, 3, 4, 5].map(i => (
          <div key={i} className={i % 3 === 2 ? 'mk-paper-line mk-paper-line--short' : 'mk-paper-line'} />
        ))}
      </div>
      <div className="mk-paper mk-collage-paper2" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5, 6].map(i => (
          <div key={i} style={{ display: 'flex', gap: 5 }}>
            <div className="mk-paper-line" style={{ flex: 2 }} />
            <div className="mk-paper-line" style={{ flex: 1 }} />
            <div className="mk-paper-line" style={{ flex: 1 }} />
          </div>
        ))}
      </div>
      <div className="mk-collage-tablet"><TabletChat /></div>
      <div className="mk-note mk-note--pink mk-collage-note" aria-hidden="true">
        &#10003; More calls.<br />
        &#10003; More clients<br />
        &#10003; More revenue<br />
        <span style={{ display: 'block', textAlign: 'center' }}>&#9825;</span>
      </div>
    </div>
  )
}
