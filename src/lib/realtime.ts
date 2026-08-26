import { useCallback, useEffect, useRef } from 'react'
import { api, getToken } from './api'
import { usingSupabase } from './config'
import { supabase } from './supabase'
import type { EncounterSnapshot } from './types'

/** Subscribe to live table updates. Returns a function that refetches the snapshot immediately (coalesced). */
export function useLive(campaignId: string | undefined, onSnap: (s: EncounterSnapshot) => void) {
  const cb = useRef(onSnap)
  cb.current = onSnap
  const reloadRef = useRef<() => void>(() => undefined)

  useEffect(() => {
    if (!campaignId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let inflight = false
    let queued = false

    const run = () => {
      if (cancelled) return
      if (inflight) {
        queued = true
        return
      }
      inflight = true
      api
        .live(campaignId)
        .then((snap) => {
          if (!cancelled) cb.current(snap)
        })
        .catch(() => undefined)
        .finally(() => {
          inflight = false
          if (queued && !cancelled) {
            queued = false
            run()
          }
        })
    }

    const schedule = () => {
      if (cancelled) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(run, 40)
    }
    reloadRef.current = schedule

    if (usingSupabase && supabase) {
      const client = supabase
      const channel = client
        .channel(`campaign:${campaignId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'encounter_instances', filter: `campaign_id=eq.${campaignId}` }, schedule)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'live_sessions', filter: `campaign_id=eq.${campaignId}` }, schedule)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'player_characters', filter: `campaign_id=eq.${campaignId}` }, schedule)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'campaigns', filter: `id=eq.${campaignId}` }, schedule)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'combatants' }, schedule)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tokens_on_map' }, schedule)
        .subscribe()
      return () => {
        cancelled = true
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
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      ws.close()
    }
  }, [campaignId])

  return useCallback(() => {
    reloadRef.current()
  }, [])
}
