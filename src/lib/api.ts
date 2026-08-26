import { usingSupabase } from './config'
import { localApi, getToken, setToken } from './local-api'
import { supabaseApi } from './supabase-api'

export { getToken, setToken }

export const api = usingSupabase ? supabaseApi : localApi
