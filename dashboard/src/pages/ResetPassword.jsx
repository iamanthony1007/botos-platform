import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { usePublicScroll } from '../lib/usePublicScroll'

const LOGO_STACKED = 'https://rydkwsjwlgnivlwlvqku.supabase.co/storage/v1/object/public/assets/Logo%20horizontal.png'

const WRAP = {
  minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'var(--bg)', padding: '20px', fontFamily: "'Inter', sans-serif"
}
const CARD = {
  background: '#fff', borderRadius: 'var(--rlg)', padding: '32px',
  boxShadow: 'var(--shm)', border: '1px solid var(--bdr)'
}

export default function ResetPassword() {
  const navigate = useNavigate()
  usePublicScroll()
  const [checking, setChecking] = useState(true)
  const [ready, setReady] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    // Expired or already-used links come back with an error in the URL hash.
    const hash = window.location.hash || ''
    if (hash.includes('error')) {
      setChecking(false)
      return
    }

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) {
        setReady(true)
        setChecking(false)
      }
    })

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true)
      setChecking(false)
    })

    return () => sub.subscription.unsubscribe()
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    if (password !== confirm) { setError('Passwords do not match'); return }

    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      setLoading(false)
      setError(error.message || 'Could not update password. Try requesting a new link.')
      return
    }

    // Sign out so she logs in fresh with the new password. This also confirms
    // the new credentials actually work rather than riding the recovery session.
    await supabase.auth.signOut()
    setLoading(false)
    setDone(true)
    setTimeout(() => navigate('/login'), 2500)
  }

  return (
    <div style={WRAP}>
      <div style={{ width: '100%', maxWidth: '420px' }}>

        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <img src={LOGO_STACKED} alt="MU AI"
            style={{ width: '200px', height: 'auto', display: 'block', margin: '0 auto 10px' }} />
          <div style={{
            fontSize: '.78rem', color: 'var(--tx3)', letterSpacing: '.12em',
            textTransform: 'uppercase', fontWeight: 500
          }}>
            Intelligence in Motion
          </div>
        </div>

        <div style={CARD}>
          {checking ? (
            <div style={{ fontSize: '.85rem', color: 'var(--tx3)' }}>Checking your link...</div>

          ) : done ? (
            <div>
              <div style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--tx)', marginBottom: '8px' }}>
                Password updated
              </div>
              <div style={{ fontSize: '.85rem', color: 'var(--tx2)', lineHeight: 1.6 }}>
                Taking you to sign in...
              </div>
            </div>

          ) : !ready ? (
            <div>
              <div style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--tx)', marginBottom: '8px' }}>
                Link expired
              </div>
              <div style={{ fontSize: '.85rem', color: 'var(--tx2)', lineHeight: 1.6, marginBottom: '20px' }}>
                This reset link is no longer valid. Links expire after 1 hour and can only be
                used once.
              </div>
              <Link to="/forgot-password" style={{ fontSize: '.82rem', color: '#A0A090', textDecoration: 'underline' }}>
                Request a new link
              </Link>
            </div>

          ) : (
            <>
              <div style={{ marginBottom: '22px' }}>
                <div style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--tx)', marginBottom: '4px' }}>
                  Set a new password
                </div>
                <div style={{ fontSize: '.82rem', color: 'var(--tx3)' }}>
                  At least 8 characters
                </div>
              </div>

              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div className="form-group">
                  <label className="form-label">New password</label>
                  <input
                    className="form-input" type="password" placeholder="********"
                    value={password} onChange={e => setPassword(e.target.value)} required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Confirm new password</label>
                  <input
                    className="form-input" type="password" placeholder="********"
                    value={confirm} onChange={e => setConfirm(e.target.value)} required
                  />
                </div>

                {error && (
                  <div style={{ fontSize: '.8rem', color: 'var(--red)' }}>{error}</div>
                )}

                <button type="submit" disabled={loading} style={{
                  background: 'var(--acc)', color: 'var(--tx)', border: 'none', borderRadius: '8px',
                  padding: '12px', fontSize: '.9rem', fontWeight: 600,
                  cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.7 : 1,
                  boxShadow: '0 2px 10px rgba(212,175,55,.25)', transition: 'all .15s', marginTop: '4px'
                }}>
                  {loading ? 'Updating...' : 'Update password'}
                </button>
              </form>
            </>
          )}
        </div>

        <div style={{ textAlign: 'center', marginTop: '24px', fontSize: '.76rem', color: '#B8B8A8' }}>
          MU AI &copy; 2026
        </div>
      </div>
    </div>
  )
}
