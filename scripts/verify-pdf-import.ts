import assert from 'node:assert/strict'
import fs from 'node:fs'
import { extractPdfWidgetFields, indexPdfFields } from '../src/lib/extract-pdf-fields.ts'
import { parseCharacterPdf } from '../src/lib/parse-pdf.ts'

function check(name: string, fn: () => void) {
  fn()
  console.log(`ok  ${name}`)
}

async function checkAsync(name: string, fn: () => Promise<void>) {
  await fn()
  console.log(`ok  ${name}`)
}

const snippet = Buffer.from(
  [
    '1 0 obj<< /Subtype/Widget /FT/Tx /T(CharacterName) /V(Maevyre Reedshine) >>endobj',
    '2 0 obj<< /Subtype/Widget /FT/Tx /T(CLASS  LEVEL) /V(Bard 2) >>endobj',
    '3 0 obj<< /Subtype/Widget /FT/Tx /T(STR) /V(14) >>endobj',
    '4 0 obj<< /Subtype/Widget /FT/Tx /T(DexProf) /V<FEFF2022> >>endobj',
    '5 0 obj<< /Subtype/Widget /FT/Tx /T(ArcanaProf) /V(E) >>endobj',
    '6 0 obj<< /Subtype/Widget /FT/Tx /T(Wpn Name) /V(Dagger) >>endobj',
    '7 0 obj<< /Subtype/Widget /FT/Tx /T(Wpn1 AtkBonus) /V(+4) >>endobj',
    '8 0 obj<< /Subtype/Widget /FT/Tx /T(Wpn1 Damage) /V(1d4+2 Piercing) >>endobj',
  ].join('\n'),
)

check('widget dump reads D&D Beyond /T /V pairs', () => {
  const fields = indexPdfFields(extractPdfWidgetFields(snippet))
  assert.equal(fields.CharacterName, 'Maevyre Reedshine')
  assert.equal(fields['CLASS LEVEL'], 'Bard 2')
  assert.equal(fields.STR, '14')
  assert.equal(fields.DexProf, 'true')
  assert.equal(fields.ArcanaProf, 'E')
})

await checkAsync('synthetic D&D Beyond widgets fill a sheet', async () => {
  const parsed = await parseCharacterPdf(snippet)
  assert.equal(parsed.characterName, 'Maevyre Reedshine')
  assert.equal(parsed.sheet.className, 'Bard 2')
  assert.equal(parsed.sheet.level, 2)
  assert.equal(parsed.sheet.abilities.str, 14)
  assert.equal(parsed.sheet.savingThrowProf.dex, true)
  assert.equal(parsed.sheet.skillExpertise.arcana, true)
  assert.equal(parsed.sheet.attacks[0]?.name, 'Dagger')
  assert.equal(parsed.sheet.attacks[0]?.bonus, '+4')
})

const ddb = '/home/ubuntu/.cursor/projects/workspace/uploads/Finnie12_144458077_0c00.pdf'
if (fs.existsSync(ddb)) {
  await checkAsync('Finnie D&D Beyond PDF: Maevyre Reedshine bard 2', async () => {
    const parsed = await parseCharacterPdf(fs.readFileSync(ddb))
    assert.equal(parsed.characterName, 'Maevyre Reedshine')
    assert.equal(parsed.playerName, 'Finnie12')
    assert.equal(parsed.sheet.className, 'Bard 2')
    assert.equal(parsed.sheet.level, 2)
    assert.equal(parsed.sheet.race, 'Lightfoot Halfling')
    assert.equal(parsed.sheet.background, 'Sage')
    assert.equal(parsed.sheet.abilities.str, 14)
    assert.equal(parsed.sheet.abilities.dex, 15)
    assert.equal(parsed.sheet.abilities.cha, 15)
    assert.equal(parsed.sheet.ac, 13)
    assert.equal(parsed.sheet.hpMax, 17)
    assert.equal(parsed.sheet.hpCurrent, 17)
    assert.equal(parsed.sheet.speed, '25 ft.')
    assert.equal(parsed.sheet.savingThrowProf.dex, true)
    assert.equal(parsed.sheet.savingThrowProf.cha, true)
    assert.equal(parsed.sheet.savingThrowProf.str, false)
    assert.equal(parsed.sheet.skillProf.perception, true)
    assert.equal(parsed.sheet.skillProf.arcana, true)
    assert.equal(parsed.sheet.skillExpertise.arcana, true)
    assert.equal(parsed.sheet.skillProf.acrobatics, false)
    assert.ok(parsed.sheet.attacks.some((a) => a.name === 'Dagger' && a.bonus === '+4'))
    assert.ok(parsed.sheet.attacks.some((a) => a.name === 'Starry Wisp'))
    assert.equal(parsed.sheet.spellcastingAbility, 'cha')
    assert.ok(parsed.sheet.spells.some((s) => s.name.includes('Faerie Fire')))
    assert.ok(parsed.fieldCount > 50)
  })
}

console.log('all pdf import checks passed')
