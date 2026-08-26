import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { useAuth } from '@/lib/auth'
import { publicAsset, usingSupabase } from '@/lib/config'
import { LanguageToggle, useT } from '@/lib/i18n'

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
          <div className="mb-3 flex justify-center">
            <LanguageToggle />
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
            <form className="grid gap-3" onSubmit={submitJoin}>
              <Field label={t('landing.joinCode')}>
                <Input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} autoCapitalize="characters" required />
              </Field>
              <Field label={t('landing.personalCode')}>
                <Input value={personal} onChange={(e) => setPersonal(e.target.value.toUpperCase())} autoCapitalize="characters" required />
              </Field>
              {error && <p className="text-sm text-blood">{error}</p>}
              <Button type="submit" size="lg" disabled={busy || loading}>
                {busy ? t('landing.joining') : t('landing.start')}
              </Button>
            </form>
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
