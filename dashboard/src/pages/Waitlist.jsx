import { useState, useEffect, useRef } from 'react'
import '../marketing.css'
import { usePublicScroll } from '../lib/usePublicScroll'
import { useMarketingFonts } from '../lib/useMarketingFonts'
import PublicHeader from '../components/PublicHeader'
import { Icon } from '../components/FunnelShared'
import { MessagesPhone } from '../components/DeviceMockups'

const TURNSTILE_SITE_KEY = '0x4AAAAAAEIrdNtHqz3JxYx8'
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// Rebuilt 2026-08-31 to Nella's waitlist mockup (left page of
// Call_to_Action_buttons_where_they_lead_to.png): four required fields, down
// from the old three-step application. The Pages Function and migration 015
// carry the matching backend change. Copy is her client copy, verbatim.

const EMPTY = {
  business_name: '',
  instagram_handle: '',
  email: '',
  phone: '',
  company_website: '', // honeypot, never shown
}

const FIELDS = [
  { name: 'business_name', label: 'Business Name', placeholder: 'Your business name', autoComplete: 'organization' },
  { name: 'instagram_handle', label: 'Instagram Handle', placeholder: '@yourhandle', autoComplete: 'off' },
  { name: 'email', label: 'Email Address', placeholder: 'you@yourbusiness.com', type: 'email', autoComplete: 'email' },
  { name: 'phone', label: 'Phone Number', placeholder: '(555) 123-4567', type: 'tel', autoComplete: 'tel' },
]

