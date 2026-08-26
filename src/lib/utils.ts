import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function abilityMod(score: number) {
  return Math.floor((score - 10) / 2)
}

export function signed(n: number) {
  return n >= 0 ? `+${n}` : String(n)
}

export function proficiencyBonus(level: number) {
  return Math.ceil(Math.max(1, level) / 4) + 1
}

export function crXp(cr: number) {
  const table: Record<string, number> = {
    '0': 10,
    '0.125': 25,
    '0.25': 50,
    '0.5': 100,
    '1': 200,
    '2': 450,
    '3': 700,
    '4': 1100,
    '5': 1800,
    '6': 2300,
    '7': 2900,
    '8': 3900,
    '9': 5000,
    '10': 5900,
    '11': 7200,
    '12': 8400,
    '13': 10000,
    '14': 11500,
    '15': 13000,
    '16': 15000,
    '17': 18000,
    '18': 20000,
    '19': 22000,
    '20': 25000,
    '21': 33000,
    '22': 41000,
    '23': 50000,
    '24': 62000,
    '30': 155000,
  }
  return table[String(cr)] ?? 0
}

export function tokenSizeSquares(size: string) {
  const s = size.toLowerCase()
  if (s.includes('gargantuan')) return 4
  if (s.includes('huge')) return 3
  if (s.includes('large')) return 2
  return 1
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

export function templateTokenCell(
  spec: { startX?: number; startY?: number },
  copyIndex: number,
  placed: number,
) {
  const hasStart = Number.isFinite(spec.startX) && Number.isFinite(spec.startY)
  const baseCol = hasStart ? Number(spec.startX) : 2 + (placed % 8)
  const baseRow = hasStart ? Number(spec.startY) : 2 + Math.floor(placed / 8)
  return { col: baseCol + (copyIndex % 4), row: baseRow + Math.floor(copyIndex / 4) }
}

export function hpColor(current: number, max: number) {
  if (max <= 0) return 'bg-muted'
  const r = current / max
  if (r > 0.66) return 'bg-moss'
  if (r > 0.33) return 'bg-gold'
  return 'bg-blood'
}
