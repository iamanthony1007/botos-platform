import { useNavigate } from 'react-router-dom'

// Same logo the Landing topbar used (the horizontal-layout image; the constant
// names in Landing.jsx are swapped at source, do not "fix" here).
const LOGO = 'https://rydkwsjwlgnivlwlvqku.supabase.co/storage/v1/object/public/assets/Logo%20stacked.png'

// Sticky, frosted header shared by the public marketing pages. Content scrolls
// under it. Logo returns home, the button goes to the client login.
export default function PublicHeader() {
  const navigate = useNavigate()
  return (
    <header
      style={{
        position: 'sticky', top: 0, zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
        padding: '10px clamp(16px, 4vw, 40px)',
        background: 'rgba(245,244,239,0.82)',
        backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(0,0,0,0.06)'
      }}
    >
      <button
        onClick={() => navigate('/')}
        aria-label="MU AI, home"
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex' }}
      >
        <img src={LOGO} alt="MU AI" style={{ height: '44px', width: 'auto', display: 'block' }} />
      </button>
      <button
        onClick={() => navigate('/login')}
        style={{
          background: 'var(--acc)', color: 'var(--tx)', border: 'none',
          padding: '9px 20px', borderRadius: '8px', fontSize: '14px',
          fontWeight: 700, cursor: 'pointer', fontFamily: "'Inter', sans-serif", whiteSpace: 'nowrap'
        }}
      >
        Client Login
      </button>
    </header>
  )
}
