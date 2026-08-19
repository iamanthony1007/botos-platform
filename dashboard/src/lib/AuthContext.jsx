import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'

export const ALL_PERMISSIONS = [
  { key: 'inbox',            label: 'Setter Inbox',       description: 'View and make corrections in the inbox' },
  { key: 'bot_tester',      label: 'Bot Tester',         description: 'Test the bot in a chat interface' },
  { key: 'bot_tester_edit', label: 'Bot Tester (Edit)',  description: 'Edit bot replies and save learnings from Tester' },
  // Connecting a messaging account is deliberately SEPARATE from settings_admin.
  // Connecting or reconnecting an Instagram account is a different job from
  // configuring automation: a setter may legitimately need to reconnect an
  // expired token without being handed the master auto-send switch and the whole
  // bot config. It also lets an account be scoped to "inbox plus connect", which
  // is exactly what the Meta App Review account gets.
  { key: 'connections',     label: 'Connections',        description: 'Connect and reconnect the Instagram account' },
  { key: 'train_bot',       label: 'Train Bot',          description: 'Access the Train Bot page' },
  { key: 'learnings',       label: 'Learnings',          description: 'View all bot learnings' },
  { key: 'prompt_editor',   label: 'Prompt Editor',      description: 'Edit the bot system prompt' },
  { key: 'documents',       label: 'Documents',          description: 'Upload and manage knowledge documents' },
  { key: 'analytics',       label: 'Analytics',          description: 'View analytics and conversation data' },
  { key: 'user_management', label: 'User Management',    description: 'Invite and manage users' },
  { key: 'settings_admin',  label: 'Settings (Admin)',   description: 'Control auto-send toggle and bot config' },
]

// 'connections' added to the client default: a client who cannot connect their
// own Instagram account cannot use the product at all on day one, which is the
// gap this whole branch exists to close. This only pre-ticks the box on the
// invite form, which an admin can still untick; it grants nothing retroactively.
// Setters stay inbox-only by default and get 'connections' deliberately, per
// account, the way the Meta App Review account does.
export const DEFAULT_CLIENT_PERMISSIONS = ['inbox', 'bot_tester', 'analytics', 'connections']
export const DEFAULT_SETTER_PERMISSIONS = ['inbox']

export const ROLE_OPTIONS_FOR = {
  superadmin: ['admin', 'client', 'setter'],
  admin:      ['client', 'setter'],
  client:     ['setter'],
  setter:     [],
}

const AuthContext = createContext({})

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) { setUser(session.user); fetchProfile(session.user.id) }
      else setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) { setUser(session.user); fetchProfile(session.user.id) }
      else { setUser(null); setProfile(null); setLoading(false) }
    })
    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile(userId) {
  const { data } = await supabase.from('profiles').select('*').eq('id', userId).single()
  if (data?.disabled) {
    await supabase.auth.signOut()
    setLoading(false)
    return
  }
  setProfile(data || null)
  setLoading(false)
}

  const isFullAccess = (role) => role === 'admin' || role === 'superadmin'

  function can(permission) {
    if (!profile) return false
    if (isFullAccess(profile.role)) return true
    return Array.isArray(profile.permissions) && profile.permissions.includes(permission)
  }

  function canInvite(targetRole) {
    if (!profile) return false
    return ROLE_OPTIONS_FOR[profile.role]?.includes(targetRole) ?? false
  }

  function canRemove(targetProfile) {
    if (!profile) return false
    if (profile.id === targetProfile.id) return false // never remove yourself
    if (profile.role === 'superadmin') return true
    if (profile.role === 'admin') return ['client', 'setter'].includes(targetProfile.role)
    if (profile.role === 'client') {
      return targetProfile.role === 'setter' &&
             targetProfile.assigned_bot_id === profile.assigned_bot_id
    }
    return false
  }

  const isAdmin = profile ? isFullAccess(profile.role) : false

  async function signIn(email, password) {
    return await supabase.auth.signInWithPassword({ email, password })
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, isAdmin, can, canInvite, canRemove, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
