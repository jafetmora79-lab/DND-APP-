/** Read PDF literal strings, hex strings, and names without needing an AcroForm catalog. */

function parsePdfLiteral(src: string, start: number): { value: string; end: number } {
  let i = start + 1
  let depth = 0
  let out = ''
  while (i < src.length) {
    const c = src[i]
    if (c === '\\') {
      const n = src[i + 1]
      if (n === undefined) break
      if (n === 'n') {
        out += '\n'
        i += 2
        continue
      }
      if (n === 'r') {
        out += '\r'
        i += 2
        continue
      }
      if (n === 't') {
        out += '\t'
        i += 2
        continue
      }
      if (n === '(' || n === ')' || n === '\\') {
        out += n
        i += 2
        continue
      }
      if (n >= '0' && n <= '7') {
        let oct = n
        i += 2
        while (oct.length < 3 && i < src.length && src[i] >= '0' && src[i] <= '7') {
          oct += src[i]
          i++
        }
        out += String.fromCharCode(Number.parseInt(oct, 8))
        continue
      }
      out += n
      i += 2
      continue
    }
    if (c === '(') {
      depth++
      out += c
      i++
      continue
    }
    if (c === ')') {
      if (depth === 0) return { value: out, end: i + 1 }
      depth--
      out += c
      i++
      continue
    }
    out += c
    i++
  }
  return { value: out, end: i }
}

function decodeHexString(hex: string) {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '')
  const bytes: number[] = []
  for (let i = 0; i + 1 < clean.length; i += 2) bytes.push(Number.parseInt(clean.slice(i, i + 2), 16))
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let s = ''
    for (let i = 2; i + 1 < bytes.length; i += 2) s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1])
    return s
  }
  return String.fromCharCode(...bytes)
}

function parsePdfValue(src: string, start: number): { value: string; end: number } | null {
  const rest = src.slice(start)
  const trimmed = rest.match(/^\s*/)?.[0].length ?? 0
  const i = start + trimmed
  if (src[i] === '(') return parsePdfLiteral(src, i)
  if (src[i] === '<') {
    const end = src.indexOf('>', i + 1)
    if (end < 0) return null
    return { value: decodeHexString(src.slice(i + 1, end)), end: end + 1 }
  }
  if (src[i] === '/') {
    const m = src.slice(i + 1).match(/^[A-Za-z0-9_.+-]+/)
    return { value: m ? m[0] : '', end: i + 1 + (m ? m[0].length : 0) }
  }
  const m = src.slice(i).match(/^(true|false|-?\d+)/)
  if (m) return { value: m[1], end: i + m[1].length }
  return null
}

function findKeyedValue(obj: string, key: '/T' | '/V') {
  let idx = obj.indexOf(key)
  while (idx >= 0) {
    const after = idx + key.length
    if (obj[after] === '(' || obj[after] === '<' || obj[after] === '/') {
      const parsed = parsePdfValue(obj, after)
      if (parsed) return parsed.value
    }
    idx = obj.indexOf(key, idx + 1)
  }
  return null
}

function normalizeMark(value: string) {
  const t = value.replace(/\u0000/g, '').trim()
  if (t === '\u2022' || t === '•' || t === '\u25cf') return 'true'
  return t
}

export function extractPdfWidgetFields(buffer: ArrayBuffer | Uint8Array): Record<string, string> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const src = new TextDecoder('latin1').decode(bytes)
  const fields: Record<string, string> = {}
  const chunks = src.split('endobj')
  for (const obj of chunks) {
    if (!obj.includes('/Subtype/Widget') && !obj.includes('/Subtype /Widget') && !obj.includes('/FT/')) continue
    const name = findKeyedValue(obj, '/T')
    if (!name) continue
    const raw = findKeyedValue(obj, '/V')
    const value = raw == null ? '' : normalizeMark(raw)
    const prev = fields[name]
    if (!prev || (!prev.trim() && value.trim())) fields[name] = value
  }
  return fields
}

export function indexPdfFields(fields: Record<string, string>) {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(fields)) {
    out[key] = value
    const trimmed = key.replace(/\s+/g, ' ').trim()
    if (!(trimmed in out) || !out[trimmed]?.trim()) out[trimmed] = value
  }
  return out
}
