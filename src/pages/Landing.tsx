import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Dices, Map as MapIcon, ScrollText, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { useAuth } from '@/lib/auth'

export function Landing() {
  const { loginDm, registerDm, joinPlayer } = useAuth()
  const nav = useNavigate()
  const [mode, setMode] = useState<'dm' | 'join'>('dm')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('Hearthkeeper')
  const [passcode, setPasscode] = useState('torch')
  const [joinCode, setJoinCode] = useState('HEARTH')
  const [personal, setPersonal] = useState('ELARA7K2')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submitDm(e: FormEvent) {
    e.preventDefault()
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
      const user = await joinPlayer(joinCode, personal)
      if (user.role === 'player') nav(`/play/${user.campaignId}`)
      else nav('/dm')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 py-8 md:py-14">
      <header className="text-center">
        <p className="text-xs uppercase tracking-[0.35em] text-gold">Campaign companion</p>
        <h1 className="mt-3 font-display text-4xl text-gold-2 md:text-6xl">D&D Live Table</h1>
        <p className="mx-auto mt-4 max-w-2xl text-muted">
          Prep maps, a shared bestiary, and encounter templates. Open a live session and every phone at the table
          mirrors the map, the tracker, and every character sheet — then pause mid-fight and pick it up next week, HP and fog included.
        </p>
      </header>

      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {[
          { icon: MapIcon, title: 'Prep library', copy: 'Maps, SRD bestiary, and encounter templates live with the campaign — the bestiary follows you across every table you run.' },
          { icon: Users, title: 'The live table', copy: 'Players join with tonight’s code plus their personal character code. They watch. You move tokens and run combat.' },
          { icon: ScrollText, title: 'Sheets for the whole table', copy: 'Anyone can read any sheet. Only the owner and the DM can change it. Empty tabs stay hidden.' },
        ].map((c) => (
          <div key={c.title} className="rounded-xl border border-line bg-panel/80 p-5">
            <c.icon className="h-5 w-5 text-ember" />
            <h2 className="mt-3 font-display text-lg text-gold">{c.title}</h2>
            <p className="mt-2 text-sm text-muted">{c.copy}</p>
          </div>
        ))}
      </div>

      <div className="mx-auto mt-10 w-full max-w-lg rounded-xl border border-line bg-panel p-6">
        <div className="mb-4 flex gap-2">
          <Button variant={mode === 'dm' ? 'default' : 'ghost'} className="flex-1" onClick={() => setMode('dm')}>
            Dungeon Master
          </Button>
          <Button variant={mode === 'join' ? 'default' : 'ghost'} className="flex-1" onClick={() => setMode('join')}>
            Join as player
          </Button>
        </div>

        {mode === 'dm' ? (
          <form className="grid gap-3" onSubmit={submitDm}>
            <Field label="Table name">
              <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" />
            </Field>
            <Field label="Passcode">
              <Input type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} autoComplete="current-password" />
            </Field>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={creating} onChange={(e) => setCreating(e.target.checked)} />
              Claim a new table (seeds the SRD 5.1 bestiary)
            </label>
            {error && <p className="text-sm text-blood">{error}</p>}
            <Button type="submit" disabled={busy}>
              {busy ? 'Opening…' : creating ? 'Create table' : 'Open the table'}
            </Button>
          </form>
        ) : (
          <form className="grid gap-3" onSubmit={submitJoin}>
            <Field label="Tonight’s join code">
              <Input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} autoCapitalize="characters" />
            </Field>
            <Field label="Your personal character code">
              <Input value={personal} onChange={(e) => setPersonal(e.target.value.toUpperCase())} autoCapitalize="characters" />
            </Field>
            {error && <p className="text-sm text-blood">{error}</p>}
            <Button type="submit" disabled={busy}>
              {busy ? 'Joining…' : 'Sit down'}
            </Button>
            <p className="text-xs text-muted">Need the campaign name first? Codes are case-insensitive.</p>
          </form>
        )}
      </div>

      <p className="mt-8 text-center text-sm text-muted">
        <Dices className="mr-1 inline h-4 w-4 text-gold" />
        Sample table is already seated: DM <span className="text-ink">Hearthkeeper</span> / <span className="text-ink">torch</span>.
        Players join <span className="text-ink">HEARTH</span> with <span className="text-ink">ELARA7K2</span> or{' '}
        <span className="text-ink">BROK4M9X</span>. The Cragmaw Ambush is paused in round 2.
      </p>
    </div>
  )
}
