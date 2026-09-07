import { useEffect, useState } from 'react'
import { publicAsset } from '@/lib/config'
import { MOBILE_BACKGROUND_QUERY, PALETTE_BACKGROUND, PALETTE_BACKGROUND_PORTRAIT, useTheme } from '@/lib/theme'
import { ThemeParticles } from '@/components/ThemeParticles'

/** Fixed, full-viewport hero image behind pages that don't paint their own opaque background. */
export function ThemedBackdrop() {
  const { palette } = useTheme()
  const [bgFailed, setBgFailed] = useState(false)

  useEffect(() => {
    setBgFailed(false)
  }, [palette])

  const themedBg = publicAsset(PALETTE_BACKGROUND[palette])
  const themedBgPortrait = publicAsset(PALETTE_BACKGROUND_PORTRAIT[palette])

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-bg" aria-hidden="true">
      <picture key={palette}>
        {!bgFailed && <source media={MOBILE_BACKGROUND_QUERY} srcSet={themedBgPortrait} />}
        <img
          src={bgFailed ? publicAsset('tavern-hearth.jpg') : themedBg}
          alt=""
          className="h-full w-full object-cover opacity-40"
          onError={() => setBgFailed(true)}
        />
      </picture>
      <div className="absolute inset-0 bg-[#0c0a07]/70" />
      <ThemeParticles />
    </div>
  )
}
