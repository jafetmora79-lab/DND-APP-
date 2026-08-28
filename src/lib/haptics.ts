const NOTIF_PERM_KEY = 'dlt-notif-perm'

export type HapticKind = 'turn' | 'hit' | 'miss' | 'death' | 'success' | 'tap'

export function haptic(kind: HapticKind = 'tap') {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
  switch (kind) {
    case 'turn':
      navigator.vibrate([80, 40, 80, 40, 120])
      break
    case 'hit':
      navigator.vibrate([40, 20, 80])
      break
    case 'miss':
      navigator.vibrate(30)
      break
    case 'death':
      navigator.vibrate([150, 50, 150, 50, 200])
      break
    case 'success':
      navigator.vibrate([30, 30, 60])
      break
    case 'tap':
    default:
      navigator.vibrate(15)
  }
}

export function supportsNotifications(): boolean {
  return typeof Notification !== 'undefined'
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!supportsNotifications()) return 'denied'
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission
  }
  const result = await Notification.requestPermission()
  try {
    localStorage.setItem(NOTIF_PERM_KEY, result)
  } catch {
    /* ignore */
  }
  return result
}

export function notificationPermissionAskedBefore(): boolean {
  try {
    if (supportsNotifications() && Notification.permission !== 'default') return true
    return localStorage.getItem(NOTIF_PERM_KEY) !== null
  } catch {
    return false
  }
}

let lastNotifTag = ''
let lastNotifAt = 0

export function notifyTurn(characterName: string, campaignName: string) {
  if (!supportsNotifications() || Notification.permission !== 'granted') return
  const tag = `turn-${characterName}-${Date.now()}`
  const now = Date.now()
  if (tag === lastNotifTag || now - lastNotifAt < 2000) return
  lastNotifTag = tag
  lastNotifAt = now
  try {
    new Notification(`${characterName} — it's your turn!`, {
      body: `${campaignName}`,
      tag,
      silent: false,
    })
  } catch {
    /* ignore */
  }
}
