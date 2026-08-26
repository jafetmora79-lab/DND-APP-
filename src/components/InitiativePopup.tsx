import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import { initiativeBonusFor, rollD20 } from '@/lib/combat'
import { useT } from '@/lib/i18n'
import type { Combatant, PlayerCharacter } from '@/lib/types'
import { signed } from '@/lib/utils'

type Props = {
  instanceId: string
  campaignId: string
  combatants: Combatant[]
  characters: PlayerCharacter[]
  isDm: boolean
  myCombatantId?: string | null
  onSettled: () => void
  onClose: () => void
}

function sheetFor(c: Combatant, characters: PlayerCharacter[]) {
  if (c.source !== 'character') return null
  return characters.find((ch) => ch.id === c.sourceId)?.sheet ?? null
}

export function InitiativePopup({
  instanceId,
  campaignId,
  combatants,
  characters,
  isDm,
  myCombatantId,
  onSettled,
  onClose,
}: Props) {
  const { t } = useT()
  const ordered = useMemo(
    () => [...combatants].sort((a, b) => a.turnOrderPosition - b.turnOrderPosition),
    [combatants],
  )
  const visible = isDm ? ordered : ordered.filter((c) => c.id === myCombatantId)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const pending = ordered.filter((c) => c.initiative === 0)
  const pendingMonsters = pending.filter((c) => c.source === 'bestiary')

  async function submit(c: Combatant, d20: number) {
    if (!Number.isInteger(d20) || d20 < 1 || d20 > 20) {
      setMsg('d20 must be 1–20')
      return
    }
    setBusy(true)
    try {
      await api.setInitiative(c.id, { d20 })
      setDraft((d) => ({ ...d, [c.id]: '' }))
      onSettled()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not set initiative')
    } finally {
      setBusy(false)
    }
  }

  async function rollOne(c: Combatant) {
    const n = rollD20()
    setDraft((d) => ({ ...d, [c.id]: String(n) }))
    await submit(c, n)
  }

  async function rollRemainingMonsters() {
    setBusy(true)
    try {
      for (const c of pendingMonsters) {
        await api.setInitiative(c.id, { d20: rollD20() })
      }
      onSettled()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not roll monsters')
    } finally {
      setBusy(false)
    }
  }

  async function rollRemainingVisible() {
    setBusy(true)
    try {
      for (const c of visible.filter((x) => x.initiative === 0)) {
        await api.setInitiative(c.id, { d20: rollD20() })
      }
      onSettled()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not roll')
    } finally {
      setBusy(false)
    }
  }

  async function begin() {
    setBusy(true)
    try {
      await api.sortInit(instanceId, { keepCurrent: false })
      await api.beginRound(campaignId)
      onSettled()
      onClose()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not begin')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="dialog" aria-label={t('init.title')}>
      <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-xl border border-line bg-panel p-5">
        <h2 className="font-display text-2xl text-gold-2">{t('init.title')}</h2>
        <p className="mt-1 text-sm text-muted">{t('init.blurb')}</p>
        {visible.length === 0 && <p className="mt-4 text-sm text-muted">{t('init.waiting')}</p>}
        <ul className="mt-4 space-y-2">
          {visible.map((c) => {
            const sheet = sheetFor(c, characters)
            const bonus = initiativeBonusFor(c, sheet)
            const d20 = Number(draft[c.id])
            const preview = Number.isInteger(d20) && d20 >= 1 && d20 <= 20 ? d20 + bonus : c.initiative
            const dex = c.source === 'character' ? sheet?.abilities.dex ?? 10 : c.stats?.dex ?? 10
            return (
              <li key={c.id} className="rounded-md border border-line bg-bg p-3">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full" style={{ background: c.color }} />
                  <span className="flex-1 font-medium">{c.name}</span>
                  <span className="text-xs text-muted">
                    Dex {dex} · {t('init.bonus')} {signed(bonus)}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                  <Input
                    className="h-8 w-16"
                    inputMode="numeric"
                    placeholder="d20"
                    value={draft[c.id] ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, [c.id]: e.target.value }))}
                    aria-label={`${c.name} d20`}
                  />
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void rollOne(c)}>
                    {t('init.roll')}
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => void submit(c, Number(draft[c.id]))}
                  >
                    {t('init.submit')}
                  </Button>
                  <span className="stat-num text-gold">
                    {t('init.total')} {preview}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
        {msg && <p className="mt-3 text-sm text-blood">{msg}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {t('init.later')}
          </Button>
          {isDm && pendingMonsters.length > 0 && (
            <Button variant="outline" disabled={busy} onClick={() => void rollRemainingMonsters()}>
              {t('init.rollMonsters')}
            </Button>
          )}
          {!isDm && visible.some((c) => c.initiative === 0) && (
            <Button variant="outline" disabled={busy} onClick={() => void rollRemainingVisible()}>
              {t('init.roll')}
            </Button>
          )}
          {isDm && (
            <Button variant="ember" disabled={busy} onClick={() => void begin()}>
              {t('init.begin')}
              {pending.length ? ` (${pending.length})` : ''}
            </Button>
          )}
        </div>
        {isDm && pending.length > 0 && (
          <p className="mt-2 text-xs text-muted">
            {pending.map((c) => c.name).join(', ')} still at 0 — begin anyway after you sort, or roll them first.
          </p>
        )}
      </div>
    </div>
  )
}
