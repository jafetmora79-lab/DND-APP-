import { useState } from 'react'
import { publicAsset } from '@/lib/config'
import { cn } from '@/lib/utils'

type Props = {
  imageUrl: string | null
  caption: string
  className?: string
}

export function AmbianceStage({ imageUrl, caption, className }: Props) {
  const fallback = publicAsset('tavern-hearth.jpg')
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const src = imageUrl && failedUrl !== imageUrl ? imageUrl : fallback

  return (
    <figure className={cn('relative overflow-hidden bg-hud', className)}>
      <img
        src={src}
        alt={caption || 'Campaign scene'}
        className="h-full w-full object-cover"
        onError={() => {
          if (imageUrl) setFailedUrl(imageUrl)
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-bg/80 via-transparent to-bg/25" />
      {caption ? (
        <figcaption className="pointer-events-none absolute bottom-0 left-0 right-0 p-4 pr-4 pt-8 font-display text-lg text-gold-2 md:text-2xl">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  )
}
