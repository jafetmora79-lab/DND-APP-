import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/lib/auth'
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
  return (
    <AuthProvider>
      <BrowserRouter>
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
      </BrowserRouter>
    </AuthProvider>
  )
}
