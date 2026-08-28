import assert from 'node:assert/strict'
import { applyEncounterRewards, emptyHub, markBeatForTemplate, parseBrief, parseHub, sortTemplates, stageAfterTemplate, stageHasContent, stagePlacementLabel } from '../src/lib/campaign-hub.ts'
import { packMonstersJson, unpackTemplateJson } from '../src/lib/template-json.ts'

function check(name: string, fn: () => void) {
  fn()
  console.log(`ok  ${name}`)
}

check('pack/unpack encounter brief', () => {
  const packed = packMonstersJson(
    [{ bestiaryMonsterId: 'g', name: 'Goblin', quantity: 2, startX: 1, startY: 1, color: '#4ea36a' }],
    [{ characterId: 'c', name: 'Elara', startX: 2, startY: 2, color: '#6ea8c9' }],
    true,
    parseBrief({ notes: 'Ambush', objective: 'Survive', difficulty: 'Deadly', xpAward: 200, lootNotes: '15 gp', sortOrder: 2 }),
  )
  const out = unpackTemplateJson({ monsters_json: packed, characters_json: [] })
  assert.equal(out.monsters[0].name, 'Goblin')
  assert.equal(out.characters[0].name, 'Elara')
  assert.equal(out.brief.xpAward, 200)
  assert.equal(out.brief.objective, 'Survive')
})

check('legacy monster array still unpacks', () => {
  const out = unpackTemplateJson({
    monsters_json: JSON.stringify([{ bestiaryMonsterId: 'g', name: 'Goblin', quantity: 1, startX: 0, startY: 0, color: '#' }]),
    characters_json: JSON.stringify([{ characterId: 'c', name: 'Brok', startX: 1, startY: 1, color: '#' }]),
  })
  assert.equal(out.monsters.length, 1)
  assert.equal(out.characters[0].name, 'Brok')
  assert.equal(out.brief.xpAward, 0)
})

check('rewards on win', () => {
  const hub = parseHub({
    ...emptyHub(),
    recap: 'Hired in Neverwinter.',
    beats: [{ id: 'b1', kind: 'combat', title: 'Ambush', notes: '', templateId: 't1', status: 'active' }],
    stages: [{ id: 's0', name: 'Tavern', imageUrl: '/t.jpg', caption: 'Fire', afterTemplateId: 't1', beforeTemplateId: '' }],
  })
  const next = applyEncounterRewards({
    hub,
    outcome: 'won',
    encounterName: 'Cragmaw Ambush',
    templateId: 't1',
    brief: parseBrief({ xpAward: 150, lootNotes: 'Potion of healing' }),
    lootHolder: 'Elara',
  })
  assert.equal(next.xp, 150)
  assert.equal(next.hub.beats[0].status, 'done')
  assert.equal(next.hub.loot[0].name, 'Potion of healing')
  assert.equal(next.hub.loot[0].holder, 'Elara')
  assert.match(next.hub.recap, /victory/)
  assert.equal(next.hub.stages[0]?.name, 'Tavern')
})

check('loss awards no XP', () => {
  const next = applyEncounterRewards({
    hub: emptyHub(),
    outcome: 'lost',
    encounterName: 'Ambush',
    templateId: null,
    brief: parseBrief({ xpAward: 150, lootNotes: 'Gold' }),
  })
  assert.equal(next.xp, 0)
  assert.equal(next.hub.loot.length, 0)
})

check('mark beat active and sort templates', () => {
  const hub = markBeatForTemplate(
    parseHub({ beats: [{ id: 'b1', kind: 'combat', title: 'A', notes: '', templateId: 't1', status: 'upcoming' }] }),
    't1',
    'active',
  )
  assert.equal(hub.beats[0].status, 'active')
  const sorted = sortTemplates([
    { name: 'B', sortOrder: 2 },
    { name: 'A', sortOrder: 1 },
  ])
  assert.equal(sorted[0].name, 'A')
})

check('legacy hubs get an empty stages list', () => {
  const hub = parseHub({ sessionTitle: 'Old', beats: [] })
  assert.deepEqual(hub.stages, [])
})

check('stage after a finished fight and start-of-night slot', () => {
  const hub = parseHub({
    stages: [
      { id: 's0', name: 'Tavern', imageUrl: '/tavern.jpg', caption: 'Warm fire', afterTemplateId: '', beforeTemplateId: 't1' },
      { id: 's1', name: 'Road', imageUrl: '/road.jpg', caption: 'Dust', afterTemplateId: 't1', beforeTemplateId: 't2' },
    ],
  })
  assert.equal(stageAfterTemplate(hub, '')?.name, 'Tavern')
  assert.equal(stageAfterTemplate(hub, 't1')?.name, 'Road')
  assert.equal(stageAfterTemplate(hub, 't2'), null)
  assert.equal(stageHasContent(hub.stages[0]!), true)
  assert.equal(
    stagePlacementLabel(hub.stages[1]!, [
      { id: 't1', name: 'Ambush' },
      { id: 't2', name: 'Cave' },
    ]),
    'After Ambush, before Cave',
  )
})

console.log('all hub checks passed')
