// Marketing sections shared by the public homepage and /how-it-works.
//
// Extracted from HowItWorks.jsx when Nella's homepage layout (2026-08-22, her
// three screenshots) pulled the five-step flow strip and the Without/With
// comparison onto the landing page. Extracted rather than copied so the two
// pages cannot drift; HowItWorks imports these same components.
//
// Styles are scoped mk- (not hiw-) so mounting these on a page that does not
// carry the HowItWorks style block still renders correctly, and mounting them
// on /how-it-works (which does) collides with nothing.

import { FLOW_STEPS } from '../lib/marketingCopy'

const GOLD = 'var(--acc)'
const INK = '#18160E'
const DARK = 'var(--tx)'

// One <style> per mounted section is harmless (identical rules), and each
// section carrying its own keeps them independently usable.
const MK_CSS = `
  .mk-section { padding: 60px 40px; max-width: 980px; margin: 0 auto; }
  .mk-eyebrow { font-size: 12px; letter-spacing: .16em; text-transform: uppercase;
    font-weight: 600; color: #8A6D1B; }
  .mk-h2 { font-family: 'Playfair Display', 'Georgia', serif; font-weight: 700; color: ${INK};
    font-size: clamp(24px, 5vw, 32px); line-height: 1.2; margin: 0; }
  .mk-lead { font-size: 17px; color: var(--tx2); line-height: 1.7; }
  .mk-flowgrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 14px; }
  .mk-compare { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; align-items: stretch; }
  @media (max-width: 720px) { .mk-compare { grid-template-columns: 1fr; } }
  @media (max-width: 640px) { .mk-section { padding: 44px 20px; } }
`

function SectionHead({ eyebrow, title, lead }) {
  return (
    <div style={{ textAlign: 'center', marginBottom: '28px' }}>
      <div className="mk-eyebrow" style={{ marginBottom: '12px' }}>{eyebrow}</div>
      <h2 className="mk-h2">{title}</h2>
      {lead && <p className="mk-lead" style={{ maxWidth: '520px', margin: '8px auto 0' }}>{lead}</p>}
    </div>
  )
}

// The five-step flow as a static numbered strip. Same card treatment as the
// /how-it-works stage grid, same copy as its interactive walkthrough.
export function FlowStrip({ eyebrow = 'How it works', title = 'Your DMs, answered in minutes.' }) {
  return (
    <div className="mk-section">
      <style>{MK_CSS}</style>
      <SectionHead eyebrow={eyebrow} title={title} />
      <div className="mk-flowgrid">
        {FLOW_STEPS.map((line, i) => (
          <div key={i} style={{ background: '#fff', border: '1px solid var(--bdr)', borderRadius: '12px', padding: '16px' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: GOLD, marginBottom: '8px' }}>
              {String(i + 1).padStart(2, '0')}
            </div>
            <div style={{ fontSize: '13px', color: 'var(--tx2)', lineHeight: 1.5 }}>{line}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// The Without/With comparison: the same two-card block /how-it-works shows as
// "How it learns". Card copy is verbatim from there; the headers are props so
// the landing can relabel without forking the markup.
export function LearnComparison({ eyebrow = 'How it learns', title = 'Correct it once. It remembers.' }) {
  return (
    <div className="mk-section">
      <style>{MK_CSS}</style>
      <SectionHead eyebrow={eyebrow} title={title} />
      <div className="mk-compare">
        <div style={{ background: '#fff', border: '1px solid var(--bdr)', borderRadius: 'var(--rlg)', padding: '22px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--red)', marginBottom: '14px' }}>Got it wrong</div>
          <div style={{ fontSize: '13px', color: 'var(--tx3)', marginBottom: '6px' }}>Lead</div>
          <div style={{ background: '#F7F6F1', borderRadius: '12px', padding: '10px 14px', fontSize: '14px', color: DARK, lineHeight: 1.5, marginBottom: '12px' }}>
            Do you guarantee results?
          </div>
          <div style={{ fontSize: '13px', color: 'var(--tx3)', marginBottom: '6px' }}>Old reply</div>
          <div style={{ background: 'var(--redbg)', border: '1px solid var(--redbd)', borderRadius: '12px', padding: '10px 14px', fontSize: '14px', color: '#7A2E28', lineHeight: 1.5 }}>
            Absolutely, you will see results in 30 days, guaranteed.
          </div>
        </div>
        <div style={{ background: '#fff', border: '1px solid var(--bdr)', borderRadius: 'var(--rlg)', padding: '22px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#2E7D46', marginBottom: '14px' }}>Answered like the coach</div>
          <div style={{ fontSize: '13px', color: 'var(--tx3)', marginBottom: '6px' }}>Lead</div>
          <div style={{ background: '#F7F6F1', borderRadius: '12px', padding: '10px 14px', fontSize: '14px', color: DARK, lineHeight: 1.5, marginBottom: '12px' }}>
            Do you guarantee results?
          </div>
          <div style={{ fontSize: '13px', color: 'var(--tx3)', marginBottom: '6px' }}>New reply</div>
          <div style={{ background: DARK, borderRadius: '12px', padding: '10px 14px', fontSize: '14px', color: '#fff', lineHeight: 1.5 }}>
            I cannot promise a number, that depends on the work you put in. What I can promise is a plan built around your swing and honest feedback every week.
          </div>
        </div>
      </div>
      <p style={{ textAlign: 'center', fontSize: '14px', color: 'var(--tx2)', lineHeight: 1.6, maxWidth: '620px', margin: '22px auto 0' }}>
        A setter corrected this once. MU AI saved the correction and now handles the same question the coach's way on later conversations.
      </p>
    </div>
  )
}
