import { PDFDocument, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFTextField } from 'pdf-lib'
import { extractPdfWidgetFields, indexPdfFields } from './extract-pdf-fields.ts'
import { abilityMod } from './utils.ts'
import { emptySheet, type Ability, type CharacterSheetData } from './types.ts'
import { parseDarkvisionFt } from './vision.ts'

function text(fields: Record<string, string>, ...names: string[]) {
  for (const n of names) {
    const v = fields[n] ?? fields[n.toLowerCase()]
    if (v && v.trim() && v.trim() !== '--') return v.trim()
  }
  return ''
}

function num(fields: Record<string, string>, ...names: string[]) {
  const v = text(fields, ...names)
  if (!v) return null
  const n = Number.parseInt(v.replace(/[^\d-]/g, ''), 10)
  return Number.isFinite(n) ? n : null
}

function checked(fields: Record<string, string>, ...names: string[]) {
  for (const n of names) {
    const v = (fields[n] ?? '').trim().toLowerCase()
    if (v === 'true' || v === 'yes' || v === 'on' || v === '1' || v === 'p' || v === 'e') return true
  }
  return false
}

function expertise(fields: Record<string, string>, ...names: string[]) {
  for (const n of names) {
    const v = (fields[n] ?? '').trim().toLowerCase()
    if (v === 'e' || v === 'expertise') return true
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

const ABILITY_LABEL: Record<Ability, string> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
}

async function acroFormFields(buffer: Uint8Array) {
  const fields: Record<string, string> = {}
  try {
    const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true })
    const form = pdf.getForm()
    for (const field of form.getFields()) {
      const name = field.getName()
      try {
        if (field instanceof PDFTextField) fields[name] = field.getText() ?? ''
        else if (field instanceof PDFCheckBox) fields[name] = field.isChecked() ? 'true' : 'false'
        else if (field instanceof PDFDropdown) fields[name] = field.getSelected().join(', ')
        else if (field instanceof PDFRadioGroup) fields[name] = field.getSelected() ?? ''
      } catch {
        fields[name] = fields[name] ?? ''
      }
    }
  } catch {
    return fields
  }
  return fields
}

function toBytes(buffer: ArrayBuffer | Uint8Array) {
  return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
}

function speedText(raw: string) {
  const m = raw.match(/(\d+\s*ft\.?)/i)
  return m ? m[1].replace(/ft$/i, 'ft.') : raw
}

