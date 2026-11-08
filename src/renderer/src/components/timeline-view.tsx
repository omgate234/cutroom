import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import {
  AudioLines,
  Captions,
  Crosshair,
  Film,
  ImageIcon,
  Trash2,
  Type,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { Kbd } from '@/components/ui/kbd'
import type { ProjectState } from '@shared/ipc'
import type { MediaItem, Timeline, TimelineClip } from '@shared/timeline'
import { timelineDuration } from '@shared/timeline'
import { frameAt, frameStyle, spriteCells } from '@/lib/sprite'
import { cn } from '@/lib/utils'
import { tc } from '@/lib/format'

const LABEL_W = 96
const ROW_H = 48
const RULER_H = 24

interface Props {
  project: ProjectState
  time: number
  onSeek: (t: number) => void
  selected: string | null
  onSelect: (id: string | null) => void
  onChange: (t: Timeline) => Promise<void>
  onMention: (text: string) => void
}

const TYPE: Record<string, { bg: string; icon: typeof Film }> = {
  video: { bg: 'bg-clip-video', icon: Film },
  image: { bg: 'bg-clip-image', icon: ImageIcon },
  audio: { bg: 'bg-clip-audio', icon: AudioLines },
  text: { bg: 'bg-clip-text', icon: Type },
  caption: { bg: 'bg-clip-caption', icon: Captions }
}

function trackKind(clips: TimelineClip[]): string {
  return clips[0]?.clip.asset.type ?? 'video'
}

function clipLabel(c: TimelineClip, media: Map<string, MediaItem>): string {
  const a = c.clip.asset
  if (a.type === 'text') return `“${a.text ?? ''}”`
  if (a.type === 'caption')
    return `Captions${a.animation ? ` · ${String(a.animation).replace('_', ' ')}` : ''}`
  return media.get(a.id ?? '')?.name ?? a.id ?? a.type
}

const removeClip = (t: Timeline, id: string): Timeline => ({
  ...t,
  tracks: t.tracks.map((tr) => ({ ...tr, clips: tr.clips.filter((c) => c.id !== id) }))
})

const moveClip = (t: Timeline, id: string, start: number): Timeline => ({
  ...t,
  tracks: t.tracks.map((tr) => ({
    ...tr,
    clips: tr.clips.map((c) => (c.id === id ? { ...c, start } : c))
  }))
})

// Deterministic pseudo-waveform so audio tiles read as audio before real peaks exist.
function Waveform({ seed, width }: { seed: string; width: number }): React.JSX.Element {
  const bars = Math.max(4, Math.floor(width / 4))
  let h = 0
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return (
    <div className="absolute inset-x-1 bottom-0.5 flex h-3 items-end gap-px opacity-35">
      {Array.from({ length: bars }, (_, i) => {
        h = (h * 1103515245 + 12345) >>> 0
        const v = 0.25 + ((h >>> 16) % 100) / 133
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

interface TileProps {
  c: TimelineClip
  m?: MediaItem
  zoom: number
  left: number
  label: string
  selected: boolean
  dragging: boolean
  view: { start: number; end: number }
  onPointerDown: (e: React.PointerEvent) => void
}

const ClipTile = memo(function ClipTile({
  c,
  m,
  zoom,
  left,
  label,
  selected,
  dragging,
  view,
  onPointerDown,
  ...rest
}: TileProps) {
  const width = Math.max(6, c.clip.duration * zoom - 1)
  const type = c.clip.asset.type
  const { bg, icon: Icon } = TYPE[type] ?? TYPE.video
  const h = ROW_H - 8
  const cells =
    type === 'video' && m?.sprite
      ? spriteCells(m.sprite, {
          width,
          height: h,
          pxPerSecond: zoom,
          sourceStart: c.clip.asset.start ?? 0,
          viewStart: view.start - left,
          viewEnd: view.end - left
        })
      : []

  return (
    <motion.div
      {...rest}
      initial={{ opacity: 0, scaleY: 0.6 }}
      animate={{ opacity: 1, scaleY: 1 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'group/clip absolute top-1 bottom-1 cursor-grab overflow-hidden rounded-md text-xs shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)] active:cursor-grabbing dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]',
        bg,
        !dragging && 'transition-[left,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
        dragging && 'z-30 shadow-lg',
        selected && 'ring-foreground ring-2 ring-offset-1 ring-offset-background'
      )}
      style={{ left, width }}
      onPointerDown={onPointerDown}
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
      {type === 'audio' && <Waveform seed={c.id} width={width} />}
      {cells.length > 0 && (
        <div className="absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-transparent" />
      )}
      <div className="relative flex h-full flex-col justify-start px-1.5 pt-1 leading-tight">
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
          {c.id} · {tc(c.clip.duration)}
        </span>
      </div>
    </motion.div>
  )
})

export function TimelineView({
  project,
  time,
  onSeek,
  selected,
  onSelect,
  onChange,
  onMention
}: Props): React.JSX.Element {
  const { timeline, assets } = project
  const [zoom, setZoom] = useState(40)
  const [drag, setDrag] = useState<{ id: string; x0: number; start0: number; dx: number } | null>(
    null
  )
  const [hover, setHover] = useState<number | null>(null)
  const [view, setView] = useState({ start: 0, end: 2000 })
  const areaRef = useRef<HTMLDivElement>(null)
  const media = useMemo(() => new Map(assets.media.map((m) => [m.id, m])), [assets])
  const duration = timelineDuration(timeline)
  const width = Math.max((duration + 12) * zoom, 800)

  // Track the scroll viewport so filmstrips only emit visible cells.
  useEffect(() => {
    const vp = areaRef.current?.closest('[data-radix-scroll-area-viewport]') as HTMLElement | null
    if (!vp) return
    let raf = 0
    const update = (): void => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() =>
        setView({ start: vp.scrollLeft - 200, end: vp.scrollLeft + vp.clientWidth + 200 })
      )
    }
    update()
    vp.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(vp)
    return () => {
      vp.removeEventListener('scroll', update)
      ro.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [])

  const selectedClip = useMemo(() => {
    for (const [ti, tr] of timeline.tracks.entries())
      for (const c of tr.clips)
        if (c.id === selected) return { c, track: tr.name ?? `Track ${ti + 1}` }
    return null
  }, [timeline, selected])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+'))
        setZoom((z) => Math.min(160, z * 1.25))
      if ((e.metaKey || e.ctrlKey) && e.key === '-') setZoom((z) => Math.max(6, z / 1.25))
      if (!selected) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        void onChange(removeClip(timeline, selected))
        onSelect(null)
      }
      if (e.key === 'Escape') onSelect(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, timeline, onChange, onSelect])

  const step = zoom >= 60 ? 1 : zoom >= 25 ? 2 : zoom >= 10 ? 5 : 10
  const ticks = Array.from({ length: Math.ceil(width / zoom / step) + 1 }, (_, i) => i * step)

  const timeAt = (clientX: number): number => {
    const rect = areaRef.current?.getBoundingClientRect()
    return rect ? Math.max(0, (clientX - rect.left) / zoom) : 0
  }

  // Frame under the cursor: the topmost visual clip covering t, in its source time.
  const preview = useMemo(() => {
    if (hover === null || drag) return null
    for (let i = timeline.tracks.length - 1; i >= 0; i--)
      for (const c of timeline.tracks[i].clips) {
        const a = c.clip.asset
        if (
          (a.type !== 'video' && a.type !== 'image') ||
          hover < c.start ||
          hover > c.start + c.clip.duration
        )
          continue
        const m = media.get(a.id ?? '')
        if (!m) continue
        const src = (a.start ?? 0) + (hover - c.start)
        const f = a.type === 'video' ? frameAt(m.sprite, src) : null
        return { m, f, src, c }
      }
    return null
  }, [hover, drag, timeline, media])

  const endDrag = (): void => {
    if (!drag) return
    const start = Math.max(0, Math.round((drag.start0 + drag.dx / zoom) * 20) / 20)
    setDrag(null)
    if (Math.abs(drag.dx) > 2) void onChange(moveClip(timeline, drag.id, start))
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-3 border-b px-3">
        <span className="text-sm font-medium">Timeline</span>
        <div className="text-muted-foreground flex min-w-0 items-center gap-2 text-xs">
          {selectedClip ? (
            <motion.div
              key={selectedClip.c.id}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex min-w-0 items-center gap-2"
            >
              <span className="text-foreground truncate font-mono">{selectedClip.c.id}</span>
              <span className="truncate">
                {selectedClip.track} · {tc(selectedClip.c.start)} →{' '}
                {tc(selectedClip.c.start + selectedClip.c.clip.duration)}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Delete clip"
                onClick={() => {
                  void onChange(removeClip(timeline, selectedClip.c.id))
                  onSelect(null)
                }}
              >
                <Trash2 />
              </Button>
            </motion.div>
          ) : (
            <span className="hidden truncate xl:inline">
              Drag to move · <Kbd>⌫</Kbd> delete · right-click to reference in chat
            </span>
          )}
        </div>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Zoom to fit"
          onClick={() => {
            const vp = areaRef.current?.closest(
              '[data-radix-scroll-area-viewport]'
            ) as HTMLElement | null
            if (vp && duration)
              setZoom(Math.min(160, Math.max(6, (vp.clientWidth - 40) / duration)))
          }}
        >
          <Crosshair />
        </Button>
        <ZoomOut className="text-muted-foreground size-3.5" />
        <Slider
          className="w-24"
          min={6}
          max={160}
          step={1}
          value={[zoom]}
          onValueChange={([v]) => setZoom(v)}
        />
        <ZoomIn className="text-muted-foreground size-3.5" />
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="bg-muted/20 shrink-0 border-r" style={{ width: LABEL_W }}>
          <div className="border-b" style={{ height: RULER_H }} />
          {timeline.tracks.map((tr, i) => {
            const { icon: Icon } = TYPE[trackKind(tr.clips)] ?? TYPE.video
            return (
              <div
                key={i}
                className="text-muted-foreground flex items-center gap-1.5 truncate border-b px-3 text-xs"
                style={{ height: ROW_H }}
              >
                <Icon className="size-3.5 shrink-0" />
                <span className="truncate">{tr.name ?? `Track ${i + 1}`}</span>
              </div>
            )
          })}
        </div>

        <ScrollArea className="min-w-0 flex-1">
          <div
            ref={areaRef}
            className="relative"
            style={{ width, minHeight: '100%' }}
            onPointerMove={(e) => {
              if (drag) setDrag({ ...drag, dx: e.clientX - drag.x0 })
              setHover(timeAt(e.clientX))
            }}
            onPointerUp={endDrag}
            onPointerLeave={() => {
              endDrag()
              setHover(null)
            }}
          >
            <div
              className="bg-background/95 sticky top-0 z-20 cursor-pointer border-b backdrop-blur"
              style={{ height: RULER_H }}
              onClick={(e) => onSeek(timeAt(e.clientX))}
            >
              {ticks.map((t) => (
                <div
                  key={t}
                  className="text-muted-foreground absolute top-0 h-full border-l pl-1 font-mono text-[10px] leading-6"
                  style={{ left: t * zoom }}
                >
                  {tc(t).replace(/\.\d$/, '')}
                </div>
              ))}
            </div>

            {timeline.tracks.map((tr, ti) => (
              <div
                key={ti}
                className="relative border-b"
                style={{ height: ROW_H }}
                onClick={(e) => {
                  if (e.target === e.currentTarget) {
                    onSelect(null)
                    onSeek(timeAt(e.clientX))
                  }
                }}
              >
                {tr.clips.map((c) => {
                  const dx = drag?.id === c.id ? drag.dx : 0
                  const label = clipLabel(c, media)
                  return (
                    <ContextMenu key={c.id}>
                      <ContextMenuTrigger asChild>
                        <ClipTile
                          c={c}
                          m={media.get(c.clip.asset.id ?? '')}
                          zoom={zoom}
                          left={Math.max(0, c.start * zoom + dx)}
                          label={label}
                          selected={selected === c.id}
                          dragging={drag?.id === c.id}
                          view={view}
                          onPointerDown={(e) => {
                            if (e.button !== 0) return
                            e.stopPropagation()
                            onSelect(c.id)
                            setDrag({ id: c.id, x0: e.clientX, start0: c.start, dx: 0 })
                          }}
                        />
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem
                          onSelect={() =>
                            onMention(
                              `clip ${c.id} (${label}, ${tc(c.start)}–${tc(c.start + c.clip.duration)} on ${tr.name ?? `track ${ti + 1}`})`
                            )
                          }
                        >
                          Reference in chat
                        </ContextMenuItem>
                        <ContextMenuItem onSelect={() => onSeek(c.start)}>
                          Jump to start
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          variant="destructive"
                          onSelect={() => void onChange(removeClip(timeline, c.id))}
                        >
                          <Trash2 /> Delete
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  )
                })}
              </div>
            ))}

            {timeline.tracks.length === 0 && (
              <p className="text-muted-foreground px-4 py-6 text-xs">
                No tracks yet. Ask the agent for a cut, or use “Add to timeline” on a media item.
              </p>
            )}

            {hover !== null && !drag && (
              <div
                className="bg-foreground/25 pointer-events-none absolute top-0 bottom-0 z-10 w-px"
                style={{ left: hover * zoom }}
              >
                <div
                  className="bg-popover text-popover-foreground absolute top-[26px] left-1/2 z-40 -translate-x-1/2 overflow-hidden rounded-md border shadow-md"
                  style={{ minWidth: 56 }}
                >
                  {preview?.f && preview.m.sprite && (
                    <div style={frameStyle(preview.m.sprite, preview.f, 64)} className="bg-muted" />
                  )}
                  <div className="px-1.5 py-0.5 text-center font-mono text-[10px] whitespace-nowrap tabular-nums">
                    {tc(hover)}
                  </div>
                </div>
              </div>
            )}

            <div
              className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-red-500"
              style={{ left: time * zoom }}
            >
              <span className="absolute -top-px left-1/2 size-2.5 -translate-x-1/2 rotate-45 rounded-[2px] bg-red-500" />
            </div>
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>
    </div>
  )
}
