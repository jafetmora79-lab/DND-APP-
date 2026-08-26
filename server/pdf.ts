import { PDFDocument, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFTextField } from 'pdf-lib'
import { emptySheet, type Ability, type CharacterSheetData } from '../src/lib/types.ts'

function text(fields: Record<string, string>, ...names: string[]) {
  for (const n of names) {
    const v = fields[n] ?? fields[n.toLowerCase()]
    if (v && v.trim()) return v.trim()
  }
  return ''
}

function num(fields: Record<string, string>, ...names: string[]) {
  const v = text(fields, ...names)
  const n = Number.parseInt(v.replace(/[^\d-]/g, ''), 10)
  return Number.isFinite(n) ? n : null
}

function checked(fields: Record<string, string>, ...names: string[]) {
  for (const n of names) {
    const v = (fields[n] ?? '').toLowerCase()
    if (v === 'true' || v === 'yes' || v === 'on' || v === '1') return true
  }
  return false
}

const ABILITY_FIELDS: Record<Ability, string[]> = {
  str: ['STR', 'Str', 'STRscore', 'Strength'],
  dex: ['DEX', 'Dex', 'DEXscore', 'Dexterity'],
  con: ['CON', 'Con', 'CONscore', 'Constitution'],
  int: ['INT', 'Int', 'INTscore', 'Intelligence'],
  wis: ['WIS', 'Wis', 'WISscore', 'Wisdom'],
  cha: ['CHA', 'Cha', 'CHAscore', 'Charisma'],
}

export async function parseCharacterPdf(buffer: Buffer) {
  const pdf = await PDFDocument.load(buffer)
  const form = pdf.getForm()
  const fields: Record<string, string> = {}
  const fieldNames: string[] = []

  for (const field of form.getFields()) {
    const name = field.getName()
    fieldNames.push(name)
    try {
      if (field instanceof PDFTextField) fields[name] = field.getText() ?? ''
      else if (field instanceof PDFCheckBox) fields[name] = field.isChecked() ? 'true' : 'false'
      else if (field instanceof PDFDropdown) fields[name] = field.getSelected().join(', ')
      else if (field instanceof PDFRadioGroup) fields[name] = field.getSelected() ?? ''
    } catch {
      fields[name] = ''
    }
  }

  const sheet = emptySheet()
  const characterName = text(fields, 'CharacterName', 'Character Name', 'Name')
  const playerName = text(fields, 'PlayerName', 'Player Name', 'Player')
  sheet.className = text(fields, 'ClassLevel', 'ClassLevel 2', 'Class')
  const classMatch = sheet.className.match(/(\d+)/)
  if (classMatch) sheet.level = Number(classMatch[1]) || 1
  sheet.race = text(fields, 'Race', 'Race ', 'CharacterRace')
  sheet.background = text(fields, 'Background')
  sheet.alignment = text(fields, 'Alignment')
  sheet.xp = num(fields, 'XP', 'ExperiencePoints') ?? 0
  sheet.ac = num(fields, 'AC', 'ArmorClass') ?? 10
  sheet.speed = text(fields, 'Speed') || '30 ft.'
  sheet.hpMax = num(fields, 'HPMax', 'MaxHP', 'HP Maximum') ?? 10
  sheet.hpCurrent = num(fields, 'HPCurrent', 'CurrentHP', 'HP') ?? sheet.hpMax
  sheet.hpTemp = num(fields, 'HPTemp', 'TempHP') ?? 0
  sheet.hitDice = text(fields, 'HDTotal', 'HitDice', 'HD') || sheet.hitDice
  sheet.personality = text(fields, 'PersonalityTraits ', 'PersonalityTraits', 'Personality')
  sheet.ideals = text(fields, 'Ideals')
  sheet.bonds = text(fields, 'Bonds')
  sheet.flaws = text(fields, 'Flaws')
  sheet.features = text(fields, 'Features and Traits', 'Feat+Traits', 'FeaturesTraits')
  sheet.equipment = text(fields, 'Equipment', 'Eqp')
  sheet.backstory = text(fields, 'Allies', 'Backstory', 'CharacterBackstory')
  sheet.notes = text(fields, 'AdditionalNotes', 'Notes', 'ProficienciesLang')

  for (const ab of Object.keys(ABILITY_FIELDS) as Ability[]) {
    sheet.abilities[ab] = num(fields, ...ABILITY_FIELDS[ab]) ?? 10
    sheet.savingThrowProf[ab] = checked(
      fields,
      `ST ${ABILITY_FIELDS[ab][3] ?? ab}`,
      `ST ${ab.toUpperCase()}`,
      `${ab.toUpperCase()} Save Prof`,
    )
  }

  const skillMap: Record<string, string[]> = {
    acrobatics: ['Check Box 11', 'Acrobatics', 'Acrobatics Prof'],
    animalHandling: ['Check Box 18', 'Animal', 'Animal Handling'],
    arcana: ['Check Box 19', 'Arcana'],
    athletics: ['Check Box 20', 'Athletics'],
    deception: ['Check Box 21', 'Deception'],
    history: ['Check Box 22', 'History'],
    insight: ['Check Box 23', 'Insight'],
    intimidation: ['Check Box 24', 'Intimidation'],
    investigation: ['Check Box 25', 'Investigation'],
    medicine: ['Check Box 26', 'Medicine'],
    nature: ['Check Box 27', 'Nature'],
    perception: ['Check Box 28', 'Perception'],
    performance: ['Check Box 29', 'Performance'],
    persuasion: ['Check Box 30', 'Persuasion'],
    religion: ['Check Box 31', 'Religion'],
    sleightOfHand: ['Check Box 32', 'SleightofHand', 'Sleight of Hand'],
    stealth: ['Check Box 33', 'Stealth'],
    survival: ['Check Box 34', 'Survival'],
  }
  for (const [key, names] of Object.entries(skillMap)) {
    if (checked(fields, ...names) || text(fields, ...names.filter((n) => !n.startsWith('Check')))) {
      sheet.skillProf[key] = true
    }
  }

  sheet.attacks = [
    {
      name: text(fields, 'Wpn Name', 'Wpn Name 2', 'AttacksSpellcasting'),
      bonus: text(fields, 'Wpn1 AtkBonus', 'Wpn2 AtkBonus'),
      damage: text(fields, 'Wpn1 Damage', 'Wpn2 Damage'),
      range: '5 ft.',
    },
  ].filter((a) => a.name)
  if (sheet.attacks.length === 0) sheet.attacks = [{ name: '', bonus: '', damage: '', range: '5 ft.' }]

  sheet.spellcastingAbility = (text(fields, 'SpellcastingAbility', 'Spellcasting Ability').toLowerCase().slice(0, 3) ||
    '') as CharacterSheetData['spellcastingAbility']
  if (!['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(sheet.spellcastingAbility)) {
    sheet.spellcastingAbility = ''
  }

  const spells: CharacterSheetData['spells'] = []
  for (const [name, value] of Object.entries(fields)) {
    if (/^Spells\s*\d/.test(name) && value.trim()) {
      const level = Number(name.replace(/\D/g, '').slice(0, 1)) || 0
      spells.push({ name: value.trim(), level, prepared: true })
    }
  }
  sheet.spells = spells
  return { characterName, playerName, sheet, fieldNames, fieldCount: fieldNames.length }
}
