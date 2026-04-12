import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { DEFAULT_CLIENT_PERMISSIONS } from '../lib/AuthContext'

const LOGO = 'https://rydkwsjwlgnivlwlvqku.supabase.co/storage/v1/object/public/assets/Logo%20horizontal.png'

export default function AcceptInvite() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token')

  const [invite, setInvite] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!token) { setError('Invalid invite link'); setLoading(false); return }
    loadInvite()
  }, [token])

  async function loadInvite() {
    try {
      const { data, error } = await supabase
        .from('invites')
        .select('id, email, name, token, role, status, expires_at, assigned_bot_id, permissions, bots (name)')
        .eq('token', token)
        .eq('status', 'pending')
        .single()

      if (error || !data) { setError('Invite not found or has already been used'); setLoading(false); return }
      if (new Date(data.expires_at) < new Date()) { setError('This invite has expired'); setLoading(false); return }

      setInvite(data)
      setLoading(false)
    } catch (err) {
      setError('Failed to load invite')
      setLoading(false)
    }
  }

  async function acceptInvite(e) {
    e.preventDefault()
    if (!password || !confirmPassword) { setError('Please fill in all fields'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    if (password !== confirmPassword) { setError('Passwords do not match'); return }

    setSubmitting(true)
    setError('')

    try {
      let userId = null

      // Try to sign up first
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: invite.email,
        password: password
      })

      if (signUpError?.message?.toLowerCase().includes('already registered') ||
          signUpError?.message?.toLowerCase().includes('already been registered')) {
        // Auth account exists — sign in with the provided password
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email: invite.email,
          password: password
        })
        if (signInError) {
          throw new Error('This email already has an account with a different password. Please contact your admin.')
        }
        userId = signInData.user.id
      } else if (signUpError) {
        throw signUpError
      } else {
        userId = signUpData.user?.id
        if (!userId) throw new Error('Failed to create account')

        // Sign in after signup so RLS allows profile write
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: invite.email,
          password: password
        })
        if (signInError) throw signInError
      }

      // Save / update profile with role, permissions, and re-enable if disabled
      const isAdminRole = invite.role === 'admin' || invite.role === 'superadmin'
      const { error: profileError } = await supabase
        .from('profiles')
        .upsert({
          id: userId,
          email: invite.email,
          name: invite.name || '',
          role: invite.role,
          assigned_bot_id: invite.assigned_bot_id || null,
          disabled: false,
          permissions: isAdminRole ? null : (invite.permissions || DEFAULT_CLIENT_PERMISSIONS),
        }, { onConflict: 'id' })

      if (profileError) console.error('Profile upsert error:', profileError)

      // Mark invite as used
      await supabase
        .from('invites')
        .update({ status: 'accepted', accepted_at: new Date().toISOString() })
        .eq('id', invite.id)

      navigate('/')
    } catch (err) {
      console.error('Error accepting invite:', err)
      setError(err.message || 'Failed to create account')
      setSubmitting(false)
    }
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div className="spinner" />
    </div>
  )

  if (error && !invite) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '20px' }}>
      <div className="card" style={{ maxWidth: '400px', width: '100%', padding: '32px', textAlign: 'center' }}>
        <div style={{ fontSize: '3rem', marginBottom: '16px' }}>⚠️</div>
        <div style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '8px', color: 'var(--tx)' }}>Invalid Invite</div>
        <div style={{ fontSize: '.9rem', color: 'var(--tx2)', marginBottom: '20px' }}>{error}</div>
        <button className="btn btn-ghost" onClick={() => navigate('/')}>Go to Login</button>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '20px' }}>
      <div className="card" style={{ maxWidth: '480px', width: '100%', padding: '32px' }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <img src={LOGO} alt="MU AI" style={{ height: '60px', width: 'auto', marginBottom: '8px' }} />
          <div style={{ fontSize: '.82rem', color: 'var(--tx3)', letterSpacing: '.1em', textTransform: 'uppercase' }}>Intelligence in Motion</div>
        </div>

        {/* Invite details */}
        <div style={{ padding: '16px', background: 'var(--accp)', border: '1px solid var(--accl)', borderRadius: 'var(--rsm)', marginBottom: '24px' }}>
          <div style={{ fontSize: '.84rem', color: 'var(--tx3)', marginBottom: '6px' }}>You've been invited as:</div>
          <div style={{ fontSize: '.95rem', fontWeight: 600, color: 'var(--tx)', marginBottom: '6px' }}>{invite.email}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '.8rem', color: 'var(--tx3)' }}>Role:</span>
            <span className={`badge ${invite.role === 'client' ? 'badge-blue' : invite.role === 'setter' ? 'badge-green' : 'badge-gold'}`}>{invite.role}</span>
            {invite.bots?.name && (
              <>
                <span style={{ fontSize: '.8rem', color: 'var(--tx3)' }}>Bot:</span>
                <span style={{ fontSize: '.82rem', fontWeight: 600, color: 'var(--tx)' }}>{invite.bots.name}</span>
              </>
            )}
          </div>
        </div>

        {/* Password form */}
        <form onSubmit={acceptInvite} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="form-group">
            <label className="form-label">Create Password</label>
            <input
              type="password"
              className="form-input"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              disabled={submitting}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Confirm Password</label>
            <input
              type="password"
              className="form-input"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="Re-enter password"
              disabled={submitting}
            />
          </div>

          {error && (
            <div style={{ padding: '12px', background: 'var(--redbg)', border: '1px solid var(--redbd)', borderRadius: 'var(--rsm)', color: 'var(--red)', fontSize: '.85rem' }}>
              {error}
            </div>
          )}

          <button type="submit" className="btn btn-primary" disabled={submitting} style={{ width: '100%', justifyContent: 'center', padding: '12px' }}>
            {submitting ? 'Setting up your account...' : 'Create Account & Sign In'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '16px', fontSize: '.76rem', color: 'var(--tx3)' }}>
          By creating an account, you agree to the platform's terms of service and privacy policy.
        </div>
      </div>
    </div>
  )
}