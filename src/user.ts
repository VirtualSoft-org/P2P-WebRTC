import { supabase } from './supabase'

export interface UserProfile {
  id: string
  username: string | null
}

export interface RoomMember {
  user_id: string
}

/**
 * Get user profile by user ID
 */
export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, username')
    .eq('id', userId)
    .single()

  if (error || !profile) {
    return null
  }

  return {
    id: profile.id,
    username: profile.username || null
  }
}

/**
 * Get multiple user profiles by user IDs
 */
export async function getUserProfiles(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) {
    return new Map()
  }

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username')
    .in('id', userIds)

  const userMap = new Map<string, string>()
  if (profiles) {
    for (const profile of profiles) {
      userMap.set(profile.id, profile.username || profile.id.substring(0, 8))
    }
  }

  return userMap
}

/**
 * Get all members in a room
 */
export async function getRoomMembers(roomId: string): Promise<RoomMember[]> {
  const { data: members, error } = await supabase
    .from('room_members')
    .select('user_id')
    .eq('room_id', roomId)

  if (error || !members) {
    throw new Error('Failed to fetch room members')
  }

  return members
}

/**
 * Get room members excluding a specific user
 */
export async function getRoomMembersExcluding(roomId: string, excludeUserId: string): Promise<string[]> {
  const members = await getRoomMembers(roomId)
  return members
    .map(m => m.user_id)
    .filter(id => id !== excludeUserId)
}

