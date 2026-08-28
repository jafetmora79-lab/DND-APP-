/** Supabase Storage object keys reject spaces, em dashes, and most punctuation. */
export function safeStorageFileName(name: string) {
  const base = String(name || 'file').replace(/\\/g, '/').split('/').pop() || 'file'
  const dot = base.lastIndexOf('.')
  const stemRaw = dot > 0 ? base.slice(0, dot) : base
  const extRaw = dot > 0 ? base.slice(dot + 1) : ''
  const stem =
    stemRaw
      .normalize('NFKD')
      .replace(/[^\w]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'file'
  const ext = extRaw.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'
  return `${stem}.${ext}`
}

export function storageObjectPath(folder: string, fileName: string) {
  const safeFolder = folder
    .split('/')
    .map((part) => part.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'x')
    .join('/')
  const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `f${Date.now()}`
  return `${safeFolder}/${id}-${safeStorageFileName(fileName)}`
}
