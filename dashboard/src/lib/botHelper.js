import { supabase } from './supabase'

/**
 * Gets the bot for the current user.
 * - Admins/superadmins: queries by organization_id
 * - Clients: queries by assigned_bot_id
 * Returns the bot object or null.
 */
export async function getAssignedBot(profile, selectFields = '*') {
  if (!profile) return null

  const isAdmin = profile.role === 'admin' || profile.role === 'superadmin'

  if (isAdmin && profile.organization_id) {
    const { data } = await supabase
      .from('bots')
      .select(selectFields)
      .eq('organization_id', profile.organization_id)
      .single()
    return data || null
  }

  if (profile.assigned_bot_id) {
    const { data } = await supabase
      .from('bots')
      .select(selectFields)
      .eq('id', profile.assigned_bot_id)
      .single()
    return data || null
  }

  return null
}
