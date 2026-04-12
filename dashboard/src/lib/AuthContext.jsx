import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'

export const ALL_PERMISSIONS = [
  { key: 'inbox',            label: 'Setter Inbox',       description: 'View and make corrections in the inbox' },
  { key: 'bot_tester',      label: 'Bot Tester',         description: 'Test the bot in a chat interface' },
  { key: 'bot_tester_edit', label: 'Bot Tester — Edit',  description: 'Edit bot replies and save learnings from Tester' },
  { key: 'train_bot',       label: 'Train Bot',          description: 'Access the Train Bot page' },
  { key: 'learnings',       label: 'Learnings',          description: 'View all bot learnings' },
  { key: 'prompt_editor',   label: 'Prompt Editor',      description: 'Edit the bot system prompt' },
  { key: 'documents',       label: 'Documents',          description: 'Upload and manage knowledge documents' },
  { key: 'analytics',       label: 'Analytics',          description: 'View analytics and conversation data' },
  { key: 'user_management', label: 'User Management',    description: 'Invite and manage users' },
  { key: 'settings_admin',  label: 'Settings — Admin',   description: 'Control auto-send toggle and bot config' },
]

export const DEFAULT_CLIENT_PERMISSIONS = ['inbox', 'bot_tester', 'analytics']
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