function attackRange(notes: string, spellRange: string) {
  const thrown = notes.match(/Range\s*\(\s*(\d+)\s*\/\s*(\d+)/i)
  if (thrown) return `${thrown[1]}/${thrown[2]} ft.`
  const noteFt = notes.match(/(\d+)\s*ft/i)
  if (noteFt) return `${noteFt[1]} ft.`
  const spellFt = spellRange.match(/(\d+)\s*ft/i)
  if (spellFt) return `${spellFt[1]} ft.`
  return '5 ft.'
}

function collectAttacks(fields: Record<string, string>, spellRangeByName: Map<string, string>) {
  const attacks: CharacterSheetData['attacks'] = []
  for (let i = 1; i <= 8; i++) {
    const suffix = i === 1 ? '' : ` ${i}`
    const name = text(fields, `Wpn Name${suffix}`, `Wpn Name${suffix}`.trim())
    if (!name) continue
    const bonusKey = i === 1 ? 'Wpn1 AtkBonus' : `Wpn${i} AtkBonus`
    const damageKey = i === 1 ? 'Wpn1 Damage' : `Wpn${i} Damage`
    const notes = text(fields, `Wpn Notes ${i}`, `Wpn Notes${i}`)
    attacks.push({
      name,
      bonus: text(fields, bonusKey),
      damage: text(fields, damageKey),
      range: attackRange(notes, spellRangeByName.get(name) ?? ''),
    })
  }
  return attacks
}

function collectSpells(fields: Record<string, string>) {
  const spells: CharacterSheetData['spells'] = []
  const spellRangeByName = new Map<string, string>()
  let level = 0
  const slots = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  for (let i = 0; i <= 80; i++) {
    const header = text(fields, `spellHeader${i}`)
    const headerLevel = header.match(/(\d+)\s*(st|nd|rd|th)\s*LEVEL/i)
    if (/CANTRIP/i.test(header)) level = 0
    else if (headerLevel) level = Number(headerLevel[1])
    const slotHeader = text(fields, `spellSlotHeader${i}`)
    const slotN = slotHeader.match(/(\d+)\s*Slots/i)
    if (slotN && level >= 1 && level <= 9) slots[level] = Number(slotN[1])
    const name = text(fields, `spellName${i}`, `Spells ${i}`)
    if (!name || /^===/.test(name)) continue
    const range = text(fields, `spellRange${i}`)
    spellRangeByName.set(name.replace(/\s*\[R\]\s*$/, ''), range)
    spells.push({
      name,
      level,
      prepared: !/^[-–—]$/.test(text(fields, `spellPrepared${i}`)),
      concentration: false,
    })
  }
  for (const [name, value] of Object.entries(fields)) {
    if (/^Spells\s*\d/.test(name) && value.trim() && !spells.some((s: { name: string }) => s.name === value.trim())) {
      const lv = Number(name.replace(/\D/g, '').slice(0, 1)) || 0
      spells.push({ name: value.trim(), level: lv, prepared: true, concentration: false })
    }
  }
  return { spells, slots, spellRangeByName }
}

function collectEquipment(fields: Record<string, string>) {
  const lines: string[] = []
  for (let i = 0; i <= 40; i++) {
    const name = text(fields, `Eq Name${i}`)
    if (!name) continue
    const qty = text(fields, `Eq Qty${i}`)
    lines.push(qty && qty !== '1' ? `${name} ×${qty}` : name)
  }
  if (lines.length) return lines.join('\n')
  return text(fields, 'Equipment', 'Eqp')
}

export async function parseCharacterPdf(buffer: ArrayBuffer | Uint8Array) {
  const bytes = toBytes(buffer)
  const merged = { ...extractPdfWidgetFields(bytes), ...(await acroFormFields(bytes)) }
  const fields = indexPdfFields(merged)
  const fieldNames = Object.keys(merged)
  const fieldCount = fieldNames.filter((n) => (merged[n] ?? '').trim()).length
  if (fieldCount === 0) {
    throw new Error(
      'This PDF has no readable character fields. Export a D&D Beyond character PDF, or use a fillable 5e sheet.',
    )
  }

  const sheet = emptySheet()
  const characterName = text(fields, 'CharacterName', 'Character Name', 'Name')
  const playerName = text(fields, 'PlayerName', 'PLAYER NAME', 'Player Name', 'Player')

  sheet.className = text(fields, 'ClassLevel', 'ClassLevel 2', 'CLASS LEVEL', 'CLASS  LEVEL', 'Class')
  const classMatch = sheet.className.match(/(\d+)/)
  if (classMatch) sheet.level = Number(classMatch[1]) || 1
  sheet.race = text(fields, 'Race', 'RACE', 'Race ', 'CharacterRace')
  sheet.background = text(fields, 'Background', 'BACKGROUND')
  sheet.alignment = text(fields, 'Alignment', 'ALIGNMENT')
  sheet.xp = num(fields, 'XP', 'ExperiencePoints', 'EXPERIENCE POINTS') ?? 0
  sheet.ac = num(fields, 'AC', 'ArmorClass') ?? 10
  sheet.speed = speedText(text(fields, 'Speed') || '30 ft.')
  sheet.initiativeBonus = num(fields, 'Init', 'Initiative')
  sheet.hpMax = num(fields, 'HPMax', 'MaxHP', 'HP Maximum') ?? 10
  sheet.hpCurrent = num(fields, 'HPCurrent', 'CurrentHP', 'HP') ?? sheet.hpMax
  sheet.hpTemp = num(fields, 'HPTemp', 'TempHP') ?? 0
  sheet.hitDice = text(fields, 'HDTotal', 'HitDice', 'HD', 'Total') || sheet.hitDice
  sheet.personality = text(fields, 'PersonalityTraits ', 'PersonalityTraits', 'Personality')
  sheet.ideals = text(fields, 'Ideals')
  sheet.bonds = text(fields, 'Bonds')
  sheet.flaws = text(fields, 'Flaws')
  sheet.features = [text(fields, 'Features and Traits', 'Feat+Traits', 'FeaturesTraits', 'FeaturesTraits3'), text(fields, 'Actions2', 'Actions')]
    .filter(Boolean)
    .join('\n')
  sheet.equipment = collectEquipment(fields)
  sheet.backstory = text(fields, 'Allies', 'Backstory', 'CharacterBackstory')
  sheet.notes = [text(fields, 'AdditionalNotes', 'Notes'), text(fields, 'ProficienciesLang'), text(fields, 'SaveModifiers')]
    .filter(Boolean)
    .join('\n')
  const dv = parseDarkvisionFt(sheet.features, sheet.notes, sheet.race)
  if (dv > 0) sheet.darkvisionFt = dv

  for (const ab of Object.keys(ABILITY_FIELDS) as Ability[]) {
    sheet.abilities[ab] = num(fields, ...ABILITY_FIELDS[ab]) ?? 10
    const st = num(fields, `ST ${ABILITY_LABEL[ab]}`, `ST ${ab.toUpperCase()}`, `${ab.toUpperCase()} Save Prof`)
    const markedProf = checked(fields, `${ab[0]!.toUpperCase()}${ab.slice(1)}Prof`, `ST ${ABILITY_LABEL[ab]}`)
    sheet.savingThrowProf[ab] =
      markedProf || (st != null && st > abilityMod(sheet.abilities[ab]))
  }
  // Bard-style D&D Beyond uses DexProf/ChaProf as a bullet hex, decoded to "true"
  for (const ab of Object.keys(ABILITY_FIELDS) as Ability[]) {
    const label = ab.charAt(0).toUpperCase() + ab.slice(1)
    if (checked(fields, `${label}Prof`)) sheet.savingThrowProf[ab] = true
  }

  const skillMap: Record<string, string[]> = {
    acrobatics: ['AcrobaticsProf', 'Check Box 11', 'Acrobatics'],
    animalHandling: ['AnimalHandlingProf', 'Check Box 18', 'Animal', 'Animal Handling'],
    arcana: ['ArcanaProf', 'Check Box 19', 'Arcana'],
    athletics: ['AthleticsProf', 'Check Box 20', 'Athletics'],
    deception: ['DeceptionProf', 'Check Box 21', 'Deception'],
    history: ['HistoryProf', 'Check Box 22', 'History'],
    insight: ['InsightProf', 'Check Box 23', 'Insight'],
    intimidation: ['IntimidationProf', 'Check Box 24', 'Intimidation'],
    investigation: ['InvestigationProf', 'Check Box 25', 'Investigation'],
    medicine: ['MedicineProf', 'Check Box 26', 'Medicine'],
    nature: ['NatureProf', 'Check Box 27', 'Nature'],
    perception: ['PerceptionProf', 'Check Box 28', 'Perception'],
    performance: ['PerformanceProf', 'Check Box 29', 'Performance'],
    persuasion: ['PersuasionProf', 'Check Box 30', 'Persuasion'],
    religion: ['ReligionProf', 'Check Box 31', 'Religion'],
    sleightOfHand: ['SleightOfHandProf', 'Check Box 32', 'SleightofHand', 'Sleight of Hand'],
    stealth: ['StealthProf', 'Check Box 33', 'Stealth'],
    survival: ['SurvivalProf', 'Check Box 34', 'Survival'],
  }
  for (const [key, names] of Object.entries(skillMap)) {
    const profNames = names.filter((n) => /Prof|Check Box/.test(n))
    sheet.skillProf[key] = checked(fields, ...profNames) || checked(fields, ...names)
    sheet.skillExpertise[key] = expertise(fields, ...profNames, ...names)
    if (sheet.skillExpertise[key]) sheet.skillProf[key] = true
  }

  const { spells, slots, spellRangeByName } = collectSpells(fields)
  sheet.spells = spells
  sheet.spellSlots = slots
  sheet.attacks = collectAttacks(fields, spellRangeByName)
  if (sheet.attacks.length === 0) {
    const single = text(fields, 'Wpn Name', 'AttacksSpellcasting')
    if (single) {
      sheet.attacks = [
        {
          name: single,
          bonus: text(fields, 'Wpn1 AtkBonus'),
          damage: text(fields, 'Wpn1 Damage'),
          range: '5 ft.',
        },
      ]
    } else {
      sheet.attacks = [{ name: '', bonus: '', damage: '', range: '5 ft.' }]
    }
  }

  sheet.spellcastingAbility = (
    text(fields, 'spellCastingAbility0', 'SpellcastingAbility', 'Spellcasting Ability').toLowerCase().slice(0, 3) || ''
  ) as CharacterSheetData['spellcastingAbility']
  if (!['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(sheet.spellcastingAbility)) {
    sheet.spellcastingAbility = ''
  }

  return { characterName, playerName, sheet, fieldNames, fieldCount }
}
