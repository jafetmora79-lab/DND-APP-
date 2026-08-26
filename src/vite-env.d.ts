/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_HASH_ROUTER?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.json' {
  const value: unknown
  export default value
}
