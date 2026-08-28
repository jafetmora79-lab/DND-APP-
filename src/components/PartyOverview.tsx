import { useState } from 'react'
import { Heart, Skull, Activity, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { CharacterSheet } from '@/components/CharacterSheet'
import type { PlayerCharacter } from '@/lib/types'
import { cn } from '@/lib/utils'

type Props = {
  characters: PlayerCharacter[]
  selectedId: string | null
  onSelectCharacter: (id: string) => void
  onClose: () => void
  canEditId?: string | null
  onChange?: (characterId: string, patch: Partial<PlayerCharacter> & { sheet?: PlayerCharacter['sheet'] }) => void
}

export function PartyOverview({ characters, selectedId, onSelectCharacter, onClose, canEditId, onChange }: Props) {
  const [notes, setNotes] = useState(() => localStorage.getItem('dnd-party-notes') || '')
  const [viewingSheet, setViewingSheet] = useState<string | null>(null)

  const viewing = characters.find((c) => c.id === viewingSheet) ?? characters.find((c) => c.id === selectedId)

  function saveNotes(value: string) {
    setNotes(value)
    localStorage.setItem('dnd-party-notes', value)
  }

  function hpPercent(current: number, max: number) {
    if (max <= 0) return 0
    return Math.max(0, Math.min(100, (current / max) * 100))
  }

  function hpColor(percent: number) {
    if (percent > 50) return 'bg-moss'
    if (percent > 25) return 'bg-gold'
    return 'bg-blood'
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/60 md:items-stretch md:justify-end">
      <div className="flex h-[88dvh] w-full flex-col rounded-t-2xl border border-line bg-panel p-4 md:h-full md:max-w-lg md:rounded-none">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg text-gold-2">Party Overview</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted hover:text-ink">
            <X className="h-5 w-5" />
          </button>
        </div>

        {!viewingSheet ? (
          <>
            <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gold">Party Members</h3>
              <div className="space-y-2">
                {characters.map((char) => {
                  const percent = hpPercent(char.sheet.hpCurrent, char.sheet.hpMax)
                  const deathSaves = char.sheet.deathSuccess ?? 0
                  const deathFails = char.sheet.deathFail ?? 0
                  const isDying = char.sheet.hpCurrent <= 0 && deathSaves < 3 && deathFails < 3
                  const isDead = char.sheet.hpCurrent <= 0 && deathFails >= 3

                  return (
                    <div
                      key={char.id}
                      className={cn(
                        'cursor-pointer rounded-lg border p-3 transition-all hover:border-gold/50',
                        selectedId === char.id ? 'border-gold bg-gold/10' : 'border-line bg-panel/50',
                      )}
                      onClick={() => onSelectCharacter(char.id)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{char.name}</span>
                            {isDead && <Skull className="h-4 w-4 text-blood" />}
                            {isDying && <Activity className="h-4 w-4 animate-pulse text-blood" />}
                          </div>
                          <div className="mt-1 text-xs text-muted">Level {char.sheet.level}</div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          onClick={(e) => {
                            e.stopPropagation()
                            setViewingSheet(char.id)
                          }}
                        >
                          View Sheet
                        </Button>
                      </div>

                      <div className="mt-2">
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="text-muted">HP</span>
                          <span className={cn('font-medium', (isDying || isDead) && 'text-blood')}>
                            {char.sheet.hpCurrent}/{char.sheet.hpMax}
                          </span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg">
                          <div className={cn('h-full rounded-full transition-all', hpColor(percent))} style={{ width: `${percent}%` }} />
                        </div>
                      </div>

                      {isDying && (
                        <div className="mt-2 flex items-center gap-3 text-xs">
                          <div className="flex items-center gap-1">
                            <Heart className="h-3 w-3 text-moss" />
                            <span className="text-muted">Saves:</span>
                            <span className="font-medium text-moss">{deathSaves}/3</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Skull className="h-3 w-3 text-blood" />
                            <span className="text-muted">Fails:</span>
                            <span className="font-medium text-blood">{deathFails}/3</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
                {characters.length === 0 && <p className="text-sm text-muted">No characters in this campaign yet.</p>}
              </div>

              <div className="space-y-3 pt-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gold">Campaign Notes</h3>
                <div className="rounded-lg border border-line bg-panel/50 p-3">
                  <Textarea
                    className="min-h-[100px] resize-none"
                    placeholder="Add your personal notes about the campaign..."
                    value={notes}
                    onChange={(e) => saveNotes(e.target.value)}
                  />
                  <p className="mt-2 text-xs text-muted">Notes are saved locally on your device.</p>
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="mt-4 flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setViewingSheet(null)} className="h-8 px-3 text-xs">
                ← Back to Party
              </Button>
              <span className="text-sm text-muted">{viewing?.name}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pt-3">
              {viewing && (
                <CharacterSheet
                  character={viewing}
                  canEdit={viewing.id === canEditId}
                  onChange={(patch) => onChange?.(viewing.id, patch)}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
