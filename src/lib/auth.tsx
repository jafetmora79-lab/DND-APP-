import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, getToken, setToken } from './api'
import { assertHostedBackend, usingSupabase } from './config'
import { supabase } from './supabase'
import type { AuthUser } from './types'

type AuthState = {
  user: AuthUser | null
  loading: boolean
  loginDm: (name: string, passcode: string) => Promise<void>
  registerDm: (name: string, passcode: string) => Promise<void>
  joinPlayer: (joinCode: string, playerName: string) => Promise<AuthUser>
  logout: () => void
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (usingSupabase && supabase) {
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        if (!session) {
          setUser(null)
          setLoading(false)
          return
        }
        api
          .me()
          .then((r) => setUser(r.user))
          .catch(() => setUser(null))
          .finally(() => setLoading(false))
      })
      return () => data.subscription.unsubscribe()
    }
    if (!getToken()) {
      setLoading(false)
      return
    }
    api
      .me()
      .then((r) => setUser(r.user))
      .catch(() => setToken(null))
      .finally(() => setLoading(false))
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      loginDm: async (name, passcode) => {
        assertHostedBackend()
        const r = await api.login(name, passcode)
        setToken(r.token)
        setUser(r.user)
      },
      registerDm: async (name, passcode) => {
        assertHostedBackend()
        const r = await api.register(name, passcode)
        setToken(r.token)
        setUser(r.user)
      },
      joinPlayer: async (joinCode, playerName) => {
        assertHostedBackend()
        const r = await api.join(joinCode, playerName)
        setToken(r.token)
        setUser(r.user)
        return r.user
      },
      logout: () => {
        setToken(null)
        setUser(null)
        if (usingSupabase) void supabase?.auth.signOut()
      },
    }),
    [user, loading],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('AuthProvider missing')
  return ctx
}
