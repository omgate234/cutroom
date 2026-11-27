import { memo } from 'react'
import { AudioLines, Captions, Film, ImageIcon, Type } from 'lucide-react'
import type { MediaItem, TimelineClip } from '@shared/timeline'
import { MAX_FADE_DURATION } from '@shared/timeline-ops'
import { spriteCells } from '@/lib/sprite'
import { cn } from '@/lib/utils'
import { tc } from '@/lib/format'

export const ROW_H = 52
export const EDGE_W = 7

export const TYPE: Record<string, { bg: string; icon: typeof Film }> = {
  video: { bg: 'bg-clip-video', icon: Film },
  image: { bg: 'bg-clip-image', icon: ImageIcon },
  audio: { bg: 'bg-clip-audio', icon: AudioLines },
  text: { bg: 'bg-clip-text', icon: Type },
  caption: { bg: 'bg-clip-caption', icon: Captions }
}

export type Grip = 'body' | 'trim-left' | 'trim-right' | 'fade-in' | 'fade-out'

// Deterministic pseudo-waveform so audio tiles read as audio before real peaks exist.
function Waveform({ seed, width }: { seed: string; width: number }): React.JSX.Element {
  const bars = Math.max(4, Math.floor(width / 4))
  let h = 0
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const heights: number[] = []
  for (let i = 0; i < bars; i++) {
    h = (h * 1103515245 + 12345) >>> 0
    heights.push(0.25 + ((h >>> 16) % 100) / 133)
  }
  return (
    <div className="absolute inset-x-1 bottom-0.5 flex h-3 items-end gap-px opacity-35">
      {heights.map((v, i) => {
        return (
          <span
            key={i}
            className="bg-clip-fg w-[3px] shrink-0 rounded-full"
            style={{ height: `${v * 100}%` }}
          />
        )
      })}
    </div>
  )
}

type Props = {
  c: TimelineClip
  m?: MediaItem
  zoom: number
  left: number
  width: number
  // Source in-point to draw the filmstrip from (differs from the clip's during a left trim).
  sourceStart: number
  label: string
  selected: boolean
  active: boolean
  dimmed?: boolean
  invalid?: boolean
  fade: { in: number; out: number }
  view: { start: number; end: number }
  onGrip: (e: React.PointerEvent, grip: Grip) => void
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'onPointerDown'>

export const ClipTile = memo(function ClipTile({
  c,
  m,
  zoom,
  left,
  width,
  sourceStart,
  label,
  selected,
  active,
  dimmed,
  invalid,
  fade,
  view,
  onGrip,
  ...rest
}: Props) {
  const type = c.clip.asset.type
  const { bg, icon: Icon } = TYPE[type] ?? TYPE.video
  const w = Math.max(6, width - 1)
  const h = ROW_H - 8
  const cells =
    type === 'video' && m?.sprite
      ? spriteCells(m.sprite, {
          width: w,
          height: h,
          pxPerSecond: zoom,
          sourceStart,
          viewStart: view.start - left,
          viewEnd: view.end - left
        })
      : []
  const canFade = type !== 'caption' && w > 36
  const fadeMax = Math.min(MAX_FADE_DURATION, c.clip.duration) * zoom
  const fi = Math.min(fade.in * zoom, fadeMax)
  const fo = Math.min(fade.out * zoom, fadeMax)
  const grip = (g: Grip) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    onGrip(e, g)
  }

  return (
    <div
      {...rest}
      data-clip={c.id}
      className={cn(
        'group/clip absolute top-1 bottom-1 cursor-grab overflow-hidden rounded-md text-xs shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)] select-none dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]',
        bg,
        active && 'z-30 cursor-grabbing shadow-lg',
        dimmed && 'opacity-35',
        invalid && 'ring-destructive ring-2',
        selected && !invalid && 'ring-foreground ring-offset-background ring-2 ring-offset-1'
      )}
      style={{ left, width: w }}
      onPointerDown={grip('body')}
    >
      {cells.length > 0 ? (
        <div className="absolute inset-0 opacity-70 transition-opacity group-hover/clip:opacity-85">
          {cells.map((cell) => (
            <div
              key={cell.key}
              className="absolute top-0"
              style={{ ...cell.style, left: cell.left }}
            />
          ))}
        </div>
      ) : (
        m?.thumbnail &&
        (type === 'video' || type === 'image') && (
          <div
            className="absolute inset-0 opacity-50"
            style={{
              backgroundImage: `url("${m.thumbnail}")`,
              backgroundSize: 'auto 100%',
              backgroundRepeat: 'repeat-x'
            }}
          />
        )
      )}
      {type === 'audio' && <Waveform seed={c.id} width={w} />}
      {cells.length > 0 && (
        <div className="absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-transparent" />
      )}

      {/* Fade ramps: the shaded wedge is the fade length. */}
      {fi > 0 && (
        <div
          className="pointer-events-none absolute inset-y-0 left-0 bg-black/25"
          style={{ width: fi, clipPath: 'polygon(0 0, 0 100%, 100% 0)' }}
        />
      )}
      {fo > 0 && (
        <div
          className="pointer-events-none absolute inset-y-0 right-0 bg-black/25"
          style={{ width: fo, clipPath: 'polygon(0 0, 100% 100%, 100% 0)' }}
        />
      )}

      <div className="pointer-events-none relative flex h-full flex-col justify-start px-2 pt-3 leading-tight">
        <span
          className={cn(
            'flex items-center gap-1 truncate font-medium',
            cells.length ? 'text-white drop-shadow-sm' : 'text-clip-fg'
          )}
        >
          <Icon className="size-3 shrink-0 opacity-80" />
          <span className="truncate">{label}</span>
        </span>
        <span
          className={cn(
            'truncate font-mono text-[10px]',
            cells.length ? 'text-white/70' : 'text-clip-fg/60'
          )}
        >
          {tc(c.clip.duration)}
        </span>
      </div>

      {/* Trim edges */}
      <span
        className="absolute inset-y-0 left-0 z-10 cursor-ew-resize rounded-l-md hover:bg-black/20 dark:hover:bg-white/25"
        style={{ width: EDGE_W }}
        onPointerDown={grip('trim-left')}
      />
      <span
        className="absolute inset-y-0 right-0 z-10 cursor-ew-resize rounded-r-md hover:bg-black/20 dark:hover:bg-white/25"
        style={{ width: EDGE_W }}
        onPointerDown={grip('trim-right')}
      />

      {/* Fade knobs: drag along the top edge to set the fade length. */}
      {canFade && (
        <>
          <span
            title={`Fade in ${fade.in ? `${fade.in.toFixed(1)}s` : 'off'}`}
            className={cn(
              'absolute top-0.5 z-20 size-2.5 -translate-x-1/2 cursor-col-resize rounded-full border border-black/40 bg-white shadow-sm transition-opacity',
              fi > 0 || selected ? 'opacity-100' : 'opacity-0 group-hover/clip:opacity-100'
            )}
            style={{ left: Math.max(EDGE_W + 4, fi) }}
            onPointerDown={grip('fade-in')}
          />
          <span
            title={`Fade out ${fade.out ? `${fade.out.toFixed(1)}s` : 'off'}`}
            className={cn(
              'absolute top-0.5 z-20 size-2.5 translate-x-1/2 cursor-col-resize rounded-full border border-black/40 bg-white shadow-sm transition-opacity',
              fo > 0 || selected ? 'opacity-100' : 'opacity-0 group-hover/clip:opacity-100'
            )}
            style={{ right: Math.max(EDGE_W + 4, fo) }}
            onPointerDown={grip('fade-out')}
          />
        </>
      )}
    </div>
  )
})
