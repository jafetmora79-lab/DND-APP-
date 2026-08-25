import { useEffect, useRef } from 'react'
import { getToken } from './api'
import type { EncounterSnapshot } from './types'

export function useLive(campaignId: string | undefined, onSnap: (s: EncounterSnapshot) => void) {
  const cb = useRef(onSnap)
  cb.current = onSnap

  useEffect(() => {
    if (!campaignId) return
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
