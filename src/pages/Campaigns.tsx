import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { LanguageToggle, useT } from '@/lib/i18n'
import { ThemeToggle } from '@/lib/theme'
import type { Campaign } from '@/lib/types'

export function Campaigns() {
  const { user, logout } = useAuth()
  const { t } = useT()
  const nav = useNavigate()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (user && user.role !== 'dm') nav('/')
  }, [user, nav])

  async function load() {
    const r = await api.campaigns()
    setCampaigns(r.campaigns)
  }

  useEffect(() => {
    load().catch((e) => setError(e.message))
  }, [])

  async function create(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    await api.createCampaign(name.trim())
    setName('')
    await load()
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-gold">{user && 'name' in user ? user.name : 'Dungeon Master'}</p>
          <h1 className="font-display text-3xl text-gold-2">{t('campaigns.title')}</h1>
        </div>
        <div className="flex items-center gap-2">
          <LanguageToggle />
          <ThemeToggle />
          <Button variant="ghost" onClick={() => { logout(); nav('/') }}>
            {t('campaigns.signOut')}
          </Button>
        </div>
      </div>
      <p className="mt-2 text-sm text-muted">{t('campaigns.blurb')}</p>
      {error && <p className="mt-3 text-blood">{error}</p>}
      <form className="mt-6 flex gap-2" onSubmit={create}>
        <Field label={t('campaigns.new')} className="flex-1">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Phandalin Nights" />
        </Field>
        <Button className="mt-6" type="submit">
          {t('campaigns.create')}
        </Button>
      </form>
      <ul className="mt-8 grid gap-3">
        {campaigns.length === 0 && <li className="text-muted">{t('campaigns.empty')}</li>}
        {campaigns.map((c) => (
          <li key={c.id} className="flex items-center justify-between rounded-xl border border-line bg-panel px-4 py-4">
            <div>
              <div className="font-display text-xl text-gold">{c.name}</div>
              <div className="text-sm text-muted">
                {c.hub?.sessionTitle || t('campaigns.hubFallback')}
                {c.hub?.quests?.some((q) => q.status === 'open')
                  ? ` · ${c.hub.quests.filter((q) => q.status === 'open').length} ${t('campaigns.openQuests')}`
                  : ''}
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" asChild>
                <Link to={`/dm/${c.id}`}>{t('campaigns.prep')}</Link>
              </Button>
              <Button asChild>
                <Link to={`/dm/${c.id}/live`}>{t('campaigns.live')}</Link>
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
