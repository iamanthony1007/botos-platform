import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, ALL_PERMISSIONS, DEFAULT_CLIENT_PERMISSIONS, DEFAULT_SETTER_PERMISSIONS, ROLE_OPTIONS_FOR } from '../lib/AuthContext'

export default function UserManagement() {
  const { profile, canInvite, canRemove } = useAuth()
  const [users, setUsers] = useState([])
  const [invites, setInvites] = useState([])
  const [bots, setBots] = useState([])
  const [loading, setLoading] = useState(true)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [editingUser, setEditingUser] = useState(null)
  const [toast, setToast] = useState({ msg: '', type: 'success' })

  const isFullAccess = (role) => role === 'admin' || role === 'superadmin'

  // Default role for invite form based on current user role
  const defaultInviteRole = profile?.role === 'client' ? 'setter' : 'client'
  const [inviteForm, setInviteForm] = useState({
    email: '', name: '', role: defaultInviteRole,
    assigned_bot_id: '', permissions: [...DEFAULT_CLIENT_PERMISSIONS]
  })

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)

    // Load users — clients only see setters on their bot
    let usersQuery = supabase
      .from('profiles')
      .select('id, name, email, role, assigned_bot_id, permissions, created_at, invited_by')
      .order('created_at', { ascending: false })

    if (profile?.role === 'client') {
      usersQuery = usersQuery
        .eq('role', 'setter')
        .eq('assigned_bot_id', profile.assigned_bot_id)
    }

    const { data: usersData } = await usersQuery

    // Load pending invites — clients only see invites they sent
    let invitesQuery = supabase
      .from('invites')
      .select('id, email, name, token, role, status, expires_at, created_at, assigned_bot_id, invited_by')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })

    if (profile?.role === 'client') {
      invitesQuery = invitesQuery.eq('invited_by', profile.id)
    }

    const { data: invitesData } = await invitesQuery

    // Load bots — clients only see their own bot
    let botsQuery = supabase.from('bots').select('id, name').order('name')
    if (profile?.role === 'client') {
      botsQuery = botsQuery.eq('id', profile.assigned_bot_id)
    }
    const { data: botsData } = await botsQuery

    // Build bot name map for display
    const botMap = {}
    ;(botsData || []).forEach(b => { botMap[b.id] = b.name })

    // Attach bot name to users and invites
    const usersWithBot = (usersData || []).map(u => ({ ...u, botName: botMap[u.assigned_bot_id] || null }))
    const invitesWithBot = (invitesData || []).map(i => ({ ...i, botName: botMap[i.assigned_bot_id] || null }))

    setUsers(usersWithBot)
    setInvites(invitesWithBot)
    setBots(botsData || [])
    setLoading(false)
  }

  async function sendInvite() {
    if (!inviteForm.email || !inviteForm.name) { showToast('Please fill in all required fields', 'error'); return }

    // Clients always assign their own bot to setters
    const assignedBot = profile?.role === 'client'
      ? profile.assigned_bot_id
      : inviteForm.assigned_bot_id

    if (inviteForm.role === 'client' && !assignedBot) {
      showToast('Please assign a bot', 'error'); return
    }

    const defaultPerms = inviteForm.role === 'setter'
      ? DEFAULT_SETTER_PERMISSIONS
      : inviteForm.permissions

    try {
      const token = Math.random().toString(36).substring(2) + Date.now().toString(36)
      const { error } = await supabase.from('invites').insert({
        email: inviteForm.email.toLowerCase(),
        name: inviteForm.name,
        token,
        role: inviteForm.role,
        assigned_bot_id: assignedBot || null,
        permissions: isFullAccess(inviteForm.role) ? null : (inviteForm.role === 'setter' ? DEFAULT_SETTER_PERMISSIONS : inviteForm.permissions),
        invited_by: profile.id,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'pending'
      })
      if (error) throw error
      const inviteLink = `${window.location.origin}/accept-invite?token=${token}`
      await navigator.clipboard.writeText(inviteLink)
      showToast('Invite created! Link copied to clipboard', 'success')
      setShowInviteModal(false)
      setInviteForm({ email: '', name: '', role: defaultInviteRole, assigned_bot_id: '', permissions: [...DEFAULT_CLIENT_PERMISSIONS] })
      loadData()
    } catch (error) {
      showToast(error.message || 'Failed to create invite', 'error')
    }
  }

  async function saveUserPermissions() {
    const { error } = await supabase
      .from('profiles')
      .update({
        role: editingUser.role,
        permissions: isFullAccess(editingUser.role) ? null : editingUser.permissions,
        assigned_bot_id: editingUser.assigned_bot_id || null
      })
      .eq('id', editingUser.id)
    if (error) { showToast('Failed to save changes', 'error'); return }
    showToast('User updated', 'success')
    setEditingUser(null)
    loadData()
  }

  async function removeUser(u) {
    if (!confirm(`Remove ${u.name || u.email}? This will delete their account and access.`)) return
    // Delete profile (auth user deletion requires service role — we just remove the profile + mark invites)
    const { error } = await supabase.from('profiles').delete().eq('id', u.id)
    if (error) { showToast('Failed to remove user', 'error'); return }
    // Also expire any pending invites for this email
    await supabase.from('invites').update({ status: 'expired' }).eq('email', u.email).eq('status', 'pending')
    showToast(`${u.name || u.email} removed`, 'success')
    loadData()
  }

  async function cancelInvite(id) {
    if (!confirm('Cancel this invite?')) return
    const { error } = await supabase.from('invites').update({ status: 'expired' }).eq('id', id)
    if (error) showToast('Failed to cancel', 'error')
    else { showToast('Invite cancelled', 'success'); loadData() }
  }

  function showToast(msg, type = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast({ msg: '' }), 4000)
  }

  const availableRoles = ROLE_OPTIONS_FOR[profile?.role] || []
  const canSendInvites = availableRoles.length > 0

  if (loading) return <div className="page" style={{ alignItems: 'center', justifyContent: 'center' }}><div className="spinner" /></div>

  return (
    <div className="page">
      {toast.msg && <div className={`toast ${toast.type === 'error' ? 'toast-error' : ''}`}>{toast.msg}</div>}

      <div className="page-header">
        <div>
          <div className="page-title">User Management</div>
          <div className="page-sub">{users.length} active · {invites.length} pending invites</div>
        </div>
        {canSendInvites && (
          <button className="btn btn-primary" onClick={() => setShowInviteModal(true)}>+ Invite User</button>
        )}
      </div>

      {/* ACTIVE USERS TABLE */}
      <div className="card">
        <div className="card-title">
          {profile?.role === 'client' ? 'Your Setters' : `Active Users (${users.length})`}
        </div>
        {users.length === 0 ? (
          <div style={{ color: 'var(--tx3)', fontSize: '.84rem', padding: '20px 0' }}>
            {profile?.role === 'client' ? 'No setters yet. Invite one using the button above.' : 'No users yet.'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.84rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--bdr)' }}>
                {['Name', 'Email', 'Role', 'Bot', 'Access', 'Actions'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontSize: '.72rem', fontWeight: 600, color: 'var(--tx3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} style={{ borderBottom: '1px solid var(--bdr)' }}>
                  <td style={{ padding: '10px' }}>{u.name || '—'}</td>
                  <td style={{ padding: '10px', color: 'var(--tx2)' }}>{u.email}</td>
                  <td style={{ padding: '10px' }}>
                    <span className={`badge ${u.role === 'superadmin' ? 'badge-green' : u.role === 'admin' ? 'badge-green' : u.role === 'client' ? 'badge-blue' : 'badge-gray'}`}>
                      {u.role}
                    </span>
                  </td>
                  <td style={{ padding: '10px', color: 'var(--tx2)', fontSize: '.8rem' }}>{u.botName || '—'}</td>
                  <td style={{ padding: '10px', color: 'var(--tx3)', fontSize: '.78rem' }}>
                    {isFullAccess(u.role) ? 'Full access' : `${(u.permissions || []).length} of ${ALL_PERMISSIONS.length}`}
                  </td>
                  <td style={{ padding: '10px', display: 'flex', gap: '6px' }}>
                    {isFullAccess(profile?.role) && (
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditingUser({ ...u, permissions: u.permissions || [] })}>Edit</button>
                    )}
                    {canRemove(u) && (
                      <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red, #e53e3e)' }} onClick={() => removeUser(u)}>Remove</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* PENDING INVITES */}
      {invites.length > 0 && (
        <div className="card">
          <div className="card-title">Pending Invites ({invites.length})</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.84rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--bdr)' }}>
                {['Name', 'Email', 'Role', 'Bot', 'Expires', 'Actions'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 10px', fontSize: '.72rem', fontWeight: 600, color: 'var(--tx3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invites.map(inv => (
                <tr key={inv.id} style={{ borderBottom: '1px solid var(--bdr)' }}>
                  <td style={{ padding: '10px' }}>{inv.name || '—'}</td>
                  <td style={{ padding: '10px' }}>{inv.email}</td>
                  <td style={{ padding: '10px' }}>
                    <span className={`badge ${isFullAccess(inv.role) ? 'badge-green' : inv.role === 'client' ? 'badge-blue' : 'badge-gray'}`}>{inv.role}</span>
                  </td>
                  <td style={{ padding: '10px', color: 'var(--tx2)', fontSize: '.8rem' }}>{inv.botName || '—'}</td>
                  <td style={{ padding: '10px', color: 'var(--tx3)', fontSize: '.78rem' }}>{new Date(inv.expires_at).toLocaleDateString()}</td>
                  <td style={{ padding: '10px' }}>
                    <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red, #e53e3e)' }} onClick={() => cancelInvite(inv.id)}>Cancel</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* INVITE MODAL */}
      {showInviteModal && (
        <ModalOverlay onClose={() => setShowInviteModal(false)}>
          <div style={{ fontSize: '1.05rem', fontWeight: 600, marginBottom: '20px' }}>Invite New User</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <FormField label="Name *">
              <input className="form-input" value={inviteForm.name} onChange={e => setInviteForm(f => ({ ...f, name: e.target.value }))} placeholder="Full name" />
            </FormField>
            <FormField label="Email *">
              <input className="form-input" type="email" value={inviteForm.email} onChange={e => setInviteForm(f => ({ ...f, email: e.target.value }))} placeholder="their@email.com" />
            </FormField>

            {/* Role selector — only shown if user can invite more than one role */}
            {availableRoles.length > 1 && (
              <FormField label="Role *">
                <select className="form-input" value={inviteForm.role}
                  onChange={e => {
                    const r = e.target.value
                    const defaultPerms = r === 'setter' ? DEFAULT_SETTER_PERMISSIONS : DEFAULT_CLIENT_PERMISSIONS
                    setInviteForm(f => ({ ...f, role: r, permissions: defaultPerms }))
                  }}>
                  {availableRoles.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                </select>
              </FormField>
            )}

            {/* Bot selector — only for admins/superadmins inviting clients */}
            {isFullAccess(profile?.role) && (
              <FormField label="Assign Bot *">
                <select className="form-input" value={inviteForm.assigned_bot_id} onChange={e => setInviteForm(f => ({ ...f, assigned_bot_id: e.target.value }))}>
                  <option value="">Select a bot...</option>
                  {bots.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <div style={{ fontSize: '.78rem', color: 'var(--tx3)', marginTop: '4px' }}>User will only see data for this bot</div>
              </FormField>
            )}

            {/* Permissions — only for non-admin, non-setter roles */}
            {!isFullAccess(inviteForm.role) && inviteForm.role !== 'setter' && (
              <PermissionCheckboxes
                permissions={inviteForm.permissions}
                onChange={perms => setInviteForm(f => ({ ...f, permissions: perms }))}
              />
            )}

            {isFullAccess(inviteForm.role) && <AdminNote />}

            {inviteForm.role === 'setter' && (
              <div style={{ padding: '10px 12px', background: 'var(--surf2)', borderRadius: 'var(--rsm)', fontSize: '.82rem', color: 'var(--tx2)' }}>
                Setters will have access to the Setter Inbox only. You can edit their access after they join.
              </div>
            )}

            <div style={{ padding: '12px 14px', background: 'var(--surf2)', borderRadius: 'var(--rsm)', fontSize: '.8rem', color: 'var(--tx2)', lineHeight: 1.55 }}>
              After clicking "Send Invite", a link is copied to your clipboard. Send it to the user — they click it, set a password, and they're in. Expires in 7 days.
            </div>
            <ModalButtons onCancel={() => setShowInviteModal(false)} onConfirm={sendInvite} confirmLabel="Send Invite" />
          </div>
        </ModalOverlay>
      )}

      {/* EDIT USER MODAL — admins/superadmins only */}
      {editingUser && isFullAccess(profile?.role) && (
        <ModalOverlay onClose={() => setEditingUser(null)}>
          <div style={{ marginBottom: '20px' }}>
            <div style={{ fontSize: '1.05rem', fontWeight: 600 }}>Edit Access</div>
            <div style={{ fontSize: '.82rem', color: 'var(--tx3)' }}>{editingUser.name || editingUser.email}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <FormField label="Role">
              <select className="form-input" value={editingUser.role} onChange={e => setEditingUser(u => ({ ...u, role: e.target.value }))}>
                <option value="setter">Setter</option>
                <option value="client">Client</option>
                <option value="admin">Admin</option>
                {profile?.role === 'superadmin' && <option value="superadmin">Superadmin</option>}
              </select>
            </FormField>
            <FormField label="Assigned Bot">
              <select className="form-input" value={editingUser.assigned_bot_id || ''} onChange={e => setEditingUser(u => ({ ...u, assigned_bot_id: e.target.value }))}>
                <option value="">No bot assigned</option>
                {bots.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </FormField>

            {!isFullAccess(editingUser.role) ? (
              <PermissionCheckboxes
                permissions={editingUser.permissions || []}
                onChange={perms => setEditingUser(u => ({ ...u, permissions: perms }))}
              />
            ) : (
              <AdminNote />
            )}

            <ModalButtons onCancel={() => setEditingUser(null)} onConfirm={saveUserPermissions} confirmLabel="Save Changes" />
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}

// ─── Small reusable components ────────────────────────────────────────────────

function ModalOverlay({ children, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div className="card" style={{ width: '100%', maxWidth: '520px', maxHeight: '90vh', overflowY: 'auto', padding: '28px', position: 'relative' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: '16px', right: '16px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: 'var(--tx3)' }}>×</button>
        {children}
      </div>
    </div>
  )
}

function FormField({ label, children }) {
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      {children}
    </div>
  )
}

function PermissionCheckboxes({ permissions, onChange }) {
  function toggle(key) {
    if (permissions.includes(key)) onChange(permissions.filter(p => p !== key))
    else onChange([...permissions, key])
  }
  return (
    <div className="form-group">
      <label className="form-label">Permissions</label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
        {ALL_PERMISSIONS.map(p => (
          <label key={p.key} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
            <input type="checkbox" checked={permissions.includes(p.key)} onChange={() => toggle(p.key)} style={{ marginTop: '3px', accentColor: 'var(--acc)' }} />
            <div>
              <div style={{ fontSize: '.84rem', fontWeight: 500, color: 'var(--tx)' }}>{p.label}</div>
              <div style={{ fontSize: '.76rem', color: 'var(--tx3)' }}>{p.description}</div>
            </div>
          </label>
        ))}
      </div>
    </div>
  )
}

function AdminNote() {
  return (
    <div style={{ padding: '10px 12px', background: 'var(--accp)', border: '1px solid var(--accl)', borderRadius: 'var(--rsm)', fontSize: '.82rem', color: 'var(--tx2)' }}>
      Admins and Superadmins automatically have full access to everything.
    </div>
  )
}

function ModalButtons({ onCancel, onConfirm, confirmLabel }) {
  return (
    <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
      <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onCancel}>Cancel</button>
      <button className="btn btn-primary" style={{ flex: 2 }} onClick={onConfirm}>{confirmLabel}</button>
    </div>
  )
}
