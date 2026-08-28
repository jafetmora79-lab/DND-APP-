import type { ReactNode } from 'react'
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/lib/auth'
import { I18nProvider } from '@/lib/i18n'
import { Campaigns } from '@/pages/Campaigns'
import { Landing } from '@/pages/Landing'
import { Live } from '@/pages/Live'
import { Player } from '@/pages/Player'
import { Prep } from '@/pages/Prep'

function Guard({ role, children }: { role: 'dm' | 'player'; children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="p-8 text-muted">Checking the roster…</div>
  if (!user) return <Navigate to="/" replace />
  if (user.role !== role) return <Navigate to={user.role === 'dm' ? '/dm' : `/play/${user.campaignId}`} replace />
  return children
}

export default function App() {
  const Router = import.meta.env.VITE_HASH_ROUTER === '1' ? HashRouter : BrowserRouter
  const basename =
    import.meta.env.VITE_HASH_ROUTER === '1' ? undefined : import.meta.env.BASE_URL.replace(/\/$/, '') || undefined
  return (
    <I18nProvider>
      <AuthProvider>
        <Router basename={basename}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route
              path="/dm"
              element={
                <Guard role="dm">
                  <Campaigns />
                </Guard>
              }
            />
            <Route
              path="/dm/:campaignId"
              element={
                <Guard role="dm">
                  <Prep />
                </Guard>
              }
            />
            <Route
              path="/dm/:campaignId/live"
              element={
                <Guard role="dm">
                  <Live />
                </Guard>
              }
            />
            <Route
              path="/play/:campaignId"
              element={
                <Guard role="player">
                  <Player />
                </Guard>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Router>
      </AuthProvider>
    </I18nProvider>
  )
}
