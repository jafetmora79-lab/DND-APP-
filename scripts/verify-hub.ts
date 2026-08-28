import assert from 'node:assert/strict'
import {
  applyEncounterRewards,
  emptyHub,
  hubForPlayer,
  markBeatActive,
  markBeatForTemplate,
  openingSceneBeat,
  parseBrief,
  parseHub,
  sceneAfterEncounter,
  sortTemplates,
  stageAfterTemplate,
  stageHasContent,
  stagePlacementLabel,
  tableAmbiance,
} from '../src/lib/campaign-hub.ts'
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

check('rewards on win mark the fight done and the next scene active', () => {
  const hub = parseHub({
    ...emptyHub(),
    recap: 'Hired in Neverwinter.',
    beats: [
      { id: 'b0', kind: 'social', title: 'Tavern', notes: '', templateId: '', status: 'upcoming', imageUrl: '/inn.jpg', caption: 'Warm fire' },
      { id: 'b1', kind: 'combat', title: 'Ambush', notes: '', templateId: 't1', status: 'active' },
      { id: 'b2', kind: 'travel', title: 'Road', notes: '', templateId: '', status: 'upcoming', imageUrl: '/road.jpg', caption: 'Dust' },
    ],
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
  assert.equal(next.hub.beats[1]!.status, 'done')
  assert.equal(next.hub.beats[2]!.status, 'active')
  assert.equal(next.hub.loot[0].name, 'Potion of healing')
  assert.equal(next.hub.loot[0].holder, 'Elara')
  assert.match(next.hub.recap, /victory/)
  assert.equal(sceneAfterEncounter(next.hub, 't1')?.title, 'Road')
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

check('legacy After/Before stages fold into a linear run', () => {
  const hub = parseHub({
    stages: [
      { id: 's0', name: 'Tavern', imageUrl: '/tavern.jpg', caption: 'Warm fire', afterTemplateId: '', beforeTemplateId: 't1' },
      { id: 's1', name: 'Road', imageUrl: '/road.jpg', caption: 'Dust', afterTemplateId: 't1', beforeTemplateId: 't2' },
    ],
  })
  assert.equal(openingSceneBeat(hub)?.title, 'Tavern')
  assert.equal(sceneAfterEncounter(hub, 't1')?.title, 'Road')
  assert.equal(sceneAfterEncounter(hub, 't2'), null)
  assert.equal(stageAfterTemplate(hub, '')?.name, 'Tavern')
  assert.equal(stageAfterTemplate(hub, 't1')?.name, 'Road')
  assert.equal(stageHasContent(hub.beats[0] ? { id: 'x', name: hub.beats[0].title, imageUrl: hub.beats[0].imageUrl, caption: hub.beats[0].caption, afterTemplateId: '', beforeTemplateId: '' } : null), true)
  assert.equal(
    stagePlacementLabel(
      { afterTemplateId: 't1', beforeTemplateId: 't2' },
      [
        { id: 't1', name: 'Ambush' },
        { id: 't2', name: 'Cave' },
      ],
    ),
    'After Ambush, before Cave',
  )
})

check('mixed beats plus leftover end-of-night stage', () => {
  const hub = parseHub({
    beats: [
      { id: 'b1', kind: 'social', title: 'Mayor', notes: '', templateId: '', status: 'upcoming' },
      { id: 'b2', kind: 'combat', title: 'Front Desk', notes: '', templateId: 'e1', status: 'upcoming' },
      { id: 'b3', kind: 'combat', title: 'Boss', notes: '', templateId: 'e3', status: 'upcoming' },
    ],
    stages: [{ id: 'st3', name: 'Pie', imageUrl: '', caption: 'Pie time', afterTemplateId: 'e3', beforeTemplateId: '' }],
  })
  assert.equal(openingSceneBeat(hub)?.title, 'Mayor')
  assert.equal(sceneAfterEncounter(hub, 'e3')?.title, 'Pie')
  assert.match(sceneAfterEncounter(hub, 'e3')?.caption ?? '', /Pie time/)
  assert.deepEqual(hub.stages, [])
})

check('removing a scene is not resurrected by leftover After/Before slots', () => {
  const hub = parseHub({
    beats: [
      { id: 'b1', kind: 'social', title: 'Mayor', notes: '', templateId: '', status: 'upcoming', caption: 'Town square' },
      { id: 'b2', kind: 'combat', title: 'Front Desk', notes: '', templateId: 'e1', status: 'upcoming' },
    ],
    stages: [
      { id: 'st0', name: 'Winkwell square', imageUrl: '', caption: 'Town square', afterTemplateId: '', beforeTemplateId: 'e1' },
    ],
  })
  const withoutMayor = parseHub({ ...hub, beats: hub.beats.filter((b) => b.id !== 'b1') })
  assert.equal(withoutMayor.beats.some((b) => b.id === 'b1'), false)
  assert.equal(withoutMayor.beats.some((b) => /Mayor|Winkwell/.test(b.title)), false)
  assert.equal(withoutMayor.beats[0]?.title, 'Front Desk')
})

check('active scene fills the table and players do not see upcoming beats', () => {
  const hub = parseHub({
    beats: [
      { id: 'b0', kind: 'social', title: 'Acto I', notes: 'DM only', templateId: '', status: 'active', imageUrl: '/cabin.jpg', caption: 'Dawn at the cabin' },
      { id: 'b1', kind: 'social', title: 'Acto II', notes: '', templateId: '', status: 'upcoming', imageUrl: '/store.jpg', caption: 'Aisle' },
      { id: 'b2', kind: 'combat', title: 'Map 01', notes: '', templateId: 't1', status: 'upcoming' },
    ],
  })
  const stage = tableAmbiance(hub, { ambianceImageUrl: null, ambianceCaption: '' })
  assert.equal(stage.imageUrl, '/cabin.jpg')
  assert.match(stage.caption, /Dawn/)
  const player = hubForPlayer(hub)
  assert.equal(player.beats.length, 1)
  assert.equal(player.beats[0]?.title, 'Acto I')
  assert.equal(player.beats[0]?.notes, '')
  assert.equal(player.sessionNotes, '')
  assert.equal(player.beats.some((b) => b.title === 'Acto II' || b.title === 'Map 01'), false)
  const jumped = markBeatActive(hub, 'b1')
  assert.equal(jumped.beats[0]?.status, 'upcoming')
  assert.equal(jumped.beats[1]?.status, 'active')
  assert.equal(tableAmbiance(jumped, { ambianceImageUrl: '/cabin.jpg', ambianceCaption: 'Dawn at the cabin' }).imageUrl, '/store.jpg')
})

console.log('all hub checks passed')
