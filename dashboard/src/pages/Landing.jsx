import { useNavigate } from 'react-router-dom'

const LOGO_HORIZONTAL = 'https://rydkwsjwlgnivlwlvqku.supabase.co/storage/v1/object/public/assets/Logo%20stacked.png'
const LOGO_STACKED = 'https://rydkwsjwlgnivlwlvqku.supabase.co/storage/v1/object/public/assets/Logo%20horizontal.png'

export default function Landing() {
  const navigate = useNavigate()

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      fontFamily: "'Inter', sans-serif", position: 'relative',
      overflow: 'hidden', background: '#B8B0A0'
    }}>

      {/* Base gradient */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse at 55% 45%, #DDD8C8 0%, #C8C0A8 35%, #B0A890 60%, #9A9078 85%, #807868 100%)'
      }} />

      {/* Rays */}
      <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        <svg width="100%" height="100%" viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <filter id="s1"><feGaussianBlur stdDeviation="18"/></filter>
            <filter id="s2"><feGaussianBlur stdDeviation="12"/></filter>
          </defs>
          <path d="M -100 700 Q 300 350 900 50"   stroke="rgba(245,242,235,0.55)" strokeWidth="140" fill="none" filter="url(#s1)"/>
          <path d="M -150 650 Q 250 320 880 10"   stroke="rgba(245,242,235,0.4)"  strokeWidth="110" fill="none" filter="url(#s1)"/>
          <path d="M -80  750 Q 350 400 950 120"  stroke="rgba(245,242,235,0.45)" strokeWidth="120" fill="none" filter="url(#s1)"/>
          <path d="M -200 600 Q 180 300 850 -20"  stroke="rgba(245,242,235,0.3)"  strokeWidth="90"  fill="none" filter="url(#s1)"/>
          <path d="M -50  780 Q 400 450 980 180"  stroke="rgba(245,242,235,0.35)" strokeWidth="100" fill="none" filter="url(#s1)"/>
          <path d="M 50   800 Q 450 500 1000 250" stroke="rgba(245,242,235,0.25)" strokeWidth="80"  fill="none" filter="url(#s2)"/>
          <path d="M 150  820 Q 500 540 1020 300" stroke="rgba(245,242,235,0.2)"  strokeWidth="70"  fill="none" filter="url(#s2)"/>
          <radialGradient id="cg" cx="52%" cy="44%" r="35%">
            <stop offset="0%"   stopColor="#F5F2EC" stopOpacity="0.6"/>
            <stop offset="100%" stopColor="#F5F2EC" stopOpacity="0"/>
          </radialGradient>
          <rect width="800" height="600" fill="url(#cg)"/>
        </svg>
      </div>

      {/* Topbar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '18px 48px', position: 'relative', zIndex: 2
      }}>
        <img src={LOGO_HORIZONTAL} alt="MU AI" style={{ height: '100px', width: 'auto' }} />
        <button onClick={() => navigate('/login')} style={{
          background: '#D4AF37', color: '#1A1A1A', border: 'none',
          padding: '10px 24px', borderRadius: '8px', fontSize: '14px',
          fontWeight: 700, cursor: 'pointer', fontFamily: "'Inter', sans-serif"
        }}>
          Get Started
        </button>
      </div>

      {/* Hero */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', padding: '20px 40px 100px',
        position: 'relative', zIndex: 1
      }}>
        <img src={LOGO_STACKED} alt="MU AI" style={{ width: '220px', height: 'auto', marginBottom: '6px' }} />

        <div style={{
          fontSize: '12px', color: 'rgba(40,35,25,0.6)', letterSpacing: '.16em',
          textTransform: 'uppercase', fontWeight: 500, marginBottom: '28px'
        }}>
          Intelligence in Motion
        </div>

        <h1 style={{
          fontFamily: "'Playfair Display', 'Georgia', serif",
          fontSize: '48px', fontWeight: 700, color: '#18160E',
          margin: '0 0 16px', lineHeight: 1.15, maxWidth: '580px'
        }}>
          Intelligence at speed.
        </h1>

        <p style={{
          fontSize: '17px', color: 'rgba(30,25,15,0.68)',
          maxWidth: '480px', lineHeight: 1.75, margin: '0 0 44px'
        }}>
          MU AI delivers fast, precise, and adaptive AI systems built for the future.
        </p>

        <div style={{ display: 'flex', gap: '14px', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => navigate('/login')} style={{
            background: '#D4AF37', color: '#1A1A1A', border: 'none',
            padding: '15px 36px', borderRadius: '10px', fontSize: '16px',
            fontWeight: 700, cursor: 'pointer',
            boxShadow: '0 4px 20px rgba(160,110,0,0.25)',
            fontFamily: "'Inter', sans-serif"
          }}>
            Get Started
          </button>
          <button onClick={() => navigate('/login')} style={{
            background: '#1A1A1A', color: '#fff', border: 'none',
            padding: '15px 36px', borderRadius: '10px', fontSize: '16px',
            fontWeight: 600, cursor: 'pointer', fontFamily: "'Inter', sans-serif"
          }}>
            Learn More
          </button>
        </div>
      </div>

      {/* Footer */}
      <div style={{
        textAlign: 'center', padding: '18px', fontSize: '12px',
        color: 'rgba(40,35,25,0.4)', position: 'relative', zIndex: 1
      }}>
        MU AI © 2026
      </div>
    </div>
  )
}