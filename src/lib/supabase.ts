import { createClient } from '@supabase/supabase-js'
import { usingSupabase } from './config'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabase = usingSupabase && url && key ? createClient(url, key) : null
