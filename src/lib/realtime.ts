import { useEffect, useRef } from 'react'
import { api, getToken } from './api'
import { usingSupabase } from './config'
import { supabase } from './supabase'
import type { EncounterSnapshot } from './types'

export function useLive(campaignId: string | undefined, onSnap: (s: EncounterSnapshot) => void) {
  const cb = useRef(onSnap)
  cb.current = onSnap

  useEffect(() => {
    if (!campaignId) return

    if (usingSupabase && supabase) {
      const client = supabase
      let timer: ReturnType<typeof setTimeout> | undefined
      const reload = () => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          api.live(campaignId).then((snap) => cb.current(snap)).catch(() => undefined)
        }, 120)
      }
      const channel = client
        .channel(`campaign:${campaignId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'encounter_instances', filter: `campaign_id=eq.${campaignId}` }, reload)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'live_sessions', filter: `campaign_id=eq.${campaignId}` }, reload)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'player_characters', filter: `campaign_id=eq.${campaignId}` }, reload)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'campaigns', filter: `id=eq.${campaignId}` }, reload)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'combatants' }, reload)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tokens_on_map' }, reload)
        .subscribe()
      return () => {
        if (timer) clearTimeout(timer)
        void client.removeChannel(channel)
      }
    }

    const token = getToken()
    if (!token) return
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}&campaignId=${campaignId}`)
    ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe', campaignId }))
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as { type: string; payload: EncounterSnapshot }
        if (msg.type === 'snapshot') cb.current(msg.payload)
      } catch {
        /* ignore */
      }
    }
    return () => ws.close()
  }, [campaignId])
}
