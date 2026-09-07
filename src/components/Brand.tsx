import { cn } from '@/lib/utils'

/** Small persistent wordmark for headers outside the landing screen. */
export function Brand({ className }: { className?: string }) {
  return <span className={cn('shrink-0 font-display text-[11px] font-bold uppercase tracking-[0.25em] text-gold/80', className)}>Veyra</span>
}
