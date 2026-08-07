import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'

const LOGO_STACKED = 'https://rydkwsjwlgnivlwlvqku.supabase.co/storage/v1/object/public/assets/Logo%20horizontal.png'
const TURNSTILE_SITE_KEY = '0x4AAAAAAEIrdNtHqz3JxYx8'
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// Option strings MUST match the ALLOWED lists in functions/api/waitlist.js and
// the CHECK constraints in db/migrations/010_waitlist_applications.sql, character
// for character. Change one, change all three.
const LEAD_SOURCE = ['Paid Ads', 'Organic', 'Both']
const RESPONSE_SPEED = ['Less than 5 minutes', 'Less than 1 hour', 'Same day', 'Next day or later']
const HAS_DM_SCRIPT = [
  'Yes, we have one that works',
  'Yes, but it needs improvement',
  'No, we dont have one yet'
]
const HAS_BOOKING_SYSTEM = ['Yes', 'No (I need help setting this up)']
const CURRENT_CRM = ['GoHighLevel', 'HubSpot', 'SalesForce', 'Close.io', 'Airtable', 'Google Sheets', 'None yet']
const TEAM_SIZE = ['Just me', '1 setter', '2-3 setters', '4+ setters']
const BOTTLENECKS = [
  'I cant keep up with DMs/volume',
  "My messages don't convert into bookings",
  'Too many unqualified leads',
  "Follow up isn't consistent",
  'I need a better system/structure'
]

const EMPTY = {
  first_name: '', last_name: '', email: '', business_name: '', instagram_handle: '',
  what_you_sell: '', main_offer_price: '', lead_source: '', inbound_leads_per_day: '',
  booked_calls_per_week: '', avg_monthly_revenue: '', response_speed: '',
  bottlenecks: [], has_dm_script: '', has_booking_system: '', current_crm: '',
  team_size: '', failed_dm_example: '', anything_else: '',
  company_website: '' // honeypot, never shown
}

function optionRowStyle(selected) {
  return {
    display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px',
    border: `1.5px solid ${selected ? 'var(--acc)' : 'var(--bdr)'}`,
    borderRadius: '8px', cursor: 'pointer', fontSize: '.85rem', color: '#3A3A2A',
    background: selected ? '#FBF7EA' : '#fff', transition: 'all .12s'
  }
}

