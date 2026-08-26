import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { useAuth } from '@/lib/auth'
import { publicAsset, usingSupabase } from '@/lib/config'

export function Landing() {
  const { user, loading, loginDm, registerDm, joinPlayer } = useAuth()
  const nav = useNavigate()
  const [mode, setMode] = useState<'dm' | 'join'>('dm')
  const [creating, setCreating] = useState(false)
  const sampleTable = !usingSupabase && !import.meta.env.PROD
  const [name, setName] = useState(sampleTable ? 'Hearthkeeper' : '')
  const [passcode, setPasscode] = useState(sampleTable ? 'torch' : '')
  const [joinCode, setJoinCode] = useState(sampleTable ? 'HEARTH' : '')
  const [personal, setPersonal] = useState(sampleTable ? 'ELARA7K2' : '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submitDm(e: FormEvent) {
    e.preventDefault()
    if (user?.role === 'dm') {
      nav('/dm')
      return
    }
    setBusy(true)
    setError('')
    try {
      if (creating) await registerDm(name, passcode)
      else await loginDm(name, passcode)
      nav('/dm')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in')
    } finally {
      setBusy(false)
    }
  }

  async function submitJoin(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const next = await joinPlayer(joinCode, personal)
      if (next.role === 'player') nav(`/play/${next.campaignId}`)
      else nav('/dm')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative min-h-dvh overflow-hidden bg-bg">
      <img src={publicAsset('tavern-hearth.jpg')} alt="" className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 bg-[#11100E]/60" />
      <div className="relative z-10 mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-4 py-10">
        <header className="text-center">
          <p className="text-xs font-medium uppercase tracking-[0.4em] text-gold">Campaign companion</p>
          <h1 className="title-gold mt-3 font-display text-4xl font-bold md:text-6xl">D&D LIVE TABLE</h1>
          <p className="mx-auto mt-4 max-w-md text-sm text-ink/85">
            Prep the campaign, open the live table, and keep every phone on the same map, tracker, and character sheet.
          </p>
        </header>

        <div className="mt-8 rounded-xl border border-line bg-hud/90 p-6 shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur-sm">
          <div className="mb-4 flex gap-2">
            <Button variant={mode === 'dm' ? 'default' : 'ghost'} className="flex-1" type="button" onClick={() => setMode('dm')}>
              Dungeon Master
            </Button>
            <Button variant={mode === 'join' ? 'default' : 'ghost'} className="flex-1" type="button" onClick={() => setMode('join')}>
              Join as player
            </Button>
          </div>

          {mode === 'dm' ? (
            <form className="grid gap-3" onSubmit={submitDm}>
              {user?.role === 'dm' ? (
                <p className="text-sm text-muted">Signed in as {user.name}. Start to open your campaigns.</p>
              ) : (
                <>
                  <Field label="Table name">
                    <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" required />
                  </Field>
                  <Field label="Passcode">
                    <Input
                      type="password"
                      value={passcode}
                      onChange={(e) => setPasscode(e.target.value)}
                      autoComplete="current-password"
                      minLength={usingSupabase ? 6 : 4}
                      required
                    />
                  </Field>
                  {usingSupabase && <p className="text-xs text-muted">Hosted tables need a passcode of at least 6 characters.</p>}
                  <label className="flex items-center gap-2 text-sm text-muted">
                    <input type="checkbox" checked={creating} onChange={(e) => setCreating(e.target.checked)} />
                    Claim a new table
                  </label>
                </>
              )}
              {error && <p className="text-sm text-blood">{error}</p>}
              <Button type="submit" size="lg" disabled={busy || loading}>
                {busy ? 'Opening…' : 'Start'}
              </Button>
            </form>
          ) : (
            <form className="grid gap-3" onSubmit={submitJoin}>
              <Field label="Tonight’s join code">
                <Input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} autoCapitalize="characters" required />
              </Field>
              <Field label="Your personal character code">
                <Input value={personal} onChange={(e) => setPersonal(e.target.value.toUpperCase())} autoCapitalize="characters" required />
              </Field>
              {error && <p className="text-sm text-blood">{error}</p>}
              <Button type="submit" size="lg" disabled={busy || loading}>
                {busy ? 'Joining…' : 'Start'}
              </Button>
            </form>
          )}
        </div>

        {usingSupabase ? (
          <p className="mt-6 text-center text-sm text-muted">Share tonight’s join code with the phones at the table.</p>
        ) : import.meta.env.PROD ? (
          <p className="mt-6 text-center text-sm text-muted">
            This GitHub Pages copy needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY as repository Actions secrets.
          </p>
        ) : (
          <p className="mt-6 text-center text-sm text-muted">
            Sample table: Hearthkeeper / torch. Players join HEARTH with ELARA7K2 or BROK4M9X.
          </p>
        )}
      </div>
    </div>
  )
}
