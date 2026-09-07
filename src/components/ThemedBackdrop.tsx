import { useEffect, useState } from 'react'
import { publicAsset } from '@/lib/config'
import { PALETTE_BACKGROUND, useTheme } from '@/lib/theme'

/** Fixed, full-viewport hero image behind pages that don't paint their own opaque background. */
export function ThemedBackdrop() {
  const { palette } = useTheme()
  const [bgFailed, setBgFailed] = useState(false)

  useEffect(() => {
    setBgFailed(false)
  }, [palette])

  const themedBg = publicAsset(PALETTE_BACKGROUND[palette])

  const src = bgFailed ? publicAsset('tavern-hearth.jpg') : themedBg

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-bg" aria-hidden="true">
      {/* Oversized + blurred fill so the low-res source has no hard edges to show through. */}
      <img
        key={`${palette}-fill`}
        src={src}
        alt=""
        className="h-full w-full scale-110 object-cover opacity-50 blur-2xl"
      />
      {/* Sharper foreground copy, zoomed out (contain) so it isn't stretched as far.
          The GIFs are 21:9, much wider than most viewports, so contain leaves a visible
          top/bottom band; a soft mask fade blends that edge into the blurred fill instead
          of showing a hard seam. */}
      <img
        key={palette}
        src={src}
        alt=""
        className="absolute inset-0 h-full w-full object-contain opacity-70"
        style={{
          maskImage: 'linear-gradient(to bottom, transparent, black 20%, black 80%, transparent)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 20%, black 80%, transparent)',
        }}
        onError={() => setBgFailed(true)}
      />
      <div className="absolute inset-0 bg-bg/45" />
    </div>
  )
}
