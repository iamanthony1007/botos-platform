import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'

const LOGO_STACKED = 'https://rydkwsjwlgnivlwlvqku.supabase.co/storage/v1/object/public/assets/Logo%20horizontal.png'

export default function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await signIn(email, password)
    if (error) { setError('Invalid email or password'); setLoading(false) }
    else navigate('/dashboard')
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#F5F5F0', padding: '20px', fontFamily: "'Inter', sans-serif"
    }}>
      <div style={{ width: '100%', maxWidth: '420px' }}>

        {/* Logo — no box, just the image */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <img
            src={LOGO_STACKED}
            alt="MU AI"
            style={{ width: '200px', height: 'auto', display: 'block', margin: '0 auto 10px' }}
          />
          <div style={{
            fontSize: '.78rem', color: '#9A9A8A', letterSpacing: '.12em',
            textTransform: 'uppercase', fontWeight: 500
          }}>
            Intelligence in Motion
          </div>
        </div>

        {/* Card */}
        <div style={{
          background: '#fff', borderRadius: '16px', padding: '32px',
          boxShadow: '0 4px 24px rgba(0,0,0,.07)', border: '1px solid #E8E6DE'
        }}>
          <div style={{ marginBottom: '22px' }}>
            <div style={{ fontSize: '1.15rem', fontWeight: 600, color: '#1A1A1A', marginBottom: '4px' }}>Sign in</div>
            <div style={{ fontSize: '.82rem', color: '#9A9A8A' }}>Access your MU AI platform</div>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="form-group">
              <label className="form-label">Email</label>
              <div style={{ position: 'relative' }}>
                <input
                  className="form-input" type="email" placeholder="you@example.com"
                  value={email} onChange={e => setEmail(e.target.value)} required autoFocus
                  style={{ paddingRight: '40px' }}
                />
                <span style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: '#C8C8B8', fontSize: '.85rem' }}>✉</span>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  className="form-input" type={showPass ? 'text' : 'password'} placeholder="••••••••••"
                  value={password} onChange={e => setPassword(e.target.value)} required
                  style={{ paddingRight: '40px' }}
                />
                <button type="button" onClick={() => setShowPass(p => !p)}
                  style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#C8C8B8', fontSize: '.8rem', padding: 0 }}>
                  {showPass ? '🙈' : '👁'}
                </button>
              </div>
            </div>

            {error && (
              <div style={{ background: '#FDF0EE', border: '1px solid #F5C6C0', color: '#C0392B', padding: '10px 14px', borderRadius: '8px', fontSize: '.83rem' }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} style={{
              width: '100%', padding: '13px', border: 'none', borderRadius: '10px',
              background: '#D4AF37', color: '#1A1A1A', fontSize: '.9rem', fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? .7 : 1,
              fontFamily: "'Inter', sans-serif", letterSpacing: '.02em',
              boxShadow: '0 2px 10px rgba(212,175,55,.25)', transition: 'all .15s', marginTop: '4px'
            }}>
              {loading ? 'Signing in...' : 'Sign In'}
            </button>

            <div style={{ textAlign: 'center' }}>
              <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '.8rem', color: '#A0A090', textDecoration: 'underline' }}>
                Forgot password?
              </button>
            </div>
          </form>
        </div>

        <div style={{ textAlign: 'center', marginTop: '24px', fontSize: '.76rem', color: '#B8B8A8' }}>
          Built by Anthony
        </div>
      </div>
    </div>
  )
}