export default function Waitlist() {
  usePublicScroll()
  useMarketingFonts()

  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const [token, setToken] = useState('')
  // Seed from window so the already-loaded case needs no setState in the effect.
  const [turnstileReady, setTurnstileReady] = useState(
    () => typeof window !== 'undefined' && Boolean(window.turnstile)
  )
  const turnstileRef = useRef(null)
  const widgetIdRef = useRef(null)

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
  }

  // Load the Turnstile script once. All setState here happens in async onload
  // callbacks, never synchronously in the effect body.
  useEffect(() => {
    if (turnstileReady) return
    const existing = document.querySelector('script[data-turnstile]')
    if (existing) {
      const onload = () => setTurnstileReady(true)
      existing.addEventListener('load', onload)
      return () => existing.removeEventListener('load', onload)
    }
    const s = document.createElement('script')
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
    s.async = true
    s.defer = true
    s.setAttribute('data-turnstile', 'true')
    s.onload = () => setTurnstileReady(true)
    document.head.appendChild(s)
  }, [turnstileReady])

  // Single-page form, so the widget renders as soon as the script is ready.
  // React StrictMode runs effects twice in dev, so guard against a double
  // render into the same container (a second turnstile.render() on an
  // occupied container throws error 400020). Clean up on unmount so a return
  // visit gets a fresh widget (tokens are single-use and short-lived).
  useEffect(() => {
    if (!turnstileReady || !window.turnstile || submitted) return
    const container = turnstileRef.current
    if (!container) return
    if (widgetIdRef.current !== null) return
    if (container.childElementCount > 0) return

    widgetIdRef.current = window.turnstile.render(container, {
      sitekey: TURNSTILE_SITE_KEY,
      callback: t => setToken(t),
      'error-callback': () => setToken(''),
      'expired-callback': () => setToken(''),
    })

    return () => {
      if (widgetIdRef.current !== null && window.turnstile) {
        try { window.turnstile.remove(widgetIdRef.current) } catch { /* already gone */ }
        widgetIdRef.current = null
      }
      setToken('')
    }
  }, [turnstileReady, submitted])

  function resetTurnstile() {
    if (widgetIdRef.current !== null && window.turnstile) {
      try { window.turnstile.reset(widgetIdRef.current) } catch { /* not rendered */ }
    }
    setToken('')
  }

  function validate() {
    if (!form.business_name.trim()) return 'Please enter your business name.'
    if (!form.instagram_handle.trim()) return 'Please enter your Instagram handle.'
    if (!form.email.trim()) return 'Please enter your email address.'
    if (!EMAIL_RE.test(form.email.trim())) return 'Please enter a valid email address.'
    if (!form.phone.trim()) return 'Please enter your phone number.'
    return ''
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const err = validate()
    if (err) { setError(err); return }
    if (!token) { setError('Please complete the verification.'); return }

    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, turnstile_token: token }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        setSubmitted(true) // leave submitting true; we switch to the success view
      } else {
        setError(data.error || 'Something went wrong. Please try again.')
        resetTurnstile() // spent or rejected token, force a fresh one
        setSubmitting(false)
      }
    } catch {
      setError('Network error. Please try again.')
      resetTurnstile()
      setSubmitting(false)
    }
  }

  return (
    <div className="mk-page mk-page--blush">
      <PublicHeader right="form" />

      <main className="mk-container">
        {/* hero */}
        <div className="mk-wl-hero">
          <div>
            <span className="mk-badge mk-badge--outline">Limited Spots</span>
            <h1 className="mk-h1" style={{ marginTop: 22, fontSize: 'clamp(2.4rem, 5.4vw, 3.6rem)' }}>Join the Waitlist</h1>
            <p className="mk-body-lg" style={{ fontSize: 'clamp(1.05rem, 2vw, 1.3rem)', lineHeight: 1.55, margin: 0, color: 'var(--mk-body)' }}>
              Be the first to know<br />
              when doors open for our<br />
              <strong style={{ color: 'var(--mk-ink)' }}>med spa DM setting system.</strong>
            </p>
          </div>
          <div className="mk-wl-scene">
            <MessagesPhone style={{ width: 'min(46%, 220px)', flex: 'none' }} />
            <div className="mk-note" style={{ maxWidth: 210 }}>
              More booked calls.<br />
              More revenue.<br />
              Less stress.<br />
              <span style={{ display: 'block', textAlign: 'center' }}>&#9825;</span>
            </div>
          </div>
        </div>

        {/* form card */}
        <div className="mk-card mk-wl-formcard" id="save-your-spot">
          {submitted ? (
            <p style={{ fontFamily: 'var(--mk-serif)', fontSize: '1.4rem', color: 'var(--mk-ink)', textAlign: 'center', margin: 0 }}>
              Thank you for joining the waitlist.
            </p>
          ) : (
            <>
              <h2 className="mk-h2" style={{ textAlign: 'center', marginBottom: 6 }}>Save Your Spot</h2>
              <p style={{ textAlign: 'center', fontSize: '0.92rem', margin: '0 0 28px' }}>
                Fill out the form below and be the first<br />to know when the waitlist opens.
              </p>
              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                {/* Honeypot: hidden from humans, tempting to bots. Not display:none. */}
                <input
                  type="text" name="company_website" value={form.company_website}
                  onChange={e => set('company_website', e.target.value)}
                  tabIndex={-1} autoComplete="off" aria-hidden="true"
                  style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', opacity: 0 }}
                />
                {FIELDS.map(f => (
                  <div key={f.name}>
                    <label className="mk-label" htmlFor={`wl-${f.name}`}>{f.label} *</label>
                    <input
                      id={`wl-${f.name}`}
                      className="mk-input"
                      type={f.type || 'text'}
                      placeholder={f.placeholder}
                      autoComplete={f.autoComplete}
                      value={form[f.name]}
                      onChange={e => set(f.name, e.target.value)}
                    />
                  </div>
                ))}

                <div ref={turnstileRef} style={{ minHeight: 65 }} />

                {error && <div className="mk-error">{error}</div>}

                <button type="submit" className="mk-btn mk-btn--pill" disabled={submitting} style={{ width: '100%' }}>
                  {submitting ? 'Submitting...' : 'Join Waitlist'}
                  {!submitting && <Icon name="arrow-right" size={17} strokeWidth={2.4} />}
                </button>
              </form>
            </>
          )}
        </div>

        <div className="mk-wl-tagline">
          Real conversations. &nbsp; Real clients. &nbsp; Real growth.
        </div>
      </main>
    </div>
  )
}
