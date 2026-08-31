import { useNavigate } from 'react-router-dom'

// Shared atoms for the funnel pages. All copy routed through here is Nella's
// client copy from the 2026-08-30 mockups, verbatim (including its em dashes,
// which are client content, not ours).

// Feather-style stroke icons. Inline SVG keeps the pages dependency-free and
// pixel-crisp at any size, matching the mockup's line-icon look.
const PATHS = {
  'check': <polyline points="20 6 9 17 4 12" />,
  'check-circle': <><circle cx="12" cy="12" r="10" /><polyline points="16.5 9 10.5 15 7.5 12" /></>,
  'x-circle': <><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></>,
  'clock': <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>,
  'calendar': <><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>,
  'message': <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />,
  'frown': <><circle cx="12" cy="12" r="10" /><path d="M16 16s-1.5-2-4-2-4 2-4 2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></>,
  'user-check': <><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><polyline points="17 11 19 13 23 9" /></>,
  'search': <><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>,
  'bar-chart': <><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></>,
  'target': <><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></>,
  'gift': <><polyline points="20 12 20 22 4 22 4 12" /><rect x="2" y="7" width="20" height="5" /><line x1="12" y1="22" x2="12" y2="7" /><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" /><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" /></>,
  'gear': <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
  'shield': <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  'refresh': <><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></>,
  'zap': <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />,
  'pin': <><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></>,
  'star': <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />,
  'warning': <><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></>,
  'video': <><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" /></>,
  'arrow-right': <><line x1="4" y1="12" x2="20" y2="12" /><polyline points="13 5 20 12 13 19" /></>,
}

export function Icon({ name, size = 20, strokeWidth = 1.8, style }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" style={style}
    >
      {PATHS[name]}
    </svg>
  )
}

// The four trust chips that follow every audit CTA on the homepage.
const TRUST_CHIPS = ['One-time payment', 'Delivered within 72 hours', 'Done by me', '100% Actionable']

export function TrustChips({ stack = false }) {
  return (
    <div className={stack ? 'mk-chips mk-chips--stack' : 'mk-chips'}>
      {TRUST_CHIPS.map(c => (
        <span className="mk-chip" key={c}>
          <Icon name="check-circle" size={16} strokeWidth={2} style={{ color: 'var(--mk-pink)' }} />
          {c}
        </span>
      ))}
    </div>
  )
}

export function Stars({ gold = false, size = '0.95rem' }) {
  return (
    <span className={gold ? 'mk-stars mk-stars--gold' : 'mk-stars'} style={{ fontSize: size }} aria-label="5 stars">
      {'★★★★★'}
    </span>
  )
}

// Illustrative avatar row. Deliberately abstract gradient circles, not faces:
// no stock photos, nothing that could resolve to a real person (briefing 6).
const AVATAR_FILLS = [
  'linear-gradient(135deg, #f0a8c4, #d96a95)',
  'linear-gradient(135deg, #e8c9a8, #c99263)',
  'linear-gradient(135deg, #d9a8e8, #a86ac9)',
  'linear-gradient(135deg, #f4bfae, #dd8368)',
  'linear-gradient(135deg, #a8cbe8, #6a92c9)',
]

export function AvatarRow({ small = false }) {
  return (
    <div className="mk-avatars" aria-hidden="true">
      {AVATAR_FILLS.map((bg, i) => (
        <span key={i} className={small ? 'mk-avatar mk-avatar--sm' : 'mk-avatar'} style={{ background: bg }} />
      ))}
    </div>
  )
}

// Primary audit CTA. Label is client copy, em dash included.
export function AuditCta({ label = 'Get Your DM Revenue Audit — $97', style }) {
  const navigate = useNavigate()
  return (
    <button className="mk-btn" style={style} onClick={() => navigate('/audit')}>
      {label}
    </button>
  )
}

// The avatars-plus-stars trust line used under CTAs.
export function TrustLine({ children }) {
  return (
    <div className="mk-trustline">
      <AvatarRow small />
      <div>
        <Stars size="0.85rem" />
        <div className="mk-trustline-text">{children}</div>
      </div>
    </div>
  )
}

// Blue verified seal (profile card).
export function VerifiedBadge({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label="Verified">
      <path
        d="M12 1.6l2.4 1.9 3-.4 1.2 2.8 2.8 1.2-.4 3 1.9 2.4-1.9 2.4.4 3-2.8 1.2-1.2 2.8-3-.4-2.4 1.9-2.4-1.9-3 .4-1.2-2.8-2.8-1.2.4-3L.7 12l1.9-2.4-.4-3L5 5.4 6.2 2.6l3 .4z"
        fill="#2f80ed"
      />
      <polyline points="8.2 12.3 10.8 14.9 15.8 9.6" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
