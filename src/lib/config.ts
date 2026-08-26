export const usingSupabase = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)

/** Prefix a file in `public/` with Vite's base (needed on GitHub project Pages). */
export function publicAsset(path: string) {
  const base = import.meta.env.BASE_URL || '/'
  return `${base}${path.replace(/^\//, '')}`
}

export function assertHostedBackend() {
  if (import.meta.env.PROD && !usingSupabase) {
    throw new Error(
      'This GitHub Pages copy has no hosted backend yet. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY as repository Actions secrets, then re-run the Pages workflow.',
    )
  }
}

export function tableEmail(name: string) {
  const slug =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'table'
  return `${slug}@dndlivetable.app`
}