export default function Waitlist() {
  const [step, setStep] = useState(1)
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

  function toggleBottleneck(v) {
    setForm(f => ({
      ...f,
      bottlenecks: f.bottlenecks.includes(v)
        ? f.bottlenecks.filter(x => x !== v)
        : [...f.bottlenecks, v]
    }))
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

  // Render the widget only on step 3. React StrictMode runs effects twice in
  // dev, so guard against a double render into the same container: a second
  // turnstile.render() on an occupied container throws and logs error 400020.
  // Capture the widget ID, remove it on cleanup, and bail if one already exists.
  // Clean up on leaving so a return visit gets a fresh widget (tokens are
  // single-use and short-lived).
  useEffect(() => {
    if (step !== 3 || !turnstileReady || !window.turnstile) return
    const container = turnstileRef.current
    if (!container) return
    if (widgetIdRef.current !== null) return       // we already rendered one
    if (container.childElementCount > 0) return    // a widget already lives here

    widgetIdRef.current = window.turnstile.render(container, {
      sitekey: TURNSTILE_SITE_KEY,
      callback: t => setToken(t),
      'error-callback': () => setToken(''),
      'expired-callback': () => setToken('')
    })

    return () => {
      if (widgetIdRef.current !== null && window.turnstile) {
        try { window.turnstile.remove(widgetIdRef.current) } catch { /* already gone */ }
        widgetIdRef.current = null
      }
      setToken('')
    }
  }, [step, turnstileReady])

  function resetTurnstile() {
    if (widgetIdRef.current !== null && window.turnstile) {
      try { window.turnstile.reset(widgetIdRef.current) } catch { /* not rendered */ }
    }
    setToken('')
  }

  function validateStep(s) {
    if (s === 1) {
      if (!form.first_name.trim()) return 'Please enter your first name.'
      if (!form.last_name.trim()) return 'Please enter your last name.'
      if (!form.email.trim()) return 'Please enter your email.'
      if (!EMAIL_RE.test(form.email.trim())) return 'Please enter a valid email address.'
      if (!form.instagram_handle.trim()) return 'Please enter your Instagram handle.'
      return ''
    }
    if (s === 2) {
      if (!form.what_you_sell.trim()) return 'Please tell us what you sell.'
      if (!form.main_offer_price.trim()) return 'Please enter your main offer price.'
      if (!form.lead_source) return 'Please select where your leads come from.'
      if (!form.inbound_leads_per_day.trim()) return 'Please enter your inbound leads per day.'
      if (!form.booked_calls_per_week.trim()) return 'Please enter your booked calls per week.'
      if (!form.avg_monthly_revenue.trim()) return 'Please enter your average monthly revenue.'
      if (!form.response_speed) return 'Please select your typical response speed.'
      return ''
    }
    if (s === 3) {
      if (form.bottlenecks.length === 0) return 'Please select at least one bottleneck.'
      if (!form.has_dm_script) return 'Please answer the DM script question.'
      if (!form.current_crm) return 'Please select your CRM.'
      if (!form.team_size) return 'Please select your team size.'
      if (!form.failed_dm_example.trim()) return "Please paste a DM conversation that didn't convert."
      return ''
    }
    return ''
  }

  function next() {
    const err = validateStep(step)
    if (err) { setError(err); return }
    setError('')
    setStep(s => s + 1)
    window.scrollTo(0, 0)
  }

  function back() {
    setError('')
    setStep(s => s - 1)
    window.scrollTo(0, 0)
  }

  async function handleSubmit() {
    const err = validateStep(3)
    if (err) { setError(err); return }
    if (!token) { setError('Please complete the verification.'); return }

    setError('')
    setSubmitting(true)
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, turnstile_token: token })
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        setSubmitted(true) // leave submitting true; we switch to the success screen
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

  function onFormSubmit(e) {
    e.preventDefault()
    if (step < 3) next()
    else handleSubmit()
  }

  // Render helpers return JSX (not components) so inputs keep focus across renders.
  function radioGroup(label, field, options, optional) {
    return (
      <div className="form-group">
        <label className="form-label">{label}{optional ? ' (optional)' : ''}</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {options.map(opt => {
            const selected = form[field] === opt
            return (
              <label key={opt} style={optionRowStyle(selected)}>
                <input
                  type="radio" name={field} value={opt} checked={selected}
                  onChange={() => set(field, opt)}
                  style={{ accentColor: 'var(--acc)', margin: 0 }}
                />
                <span>{opt}</span>
              </label>
            )
          })}
        </div>
      </div>
    )
  }

  function textField(label, field, opts = {}) {
    return (
      <div className="form-group">
        <label className="form-label">{label}{opts.optional ? ' (optional)' : ''}</label>
        <input
          className="form-input"
          type={opts.type || 'text'}
          placeholder={opts.placeholder || ''}
          value={form[field]}
          onChange={e => set(field, e.target.value)}
          autoComplete={opts.autoComplete}
        />
      </div>
    )
  }

  function textArea(label, field, opts = {}) {
    return (
      <div className="form-group">
        <label className="form-label">{label}{opts.optional ? ' (optional)' : ''}</label>
        <textarea
          className="form-input"
          placeholder={opts.placeholder || ''}
          value={form[field]}
          onChange={e => set(field, e.target.value)}
          rows={opts.rows || 4}
          style={{ resize: 'vertical', minHeight: '80px', lineHeight: 1.5 }}
        />
      </div>
    )
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      background: 'var(--bg)', padding: '40px 20px', fontFamily: "'Inter', sans-serif"
    }}>
      <div style={{ width: '100%', maxWidth: '480px' }}>

        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <img src={LOGO_STACKED} alt="MU AI"
            style={{ width: '200px', height: 'auto', display: 'block', margin: '0 auto 10px' }} />
          <div style={{
            fontSize: '.78rem', color: 'var(--tx3)', letterSpacing: '.12em',
            textTransform: 'uppercase', fontWeight: 500
          }}>
            Intelligence in Motion
          </div>
        </div>

        <div style={{
          background: '#fff', borderRadius: 'var(--rlg)', padding: '32px',
          boxShadow: 'var(--shm)', border: '1px solid var(--bdr)'
        }}>
          {submitted ? (
            <div>
              <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--tx)', marginBottom: '10px' }}>
                You're on the list
              </div>
              <div style={{ fontSize: '.88rem', color: 'var(--tx2)', lineHeight: 1.65, marginBottom: '22px' }}>
                We have your application. Nella reviews every one personally and will be in
                touch at {form.email || 'the email you provided'} if it's a fit. Keep an eye on
                your inbox.
              </div>
              <Link to="/" style={{
                display: 'inline-block', background: 'var(--acc)', color: 'var(--tx)',
                textDecoration: 'none', borderRadius: '10px', padding: '12px 22px',
                fontSize: '.88rem', fontWeight: 700, letterSpacing: '.02em',
                boxShadow: '0 2px 10px rgba(212,175,55,.25)'
              }}>
                Back to home
              </Link>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: '20px' }}>
                <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--tx)', marginBottom: '4px' }}>
                  Apply for early access
                </div>
                <div style={{ fontSize: '.82rem', color: 'var(--tx3)' }}>
                  {step === 1 && 'About you'}
                  {step === 2 && 'Your business'}
                  {step === 3 && 'Your setup'}
                </div>
              </div>

              {/* Progress */}
              <div style={{ marginBottom: '24px' }}>
                <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                  {[1, 2, 3].map(n => (
                    <div key={n} style={{
                      flex: 1, height: '4px', borderRadius: '2px',
                      background: n <= step ? 'var(--acc)' : 'var(--bdr)', transition: 'background .2s'
                    }} />
                  ))}
                </div>
                <div style={{ fontSize: '.74rem', color: '#B8B8A8', fontWeight: 500 }}>
                  Step {step} of 3
                </div>
              </div>

              <form onSubmit={onFormSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

                {/* Honeypot: hidden from humans, tempting to bots. Not display:none. */}
                <input
                  type="text" name="company_website" value={form.company_website}
                  onChange={e => set('company_website', e.target.value)}
                  tabIndex={-1} autoComplete="off" aria-hidden="true"
                  style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', opacity: 0 }}
                />

                {step === 1 && (
                  <>
                    <div style={{ display: 'flex', gap: '12px' }}>
                      <div style={{ flex: 1 }}>{textField('First name', 'first_name', { autoComplete: 'given-name' })}</div>
                      <div style={{ flex: 1 }}>{textField('Last name', 'last_name', { autoComplete: 'family-name' })}</div>
                    </div>
                    {textField('Email', 'email', { type: 'email', placeholder: 'you@example.com', autoComplete: 'email' })}
                    {textField('Business name', 'business_name', { optional: true })}
                    {textField('Instagram handle', 'instagram_handle', { placeholder: '@yourhandle' })}
                  </>
                )}

                {step === 2 && (
                  <>
                    {textArea('What do you sell?', 'what_you_sell', { rows: 3, placeholder: 'Your product or service' })}
                    {textField('Main offer price', 'main_offer_price', { placeholder: 'e.g. $2k, 500-1000' })}
                    {radioGroup('Where do your leads come from?', 'lead_source', LEAD_SOURCE)}
                    {textField('Inbound leads per day', 'inbound_leads_per_day', { placeholder: 'e.g. 10-20' })}
                    {textField('Booked calls per week', 'booked_calls_per_week', { placeholder: 'e.g. 5' })}
                    {textField('Average monthly revenue', 'avg_monthly_revenue', { placeholder: 'e.g. 20k' })}
                    {radioGroup('How fast do you typically respond to a new DM?', 'response_speed', RESPONSE_SPEED)}
                  </>
                )}

                {step === 3 && (
                  <>
                    <div className="form-group">
                      <label className="form-label">What are your biggest bottlenecks? (select all that apply)</label>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {BOTTLENECKS.map(opt => {
                          const selected = form.bottlenecks.includes(opt)
                          return (
                            <label key={opt} style={optionRowStyle(selected)}>
                              <input
                                type="checkbox" checked={selected}
                                onChange={() => toggleBottleneck(opt)}
                                style={{ accentColor: 'var(--acc)', margin: 0 }}
                              />
                              <span>{opt}</span>
                            </label>
                          )
                        })}
                      </div>
                    </div>

                    {radioGroup('Do you have a DM script?', 'has_dm_script', HAS_DM_SCRIPT)}
                    {radioGroup('Do you have a booking system?', 'has_booking_system', HAS_BOOKING_SYSTEM, true)}
                    {radioGroup('What CRM do you use?', 'current_crm', CURRENT_CRM)}
                    {radioGroup('How big is your team?', 'team_size', TEAM_SIZE)}

                    {textArea(
                      "Paste a recent DM conversation that didn't convert (from the start to the end).",
                      'failed_dm_example',
                      { rows: 6, placeholder: 'Paste the conversation here' }
                    )}
                    {textArea('Anything else you want us to know?', 'anything_else', { optional: true, rows: 3 })}

                    {/* Turnstile renders here, step 3 only */}
                    <div ref={turnstileRef} style={{ minHeight: '65px' }} />
                  </>
                )}

                {error && (
                  <div style={{
                    background: 'var(--redbg)', border: '1px solid var(--redbd)', color: 'var(--red)',
                    padding: '10px 14px', borderRadius: '8px', fontSize: '.83rem'
                  }}>
                    {error}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
                  {step > 1 && (
                    <button type="button" onClick={back} disabled={submitting} style={{
                      padding: '13px 20px', border: '1.5px solid var(--bdr)', borderRadius: '10px',
                      background: '#fff', color: 'var(--tx2)', fontSize: '.9rem', fontWeight: 600,
                      cursor: submitting ? 'not-allowed' : 'pointer', fontFamily: "'Inter', sans-serif"
                    }}>
                      Back
                    </button>
                  )}
                  <button type="submit" disabled={submitting} style={{
                    flex: 1, padding: '13px', border: 'none', borderRadius: '10px',
                    background: 'var(--acc)', color: 'var(--tx)', fontSize: '.9rem', fontWeight: 700,
                    cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? .7 : 1,
                    fontFamily: "'Inter', sans-serif", letterSpacing: '.02em',
                    boxShadow: '0 2px 10px rgba(212,175,55,.25)', transition: 'all .15s'
                  }}>
                    {step < 3 ? 'Continue' : (submitting ? 'Submitting...' : 'Submit application')}
                  </button>
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
