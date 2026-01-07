import { supabase as defaultSupabase } from './supabase'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getUserProfile } from './user'

export interface AuthResult {
  userId: string
  username: string | null
  email: string
  session: any
}

export async function ensureAuth(client?: SupabaseClient): Promise<string> {
  const sb = client ?? defaultSupabase
  
  // Get the authenticated session from Supabase client
  const { data: { session }, error } = await sb.auth.getSession()
  
  if (error || !session || !session.user) {
    throw new Error('Not authenticated - please sign in first')
  }

  // Verify the user actually exists by getting user info (uses current session)
  const { data: { user }, error: userError } = await sb.auth.getUser()
  
  if (userError || !user || user.id !== session.user.id) {
    throw new Error('Invalid session - please sign in again')
  }

  return user.id
}

export interface RegisterData {
  username: string
  email: string
  password: string
}

export async function registerUser(data: RegisterData, client?: SupabaseClient): Promise<AuthResult> {
  const sb = client ?? defaultSupabase
  
  // Sign up
  const { data: authData, error: authError } = await sb.auth.signUp({
    email: data.email,
    password: data.password,
    options: {
      emailRedirectTo: undefined,
    }
  })

  if (authError) {
    if (authError.message.includes('already exists')) {
      throw new Error('This email is already registered. Please log in instead.')
    }
    throw authError
  }

  if (!authData?.user) {
    throw new Error('Failed to create account')
  }

  const userId = authData.user.id

  // Create profile entry
  const { error: profileError } = await sb
    .from('profiles')
    .upsert({
      id: userId,
      username: data.username.trim(),
    })

  if (profileError) {
    console.warn('[auth] Could not create profile entry')
  }

  // Get profile to return username
  const profile = await getUserProfile(userId)
  
  return {
    userId,
    username: profile?.username || data.username.trim(),
    email: data.email,
    session: authData.session
  }
}

export interface LoginData {
  email: string
  password: string
}

export async function loginUser(data: LoginData, client?: SupabaseClient): Promise<AuthResult> {
  const sb = client ?? defaultSupabase
  
  const { data: signInData, error: signInError } = await sb.auth.signInWithPassword({
    email: data.email,
    password: data.password,
  })

  if (signInError) {
    throw new Error(signInError.message || 'Invalid email or password')
  }

  if (!signInData?.user) {
    throw new Error('Failed to get user data')
  }

  // Verify the user actually exists
  const { data: { user: verifiedUser }, error: verifyError } = await sb.auth.getUser()
  
  if (verifyError || !verifiedUser || verifiedUser.id !== signInData.user.id) {
    throw new Error('Failed to verify authenticated user - user may not exist in Supabase')
  }
  
  // Verify user exists in profiles table
  const profile = await getUserProfile(verifiedUser.id)
  
  if (!profile) {
    throw new Error('User profile does not exist - this account is not properly registered')
  }
  
  return {
    userId: verifiedUser.id,
    username: profile.username,
    email: data.email,
    session: signInData.session
  }
}

export async function signOut(client?: SupabaseClient): Promise<void> {
  const sb = client ?? defaultSupabase
  await sb.auth.signOut()
}

export async function initializeSession(email: string, password: string, client?: SupabaseClient): Promise<AuthResult> {
  const sb = client ?? defaultSupabase
  
  // Clear any existing session first
  await signOut(sb)
  
  const { data, error } = await sb.auth.signInWithPassword({ email, password })

  if (error) {
    throw new Error(error.message || 'Could not authenticate')
  }

  if (!data?.session) {
    throw new Error('Failed to obtain session from Supabase - check your credentials')
  }

  // Verify the user actually exists
  const { data: { user: verifiedUser }, error: verifyError } = await sb.auth.getUser()
  
  if (verifyError) {
    throw new Error(`Failed to verify user: ${verifyError.message || 'User does not exist in Supabase'}`)
  }
  
  if (!verifiedUser) {
    throw new Error('User does not exist - please sign in with a valid account')
  }
  
  if (verifiedUser.id !== data.user.id) {
    throw new Error('User ID mismatch - session may be invalid')
  }
  
  // Verify user exists in profiles table
  const profile = await getUserProfile(verifiedUser.id)
  
  if (!profile) {
    throw new Error('User profile does not exist - this account is not properly registered')
  }
  
  return {
    userId: verifiedUser.id,
    username: profile.username,
    email,
    session: data.session
  }
}
