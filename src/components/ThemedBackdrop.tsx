import { useEffect, useState } from 'react'
import { publicAsset } from '@/lib/config'
import { PALETTE_BACKGROUND, useTheme } from '@/lib/theme'
import { ThemeParticles } from '@/components/ThemeParticles'

/** Fixed, full-viewport hero image behind pages that don't paint their own opaque background. */
export function ThemedBackdrop() {
  const { palette } = useTheme()
  const [bgFailed, setBgFailed] = useState(false)

  useEffect(() => {
    setBgFailed(false)
  }, [palette])

  const themedBg = publicAsset(PALETTE_BACKGROUND[palette])

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-bg" aria-hidden="true">
      <img
        key={palette}
        src={bgFailed ? publicAsset('tavern-hearth.jpg') : themedBg}
        alt=""
        className="h-full w-full object-cover opacity-40"
        onError={() => setBgFailed(true)}
      />
      <div className="absolute inset-0 bg-[#0c0a07]/70" />
      <ThemeParticles />
    </div>
  )
}
