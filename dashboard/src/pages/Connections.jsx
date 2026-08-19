import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { getAssignedBot } from '../lib/botHelper'
import { useAuth } from '../lib/AuthContext'

// Worker base URL. Same environment rule as Inbox.jsx: staging dashboard hosts
// hit the staging Worker, everything else (production pages.dev, custom domains,
// local dev) hits production. Kept as a duplicate const rather than a shared
// import to match the existing pattern in this codebase; if a third page needs
// it, lift all of them into lib/ at once.
const WORKER_URL = (typeof window !== 'undefined' && window.location.hostname.includes('staging'))
  ? 'https://sales-bot-staging.nellakuate.workers.dev'
  : 'https://sales-bot.nellakuate.workers.dev'

// Its own page, gated on the 'connections' permission, deliberately NOT part of
// Settings.
//
// Connecting or reconnecting a messaging account is a different job from
// configuring automation. Putting this card inside Settings would have meant
// anyone who needs to connect an account also gets the master auto-send switch,
// the per-stage automation unlocks and the whole bot config. That is wrong for a
// client's setter reconnecting an expired token, and it is wrong for the Meta
// App Review account, whose submission states that replies are never sent
// automatically: showing that reviewer an auto-send toggle undercuts the claim.
export default function Connections() {
  const { profile } = useAuth()
  const [bot, setBot] = useState(null)
  const [loading, setLoading] = useState(true)

  // Connection status from the Worker's /meta/connection-status.
  // DELIBERATELY NOT CACHED in DataCache: the connect happens out of band in
  // another tab, so a cached "not connected" would survive the very action it
  // is meant to reflect. null means "not looked up yet".
  const [connection, setConnection] = useState(null)
  const [connectionLoading, setConnectionLoading] = useState(false)
  const [connectionError, setConnectionError] = useState(null)

  useEffect(() => { loadBot() }, [profile])

  // Separate from loadBot on purpose. This is a Worker round trip, not a
  // Supabase one, and the page renders while the status is still resolving.
  const botId = bot && bot.id
  useEffect(() => { if (botId) loadConnection(botId) }, [botId])

  async function loadBot() {
    if (!profile) { setLoading(false); return }
    const data = await getAssignedBot(profile)
    setBot(data)
    setLoading(false)
  }

  // Ask the Worker whether this bot has a live Instagram connection.
  //
  // This CANNOT be a supabase.from('connected_accounts') read and must never
  // become one: migration 009 enables RLS on that table with no policy because
  // it holds the encrypted access token, so the browser gets zero rows by
  // design. The Worker route is the sanctioned answer and returns three fields
  // only (connected, username, connected_at), never token material or the
  // external account id.
  async function loadConnection(id) {
    setConnectionLoading(true)
    setConnectionError(null)
    try {
      const { data: sess } = await supabase.auth.getSession()
      const jwt = sess?.session?.access_token
      if (!jwt) {
        setConnectionError('No login session. Reload the page and sign in again.')
        setConnectionLoading(false)
        return
      }
      const resp = await fetch(WORKER_URL + '/meta/connection-status?bot_id=' + encodeURIComponent(id), {
        method: 'GET',
        headers: { 'Authorization': 'Bearer ' + jwt }
      })
      const j = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        setConnectionError(j.error || ('HTTP ' + resp.status))
        setConnection(null)
      } else {
        setConnection(j)
      }
    } catch {
      // Network failure and CORS rejection both land here and are
      // indistinguishable to the page, so the copy names neither.
      setConnectionError('Could not reach the server. Check your connection and try again.')
      setConnection(null)
    }
    setConnectionLoading(false)
  }

  // Send the operator to Instagram's consent screen. New tab, because the
  // Worker's OAuth success page ends with "You can close this window" and there
  // is deliberately no redirect back to the dashboard yet: closing that tab must
  // leave the dashboard exactly where it was. They come back and hit Refresh
  // status.
  function startInstagramConnect() {
    if (!bot || !bot.id) return
    window.open(WORKER_URL + '/meta/oauth/start?bot_id=' + encodeURIComponent(bot.id), '_blank', 'noopener')
  }

  if (loading) return <div className="page" style={{ alignItems: 'center', justifyContent: 'center' }}><div className="spinner" /></div>

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Connections</div>
          <div className="page-sub">The messaging accounts your bot works from.</div>
        </div>
      </div>

      <div className="card">
        <div style={{ marginBottom: '14px' }}>
          <div className="card-title" style={{ marginBottom: '4px' }}>Instagram</div>
          <div style={{ fontSize: '.82rem', color: 'var(--tx3)', lineHeight: 1.55 }}>
            The Instagram account your bot reads DMs from and replies as. Connecting opens Instagram in a new tab where you approve access. Come back to this tab afterwards and hit Refresh status.
          </div>
        </div>

        {!bot ? (
          <div style={{ padding: '12px 14px', background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 'var(--rsm)', fontSize: '.8rem', color: 'var(--tx2)' }}>
            No bot is assigned to your account yet, so there is nothing to connect. Ask your admin to assign one.
          </div>
        ) : connectionError ? (
          <div style={{ padding: '12px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 'var(--rsm)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ fontSize: '.8rem', color: '#b91c1c', lineHeight: 1.5 }}>
              Could not check the Instagram connection: {connectionError}
            </div>
            <button className="btn" onClick={() => loadConnection(bot.id)} disabled={connectionLoading} style={{ flexShrink: 0 }}>
              {connectionLoading ? 'Checking...' : 'Try again'}
            </button>
          </div>
        ) : connection === null ? (
          <div style={{ padding: '12px 14px', background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 'var(--rsm)', fontSize: '.8rem', color: 'var(--tx3)' }}>
            Checking connection...
          </div>
        ) : (
          <div style={{ padding: '14px 16px', background: 'var(--surf2)', border: '1px solid var(--bdr)', borderRadius: 'var(--rsm)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '200px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px', flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: '.7rem', fontWeight: 700, padding: '3px 10px', borderRadius: '999px',
                  background: connection.connected ? '#dcfce7' : 'var(--bdr2)',
                  color: connection.connected ? '#166534' : 'var(--tx2)',
                  border: '1px solid ' + (connection.connected ? '#bbf7d0' : 'var(--bdr)'),
                }}>
                  {connection.connected ? 'CONNECTED' : 'NOT CONNECTED'}
                </span>
                {connection.connected && connection.username && (
                  <span style={{ fontSize: '.86rem', fontWeight: 600, color: 'var(--tx)' }}>
                    @{connection.username}
                  </span>
                )}
              </div>
              <div style={{ fontSize: '.76rem', color: 'var(--tx3)', lineHeight: 1.5 }}>
                {connection.connected
                  ? (connection.connected_at
                      ? 'Connected since ' + new Date(connection.connected_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
                      : 'Connected.')
                  : 'No Instagram account is connected. Your bot will not receive DMs until you connect one.'}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
              <button className="btn" onClick={() => loadConnection(bot.id)} disabled={connectionLoading}>
                {connectionLoading ? 'Checking...' : 'Refresh status'}
              </button>
              {/* Shown when connected too: reconnecting is the documented fix for
                  an expired or revoked token, and the Worker upserts onto the
                  same row rather than creating a second one. */}
              <button className="btn btn-primary" onClick={startInstagramConnect}>
                {connection.connected ? 'Reconnect Instagram' : 'Connect Instagram'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
