import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { useState } from 'react'

export default function Layout() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  async function handleSignOut() { await signOut(); navigate('/login') }

  const isSetter = profile?.role === 'setter'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <div style={{ height: 'var(--topH)', background: 'var(--acc)', display: 'flex', alignItems: 'center', padding: '0 16px', gap: '12px', flexShrink: 0, boxShadow: '0 2px 8px rgba(45,106,79,.3)', zIndex: 100 }}>
        <button onClick={() => setSidebarOpen(!sidebarOpen)} style={{ display: 'none', flexDirection: 'column', gap: '4px', background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }} className="ham-btn">
          <span style={{ display: 'block', width: '20px', height: '2px', background: '#fff', borderRadius: '2px' }} />
          <span style={{ display: 'block', width: '20px', height: '2px', background: '#fff', borderRadius: '2px' }} />
          <span style={{ display: 'block', width: '20px', height: '2px', background: '#fff', borderRadius: '2px' }} />
        </button>
        <div style={{ fontFamily: '"DM Serif Display", serif', fontSize: '1.1rem', color: '#fff', letterSpacing: '-.02em' }}>BotOS</div>
        <div style={{ width: '1px', height: '18px', background: 'rgba(255,255,255,.25)' }} />
        <span style={{ fontSize: '.8rem', fontWeight: 500, color: 'rgba(255,255,255,.85)', flex: 1 }}>{profile?.organizations?.name || 'Platform'}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#95e3b0', animation: 'pulse 2s ease-in-out infinite' }} />
          <span style={{ fontSize: '.74rem', color: 'rgba(255,255,255,.85)' }}>Live</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'rgba(255,255,255,.2)', border: '1px solid rgba(255,255,255,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.68rem', fontWeight: 600, color: '#fff' }}>{profile?.full_name?.[0]?.toUpperCase() || 'U'}</div>
          <button onClick={handleSignOut} style={{ background: 'rgba(255,255,255,.15)', border: '1px solid rgba(255,255,255,.2)', color: '#fff', padding: '5px 10px', borderRadius: 'var(--rsm)', fontSize: '.75rem', cursor: 'pointer', fontFamily: 'var(--fn)' }}>Sign out</button>
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {sidebarOpen && <div onClick={() => setSidebarOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.3)', zIndex: 85 }} />}

        <div style={{ width: 'var(--sideW)', background: 'var(--surf)', borderRight: '1px solid var(--bdr)', display: 'flex', flexDirection: 'column', flexShrink: 0, boxShadow: 'var(--sh)', zIndex: 90, overflowY: 'auto' }}>
          <div style={{ padding: '16px 14px 5px', fontSize: '.65rem', fontWeight: 600, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--tx3)' }}>Main</div>
          {!isSetter && <SideLink to="/" label="Dashboard" icon="📊" end />}
          <SideLink to="/inbox" label="Setter Inbox" icon="💬" />
          {!isSetter && <SideLink to="/tester" label="Bot Tester" icon="🧪" />}

          {!isSetter && <>
            <div style={{ padding: '16px 14px 5px', fontSize: '.65rem', fontWeight: 600, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--tx3)' }}>Bot Training</div>
            <SideLink to="/train" label="Train Bot" icon="🎓" />
            <SideLink to="/learnings" label="Learnings" icon="🧠" />
          </>}

          {!isSetter && <>
            <div style={{ padding: '16px 14px 5px', fontSize: '.65rem', fontWeight: 600, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--tx3)' }}>Bot Config</div>
            <SideLink to="/prompt" label="Prompt Editor" icon="✏️" />
            <SideLink to="/documents" label="Documents" icon="📄" />
          </>}

          {!isSetter && <>
            <div style={{ padding: '16px 14px 5px', fontSize: '.65rem', fontWeight: 600, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--tx3)' }}>Analytics</div>
            <SideLink to="/analytics" label="Analytics" icon="📈" />
          </>}

          <div style={{ marginTop: 'auto', padding: '10px 6px', borderTop: '1px solid var(--bdr)' }}>
            <SideLink to="/settings" label="Settings" icon="⚙️" />
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <Outlet />
        </div>
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}} @media(max-width:767px){.ham-btn{display:flex!important}}`}</style>
    </div>
  )
}

function SideLink({ to, label, icon, end }) {
  return (
    <NavLink to={to} end={end} style={({ isActive }) => ({ display: 'flex', alignItems: 'center', gap: '9px', padding: '10px 12px', borderRadius: 'var(--rsm)', margin: '1px 6px', textDecoration: 'none', fontSize: '.84rem', fontWeight: isActive ? 500 : 400, color: isActive ? 'var(--acc)' : 'var(--tx2)', background: isActive ? 'var(--accl)' : 'transparent', transition: 'all .15s' })}>
      <span style={{ width: '16px', textAlign: 'center', fontSize: '13px' }}>{icon}</span>
      {label}
    </NavLink>
  )
}
