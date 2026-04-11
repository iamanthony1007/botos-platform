import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { DEFAULT_CLIENT_PERMISSIONS } from '../lib/AuthContext'

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
    if (!token) {
      setError('Invalid invite link')
      setLoading(false)
      return
    }
    loadInvite()
  }, [token])

  async function loadInvite() {
    try {
      const { data, error } = await supabase
        .from('invites')
        .select(`
          id,
          email,
          name,
          token,
          role,
          status,
          expires_at,
          assigned_bot_id,
          permissions,
          bots (name)
        `)
        .eq('token', token)
        .eq('status', 'pending')
        .single()

      if (error || !data) {
        setError('Invite not found or has already been used')
        setLoading(false)
        return
      }

      // Check if expired
      if (new Date(data.expires_at) < new Date()) {
        setError('This invite has expired')
        setLoading(false)
        return
      }

      setInvite(data)
      setLoading(false)

    } catch (err) {
      console.error('Error loading invite:', err)
      setError('Failed to load invite')
      setLoading(false)
    }
  }

  async function acceptInvite(e) {
    e.preventDefault()
    
    if (!password || !confirmPassword) {
      setError('Please fill in all fields')
      return
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setSubmitting(true)
    setError('')

    try {
      // Step 1 — Create the auth account
      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email: invite.email,
        password: password
      })

      if (signUpError) throw signUpError
      if (!authData.user) throw new Error('Failed to create account')

      // Step 2 — Sign in FIRST so RLS allows writing the profile
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: invite.email,
        password: password
      })

      if (signInError) throw signInError

      // Step 3 — Now authenticated, save profile with role and permissions
      const isAdminRole = invite.role === 'admin' || invite.role === 'superadmin'
      const { error: profileError } = await supabase
        .from('profiles')
        .upsert({
          id: authData.user.id,
          email: invite.email,
          name: invite.name || '',
          role: invite.role,
          assigned_bot_id: invite.assigned_bot_id || null,
          permissions: isAdminRole ? null : (invite.permissions || DEFAULT_CLIENT_PERMISSIONS),
        }, { onConflict: 'id' })

      if (profileError) {
        console.error('Profile upsert error:', profileError)
      }

      // Step 4 — Mark invite as used
      await supabase
        .from('invites')
        .update({ status: 'accepted', accepted_at: new Date().toISOString() })
        .eq('id', invite.id)

      // Step 5 — Go to dashboard
      navigate('/')

    } catch (err) {
      console.error('Error accepting invite:', err)
      setError(err.message || 'Failed to create account')
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)'
      }}>
        <div className="spinner" />
      </div>
    )
  }

  if (error && !invite) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)',
        padding: '20px'
      }}>
        <div className="card" style={{ maxWidth: '400px', width: '100%', padding: '32px', textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '16px' }}>⚠️</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '8px', color: 'var(--tx)' }}>
            Invalid Invite
          </div>
          <div style={{ fontSize: '.9rem', color: 'var(--tx2)', marginBottom: '20px' }}>
            {error}
          </div>
          <button 
            className="btn btn-ghost"
            onClick={() => navigate('/')}
          >
            Go to Login
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg)',
      padding: '20px'
    }}>
      <div className="card" style={{ maxWidth: '480px', width: '100%', padding: '32px' }}>
        <div style={{ marginBottom: '24px', textAlign: 'center' }}>
          <div style={{
            fontFamily: '"DM Serif Display", serif',
            fontSize: '1.8rem',
            color: 'var(--acc)',
            marginBottom: '8px'
          }}>
            BotOS
          </div>
          <div style={{ fontSize: '1rem', color: 'var(--tx2)' }}>
            Welcome to the platform!
          </div>
        </div>

        <div style={{
          padding: '16px',
          background: 'var(--accp)',
          border: '1px solid var(--accl)',
          borderRadius: 'var(--rsm)',
          marginBottom: '24px'
        }}>
          <div style={{ fontSize: '.85rem', color: 'var(--tx2)', marginBottom: '8px' }}>
            You've been invited as:
          </div>
          <div style={{ fontSize: '.95rem', fontWeight: 600, color: 'var(--tx)', marginBottom: '4px' }}>
            {invite.email}
          </div>
          <div style={{ fontSize: '.82rem', color: 'var(--tx3)' }}>
            Role: <span className={`badge ${invite.role === 'client' ? 'badge-blue' : 'badge-green'}`} style={{ marginLeft: '6px' }}>
              {invite.role}
            </span>
            {invite.bots && (
              <span style={{ marginLeft: '12px' }}>
                Bot: <strong>{invite.bots.name}</strong>
              </span>
            )}
          </div>
        </div>

        <form onSubmit={acceptInvite}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{
              display: 'block',
              fontSize: '.85rem',
              fontWeight: 500,
              marginBottom: '6px',
              color: 'var(--tx2)'
            }}>
              Create Password
            </label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              disabled={submitting}
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{
              display: 'block',
              fontSize: '.85rem',
              fontWeight: 500,
              marginBottom: '6px',
              color: 'var(--tx2)'
            }}>
              Confirm Password
            </label>
            <input
              type="password"
              className="input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter password"
              disabled={submitting}
            />
          </div>

          {error && (
            <div style={{
              padding: '12px',
              background: 'var(--redbg)',
              border: '1px solid var(--redbd)',
              borderRadius: 'var(--rsm)',
              color: 'var(--red)',
              fontSize: '.85rem',
              marginBottom: '16px'
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting}
            style={{ width: '100%' }}
          >
            {submitting ? 'Creating Account...' : 'Create Account & Sign In'}
          </button>
        </form>

        <div style={{
          marginTop: '20px',
          padding: '12px',
          background: 'var(--surf2)',
          borderRadius: 'var(--rsm)',
          fontSize: '.78rem',
          color: 'var(--tx3)',
          lineHeight: 1.5
        }}>
          By creating an account, you agree to the platform's terms of service and privacy policy.
        </div>
      </div>
    </div>
  )
}