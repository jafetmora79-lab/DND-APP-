import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { useAuth } from '@/lib/auth'
import { publicAsset, usingSupabase } from '@/lib/config'
import { LanguageToggle, useT } from '@/lib/i18n'
import { ThemeToggle } from '@/lib/theme'
import { forgetPlayerSession, getRecentSessions, setPendingJoin, type RecentPlayerSession } from '@/lib/recent-sessions'
import { cn } from '@/lib/utils'

export function Landing() {
  const { user, loading, loginDm, registerDm, joinPlayer } = useAuth()
  const { t } = useT()
  const nav = useNavigate()
  const [mode, setMode] = useState<'dm' | 'join'>('dm')
  const [creating, setCreating] = useState(false)
  const sampleTable = !usingSupabase && !import.meta.env.PROD
  const [name, setName] = useState(sampleTable ? 'Hearthkeeper' : '')
  const [passcode, setPasscode] = useState(sampleTable ? 'torch' : '')
  const [joinCode, setJoinCode] = useState(sampleTable ? 'HEARTH' : '')
  const [personal, setPersonal] = useState(sampleTable ? 'Elara' : '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [recent, setRecent] = useState<RecentPlayerSession[]>([])
  const [rejoinBusy, setRejoinBusy] = useState<string | null>(null)

  useEffect(() => {
    setRecent(getRecentSessions())
  }, [])

  useEffect(() => {
    if (mode !== 'join' || recent.length === 0) return
    if (!joinCode && !personal) {
      setJoinCode(recent[0].joinCode)
    }
  }, [mode, recent])

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
      setPendingJoin(joinCode, personal)
      const next = await joinPlayer(joinCode, personal)
      if (next.role === 'player') nav(`/play/${next.campaignId}`)
      else nav('/dm')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join')
    } finally {
      setBusy(false)
    }
  }

  async function rejoin(s: RecentPlayerSession) {
    setRejoinBusy(s.campaignId)
    setError('')
    try {
      setPendingJoin(s.joinCode, s.personalCode)
      const next = await joinPlayer(s.joinCode, s.personalCode)
      if (next.role === 'player') nav(`/play/${next.campaignId}`)
      else nav('/dm')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rejoin')
    } finally {
      setRejoinBusy(null)
    }
  }

  function removeRecent(e: React.MouseEvent, s: RecentPlayerSession) {
    e.stopPropagation()
    forgetPlayerSession(s.campaignId, s.characterId)
    setRecent(getRecentSessions())
  }

  return (
    <div className="relative min-h-dvh overflow-hidden bg-bg">
      <img src={publicAsset('tavern-hearth.jpg')} alt="" className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 bg-[#11100E]/60" />
      <div className="relative z-10 mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-4 py-10">
        <header className="text-center">
          <div className="mb-3 flex justify-center gap-2">
            <LanguageToggle />
            <ThemeToggle />
          </div>
          <p className="text-xs font-medium uppercase tracking-[0.4em] text-gold">{t('landing.kicker')}</p>
          <h1 className="title-gold mt-3 font-display text-4xl font-bold md:text-6xl">{t('landing.title')}</h1>
          <p className="mx-auto mt-4 max-w-md text-sm text-ink/85">
            {t('landing.blurb')}
          </p>
        </header>

        <div className="mt-8 rounded-xl border border-line bg-hud/90 p-6 shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur-sm">
          <div className="mb-4 flex gap-2">
            <Button variant={mode === 'dm' ? 'default' : 'ghost'} className="flex-1" type="button" onClick={() => setMode('dm')}>
              {t('landing.dm')}
            </Button>
            <Button variant={mode === 'join' ? 'default' : 'ghost'} className="flex-1" type="button" onClick={() => setMode('join')}>
              {t('landing.join')}
            </Button>
          </div>

          {mode === 'dm' ? (
            <form className="grid gap-3" onSubmit={submitDm}>
              {user?.role === 'dm' ? (
                <p className="text-sm text-muted">{t('landing.signedIn', { name: user.name })}</p>
              ) : (
                <>
                  <Field label={t('landing.tableName')}>
                    <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" required />
                  </Field>
                  <Field label={t('landing.passcode')}>
                    <Input
                      type="password"
                      value={passcode}
                      onChange={(e) => setPasscode(e.target.value)}
                      autoComplete="current-password"
                      minLength={usingSupabase ? 6 : 4}
                      required
                    />
                  </Field>
                  {usingSupabase && <p className="text-xs text-muted">{t('landing.hostedPass')}</p>}
                  <label className="flex items-center gap-2 text-sm text-muted">
                    <input type="checkbox" checked={creating} onChange={(e) => setCreating(e.target.checked)} />
                    {t('landing.claim')}
                  </label>
                </>
              )}
              {error && <p className="text-sm text-blood">{error}</p>}
              <Button type="submit" size="lg" disabled={busy || loading}>
                {busy ? t('landing.opening') : t('landing.start')}
              </Button>
            </form>
          ) : (
            <div className="grid gap-3">
              <form className="grid gap-3" onSubmit={submitJoin}>
                <Field label={t('landing.joinCode')}>
                  <Input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} autoCapitalize="characters" required />
                </Field>
              <Field label={t('landing.playerName')}>
                <Input
                  value={personal}
                  onChange={(e) => setPersonal(e.target.value)}
                  autoCapitalize="words"
                  autoComplete="nickname"
                  required
                />
              </Field>
                {error && <p className="text-sm text-blood">{error}</p>}
                <Button type="submit" size="lg" disabled={busy || loading}>
                  {busy ? t('landing.joining') : t('landing.start')}
                </Button>
              </form>

              {recent.length > 0 && (
                <div className="mt-4 border-t border-line pt-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted">Recent characters</p>
                  </div>
                  <ul className="space-y-2">
                    {recent.map((s) => (
                      <li key={`${s.campaignId}-${s.characterId}`}>
                        <button
                          type="button"
                          onClick={() => rejoin(s)}
                          disabled={rejoinBusy !== null}
                          className={cn(
                            'group flex w-full items-center gap-3 rounded-lg border border-line bg-panel-2/50 p-3 text-left transition hover:border-gold/50 hover:bg-gold/5',
                            rejoinBusy === s.campaignId && 'opacity-60',
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate font-semibold text-ink">{s.characterName}</span>
                              <span className="shrink-0 rounded-full bg-panel-2 px-2 py-0.5 text-[10px] text-muted">{s.joinCode}</span>
                            </div>
                            <div className="mt-0.5 truncate text-xs text-muted">
                              {s.campaignName} ·{' '}
                              {new Date(s.lastUsed).toLocaleDateString(undefined, {
                                month: 'short',
                                day: 'numeric',
                                hour: 'numeric',
                                minute: '2-digit',
                              })}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => removeRecent(e, s)}
                            className="shrink-0 rounded-md p-1.5 text-muted opacity-60 transition hover:bg-blood/20 hover:text-blood hover:opacity-100 group-hover:opacity-100"
                            aria-label="Forget this character"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                          <ChevronRight className={cn('h-4 w-4 shrink-0 text-muted transition', rejoinBusy === s.campaignId && 'animate-pulse')} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {usingSupabase ? (
          <p className="mt-6 text-center text-sm text-muted">{t('landing.share')}</p>
        ) : import.meta.env.PROD ? (
          <p className="mt-6 text-center text-sm text-muted">{t('landing.pagesHint')}</p>
        ) : (
          <p className="mt-6 text-center text-sm text-muted">{t('landing.sample')}</p>
        )}
      </div>
    </div>
  )
}
