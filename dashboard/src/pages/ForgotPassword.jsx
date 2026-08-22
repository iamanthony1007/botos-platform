import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const LOGO_STACKED = 'https://rydkwsjwlgnivlwlvqku.supabase.co/storage/v1/object/public/assets/Logo%20horizontal.png'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`
    })

    setLoading(false)
    if (error) setError('Something went wrong. Please try again.')
    else setSent(true)
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#F5F5F0', padding: '20px', fontFamily: "'Inter', sans-serif"
    }}>
      <div style={{ width: '100%', maxWidth: '420px' }}>

        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <img src={LOGO_STACKED} alt="MU AI"
            style={{ width: '200px', height: 'auto', display: 'block', margin: '0 auto 10px' }} />
          <div style={{
            fontSize: '.78rem', color: '#9A9A8A', letterSpacing: '.12em',
            textTransform: 'uppercase', fontWeight: 500
          }}>
            Intelligence in Motion
          </div>
        </div>

        <div style={{
          background: '#fff', borderRadius: '16px', padding: '32px',
          boxShadow: '0 4px 24px rgba(0,0,0,.07)', border: '1px solid #E8E6DE'
        }}>
          {sent ? (
            <div>
              <div style={{ fontSize: '1.15rem', fontWeight: 600, color: '#1A1A1A', marginBottom: '8px' }}>
                Check your email
              </div>
              <div style={{ fontSize: '.85rem', color: '#6A6A5A', lineHeight: 1.6, marginBottom: '20px' }}>
                If an account exists for {email}, we've sent a link to reset your password.
                The link expires in 1 hour.
              </div>
              <Link to="/login" style={{ fontSize: '.82rem', color: '#A0A090', textDecoration: 'underline' }}>
                Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: '22px' }}>
                <div style={{ fontSize: '1.15rem', fontWeight: 600, color: '#1A1A1A', marginBottom: '4px' }}>
                  Reset password
                </div>
                <div style={{ fontSize: '.82rem', color: '#9A9A8A' }}>
                  We'll email you a link to set a new one
                </div>
              </div>

              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input
                    className="form-input" type="email" placeholder="you@example.com"
                    value={email} onChange={e => setEmail(e.target.value)} required
                  />
                </div>

                {error && (
                  <div style={{ fontSize: '.8rem', color: '#C0392B' }}>{error}</div>
                )}

                <button type="submit" disabled={loading} style={{
                  background: '#D4AF37', color: '#1A1A1A', border: 'none', borderRadius: '8px',
                  padding: '12px', fontSize: '.9rem', fontWeight: 600,
                  cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.7 : 1,
                  boxShadow: '0 2px 10px rgba(212,175,55,.25)', transition: 'all .15s', marginTop: '4px'
                }}>
                  {loading ? 'Sending...' : 'Send reset link'}
                </button>

                <div style={{ textAlign: 'center' }}>
                  <Link to="/login" style={{ fontSize: '.8rem', color: '#A0A090', textDecoration: 'underline' }}>
                    Back to sign in
                  </Link>
                </div>
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
