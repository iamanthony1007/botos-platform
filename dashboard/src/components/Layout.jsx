import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { getAssignedBot } from '../lib/botHelper'

const LOGO_HORIZONTAL = 'https://rydkwsjwlgnivlwlvqku.supabase.co/storage/v1/object/public/assets/Logo%20stacked.png'

const Icons = {
  dashboard: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
    </svg>
  ),
  inbox: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  ),
  tester: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2v-4M9 21H5a2 2 0 0 1-2-2v-4m0 0h18"/>
    </svg>
  ),
  train: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
    </svg>
  ),
  learnings: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
    </svg>
  ),
  prompt: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
    </svg>
  ),
  documents: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
    </svg>
  ),
  analytics: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/>
      <line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/>
    </svg>
  ),
  users: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  settings: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  ),
}

export default function Layout() {
  const { profile, can, signOut } = useAuth()
  const navigate = useNavigate()
  const [unreadCount, setUnreadCount] = useState(0)
  const channelRef = useRef(null)

  useEffect(() => {
    if (!profile || !can('inbox')) return
    loadUnreadCount()
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current) }
  }, [profile])

  async function loadUnreadCount() {
    const bot = await getAssignedBot(profile, 'id')
    if (!bot) return
    const { count } = await supabase
      .from('reviews').select('*', { count: 'exact', head: true })
      .eq('bot_id', bot.id).eq('status', 'pending')
    setUnreadCount(count || 0)

    if (channelRef.current) supabase.removeChannel(channelRef.current)
    const channel = supabase.channel(`layout-inbox-${bot.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reviews', filter: `bot_id=eq.${bot.id}` }, () => {
        supabase.from('reviews').select('*', { count: 'exact', head: true })
          .eq('bot_id', bot.id).eq('status', 'pending')
          .then(({ count: c }) => setUnreadCount(c || 0))
      })
      .subscribe()
    channelRef.current = channel
  }

  async function handleSignOut() {
    await signOut()
    navigate('/')
  }

  const sectionHeader = {
    padding: '16px 14px 5px',
    fontSize: '.65rem',
    fontWeight: 700,
    letterSpacing: '.09em',
    textTransform: 'uppercase',
    color: '#B0B0A0'
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

      {/* TOPBAR */}
      <div style={{
        height: 'var(--topH)', background: '#FFFFFF', borderBottom: '1px solid #E8E6DE',
        display: 'flex', alignItems: 'center', padding: '0 20px', gap: '14px',
        flexShrink: 0, boxShadow: '0 1px 4px rgba(0,0,0,.06)', zIndex: 100
      }}>
        <img src={LOGO_HORIZONTAL} alt="MU AI" style={{ height: '90px', width: 'auto' }} />
        <div style={{ width: '1px', height: '20px', background: '#E8E6DE' }} />
        <span style={{ fontSize: '.78rem', color: '#A0A090', flex: 1, letterSpacing: '.04em' }}>Intelligence in Motion</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#D4AF37', animation: 'pulse 2s ease-in-out infinite' }} />
            <span style={{ fontSize: '.73rem', color: '#8A8A7A' }}>Live</span>
          </div>
          <span style={{ fontSize: '.82rem', color: '#4A4A4A', fontWeight: 500 }}>{profile?.name || profile?.email}</span>
          <button onClick={handleSignOut} style={{
            background: '#F5F5F0', border: '1px solid #E2E0D8', color: '#4A4A4A',
            borderRadius: '8px', padding: '5px 14px', fontSize: '.76rem', cursor: 'pointer',
            fontFamily: "'Inter', sans-serif", fontWeight: 500
          }}>Sign out</button>
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* SIDEBAR */}
        <div style={{
          width: 'var(--sideW)', background: '#FFFFFF', borderRight: '1px solid #E8E6DE',
          display: 'flex', flexDirection: 'column', flexShrink: 0, zIndex: 90, overflowY: 'auto'
        }}>
          <div style={sectionHeader}>Main</div>
          <SideLink to="/dashboard"           label="Dashboard"      icon={Icons.dashboard} end />
          <div style={sectionHeader}>Live</div>
          {can('inbox')           && <SideLink to="/dashboard/inbox"     label="Active Conversations"   icon={Icons.inbox}     badge={unreadCount} />}
          {can('bot_tester')      && <SideLink to="/dashboard/tester"    label="Conversation Simulator"     icon={Icons.tester} />}

          {(can('train_bot') || can('learnings')) && <div style={sectionHeader}>Improve AI</div>}
          {can('train_bot')       && <SideLink to="/dashboard/train"     label="AI Behavior"      icon={Icons.train} />}
          {can('learnings')       && <SideLink to="/dashboard/learnings" label="AI Learning Log"      icon={Icons.learnings} />}

          {(can('prompt_editor') || can('documents')) && <div style={sectionHeader}>Knowledge</div>}
          {can('prompt_editor')   && <SideLink to="/dashboard/prompt"    label="AI Behavior"  icon={Icons.prompt} />}
          {can('documents')       && <SideLink to="/dashboard/documents" label="Knowledge Base"      icon={Icons.documents} />}

          {can('analytics') && (
            <>
              <div style={sectionHeader}>Analytics</div>
              <SideLink to="/dashboard/analytics" label="Analytics" icon={Icons.analytics} />
            </>
          )}

          {can('user_management') && (
            <>
              <div style={sectionHeader}>Team</div>
              <SideLink to="/dashboard/users" label="Team" icon={Icons.users} />
            </>
          )}

          {can('settings_admin') && (
            <div style={{ padding: '8px 6px', borderTop: '1px solid #E8E6DE' }}>
              <SideLink to="/dashboard/settings" label="Settings" icon={Icons.settings} />
            </div>
          )}

          {/* Profile at bottom */}
          <div style={{ marginTop: 'auto', borderTop: '1px solid #E8E6DE', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '34px', height: '34px', borderRadius: '50%', flexShrink: 0,
              background: '#D4AF37', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '.88rem', fontWeight: 700, color: '#1A1A1A'
            }}>
              {(profile?.name || profile?.email || 'U').charAt(0).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '.84rem', fontWeight: 600, color: '#1A1A1A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {profile?.name || 'User'}
              </div>
              <div style={{ fontSize: '.72rem', color: '#A0A090' }}>{profile?.role}</div>
            </div>
            <span style={{ fontSize: '.7rem', color: '#C0C0B0' }}>▾</span>
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <Outlet />
        </div>
      </div>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }`}</style>
    </div>
  )
}

function SideLink({ to, label, icon, end, badge }) {
  return (
    <NavLink to={to} end={end} style={({ isActive }) => ({
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '10px 13px', borderRadius: '8px', margin: '1px 8px',
      textDecoration: 'none',
      fontSize: '.86rem',
      fontWeight: isActive ? 700 : 500,
      color: isActive ? '#B8961E' : '#3A3A2E',
      background: isActive ? '#FAF6E8' : 'transparent',
      borderLeft: isActive ? '2px solid #D4AF37' : '2px solid transparent',
      transition: 'all .15s'
    })}>
      <span style={{ width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {icon}
      </span>
      <span style={{ flex: 1, letterSpacing: '.01em' }}>{label}</span>
      {badge > 0 && (
        <span style={{
          background: '#C0392B', color: '#fff', borderRadius: '999px',
          fontSize: '.62rem', fontWeight: 700, minWidth: '18px', height: '18px',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          padding: '0 5px', flexShrink: 0
        }}>{badge > 99 ? '99+' : badge}</span>
      )}
    </NavLink>
  )
}