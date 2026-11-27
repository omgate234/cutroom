import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowDown,
  ArrowUp,
  Captions,
  ClipboardPaste,
  Copy,
  Crosshair,
  Crop,
  MoreVertical,
  Pencil,
  Plus,
  Scissors,
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
  ContextMenuShortcut,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Kbd } from '@/components/ui/kbd'
import type { MediaItem, Timeline, TimelineClip } from '@shared/timeline'
import { timelineDuration } from '@shared/timeline'
import * as ops from '@shared/timeline-ops'
import type { Editor } from '@/hooks/use-editor'
import { ClipTile, ROW_H, TYPE, type Grip } from '@/components/timeline/clip-tile'
import { frameAt, type Frame } from '@/lib/sprite'
import { MEDIA_MIME, mediaDrag } from '@/lib/drag'
import { cn } from '@/lib/utils'
import { kbd, tc } from '@/lib/format'
import type { SpriteManifest } from '@shared/timeline'

const LABEL_W = 112
const RULER_H = 24
const PHANTOM_H = 30
const MOVE_THRESHOLD = 3

export interface Scrub {
  time: number
  sprite?: SpriteManifest
  frame?: Frame | null
}

interface Props {
  editor: Editor
  media: MediaItem[]
  time: number
  onSeek: (t: number) => void
  onScrub: (s: Scrub | null) => void
  onMention: (text: string) => void
}

type Row =
  | { kind: 'track'; index: number; top: number; h: number }
  | { kind: 'phantom'; top: number; h: number }

type Session =
  | {
      kind: 'move'
      ids: string[]
      primary: string
      x0: number
      y0: number
      dx: number
      y: number
      started: boolean
      free: boolean
    }
  | { kind: 'trim-left' | 'trim-right'; id: string; x0: number; dx: number; free: boolean }
  | { kind: 'fade-in' | 'fade-out'; id: string; x0: number; dx: number }
  | { kind: 'insert'; media: MediaItem; time: number; y: number }

function clipLabel(c: TimelineClip, media: Map<string, MediaItem>): string {
  const a = c.clip.asset
  if (a.type === 'text') return `“${a.text ?? ''}”`
  if (a.type === 'caption')
    return `Captions${a.animation ? ` · ${String(a.animation).replace('_', ' ')}` : ''}`
  return media.get(a.id ?? '')?.name ?? a.id ?? a.type
}

const trackKind = (clips: TimelineClip[]): string => clips[0]?.clip.asset.type ?? 'video'

export function TimelineView({
  editor,
  media: mediaList,
  time,
  onSeek,
  onScrub,
  onMention
}: Props): React.JSX.Element {
  const { timeline, lengths, selected, commit } = editor
  const [zoom, setZoom] = useState(40)
  const [session, setSession] = useState<Session | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [renaming, setRenaming] = useState<number | null>(null)
  const [view, setView] = useState({ start: 0, end: 2000 })
  const areaRef = useRef<HTMLDivElement>(null)
  const media = useMemo(() => new Map(mediaList.map((m) => [m.id, m])), [mediaList])
  const duration = timelineDuration(timeline)
  const width = Math.max((duration + 12) * zoom, 800)
  const n = timeline.tracks.length
  const ci = ops.captionTrackIndex(timeline)

  // Display order: top layer first (the caption lane), then a drop row for a new track, then the
  // rest from the top layer down to track 0.
  const rows = useMemo(() => {
    const out: Row[] = []
    let top = RULER_H
    const push = (
      r: { kind: 'track'; index: number; h: number } | { kind: 'phantom'; h: number }
    ): void => {
      out.push({ ...r, top } as Row)
      top += r.h
    }
    if (ci >= 0) push({ kind: 'track', index: ci, h: ROW_H })
    push({ kind: 'phantom', h: PHANTOM_H })
    for (let i = n - 1; i >= 0; i--) if (i !== ci) push({ kind: 'track', index: i, h: ROW_H })
    return out
  }, [n, ci])
  const lanesH = rows.reduce((m, r) => Math.max(m, r.top + r.h), RULER_H)

  const viewport = (): HTMLElement | null =>
    areaRef.current?.closest('[data-radix-scroll-area-viewport]') as HTMLElement | null

  // Track the scroll viewport so filmstrips only emit visible cells.
  useEffect(() => {
    const vp = viewport()
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

  const pointAt = (clientX: number, clientY: number): { t: number; y: number } => {
    const r = areaRef.current?.getBoundingClientRect()
    return r ? { t: Math.max(0, (clientX - r.left) / zoom), y: clientY - r.top } : { t: 0, y: 0 }
  }
  const rowAt = useCallback(
    (y: number): Row | null => rows.find((r) => y >= r.top && y < r.top + r.h) ?? null,
    [rows]
  )

  // ─── drag resolution (pure from session; the commit uses the same result) ────
  const drag = useMemo(() => {
    if (!session) return null
    if (session.kind === 'insert') {
      const c = ops.clipFromMedia(timeline, session.media, session.time)
      const row = rowAt(session.y)
      if (!row)
        return {
          kind: 'insert' as const,
          c,
          valid: false,
          row: null,
          start: c.start,
          moved: new Map<string, number>()
        }
      if (row.kind === 'phantom')
        return {
          kind: 'insert' as const,
          c,
          valid: true,
          row,
          start: c.start,
          moved: new Map<string, number>()
        }
      const tr = timeline.tracks[row.index]
      if (!ops.canPlace(tr, c))
        return {
          kind: 'insert' as const,
          c,
          valid: false,
          row,
          start: c.start,
          moved: new Map<string, number>()
        }
      const r = ops.resolveRipple(tr, { start: c.start, duration: c.clip.duration })
      return { kind: 'insert' as const, c, valid: true, row, start: r.start, moved: r.moved }
    }
    if (session.kind === 'move') {
      if (!session.started) return null
      const p = ops.findClip(timeline, session.primary)
      if (!p) return null
      const exclude = new Set(session.ids)
      const raw = p.clip.start + session.dx / zoom
      let start = Math.max(0, raw)
      let snapAt: number | null = null
      if (!session.free) {
        const targets = ops.snapTargets(timeline, exclude, [time])
        // Snap whichever edge lands closer to a target.
        const len = ops.dur(p.clip)
        const a = ops.snap(start, targets, zoom)
        const b = ops.snap(start + len, targets, zoom)
        const da = a.at === null ? Infinity : Math.abs(a.value - start)
        const db = b.at === null ? Infinity : Math.abs(b.value - start - len)
        if (da <= db && a.at !== null) {
          start = a.value
          snapAt = a.at
        } else if (b.at !== null) {
          start = Math.max(0, b.value - len)
          snapAt = b.at
        }
      }
      const dt = start - p.clip.start
      const row = rowAt(session.y)
      if (session.ids.length === 1) {
        const c = p.clip
        if (!row)
          return {
            kind: 'move' as const,
            valid: false,
            snapAt,
            ghosts: [{ c, trackIndex: p.trackIndex, start, row: null as Row | null }],
            moved: new Map<string, number>()
          }
        if (row.kind === 'phantom')
          return {
            kind: 'move' as const,
            valid: !ops.isCaption(c),
            snapAt,
            ghosts: [{ c, trackIndex: -1, start, row }],
            moved: new Map<string, number>()
          }
        const tr = timeline.tracks[row.index]
        const sameLane = row.index === p.trackIndex
        const others = { ...tr, clips: tr.clips.filter((x) => x.id !== c.id) }
        if (ops.isCaption(c)) {
          const valid = sameLane && !ops.wouldOverlap(tr, { start, duration: ops.dur(c) }, c.id)
          return {
            kind: 'move' as const,
            valid,
            snapAt,
            ghosts: [{ c, trackIndex: row.index, start, row }],
            moved: new Map<string, number>()
          }
        }
        if (!ops.canPlace(others, c))
          return {
            kind: 'move' as const,
            valid: false,
            snapAt,
            ghosts: [{ c, trackIndex: row.index, start, row }],
            moved: new Map<string, number>()
          }
        const r = ops.resolveRipple(tr, { start, duration: ops.dur(c) }, c.id)
        return {
          kind: 'move' as const,
          valid: true,
          snapAt,
          rawStart: start,
          ghosts: [{ c, trackIndex: row.index, start: r.start, row }],
          moved: r.moved
        }
      }
      // Group: one shared track + time delta, only into free space.
      const dTrack = row?.kind === 'track' ? row.index - p.trackIndex : 0
      const locs = session.ids
        .map((id) => ops.findClip(timeline, id))
        .filter((l): l is ops.Loc => !!l)
      const moves = locs.map((l) => ({
        id: l.clip.id,
        clip: l.clip,
        trackIndex: l.trackIndex + dTrack,
        start: l.clip.start + dt,
        duration: ops.dur(l.clip)
      }))
      const valid =
        moves.every((m) => m.trackIndex >= 0 && m.trackIndex < n && m.trackIndex !== ci) &&
        ops.groupMoveValid(timeline, moves)
      return {
        kind: 'move' as const,
        valid,
        snapAt,
        moves,
        ghosts: moves.map((m) => ({
          c: m.clip,
          trackIndex: m.trackIndex,
          start: m.start,
          row: (rows.find((r) => r.kind === 'track' && r.index === m.trackIndex) ??
            null) as Row | null
        })),
        moved: new Map<string, number>()
      }
    }
    const loc = ops.findClip(timeline, session.id)
    if (!loc) return null
    const tr = timeline.tracks[loc.trackIndex]
    const c = loc.clip
    if (session.kind === 'trim-left' || session.kind === 'trim-right') {
      const left = session.kind === 'trim-left'
      let edge = (left ? c.start : ops.clipEnd(c)) + session.dx / zoom
      let snapAt: number | null = null
      if (!session.free) {
        const s = ops.snap(edge, ops.snapTargets(timeline, new Set([c.id]), [time]), zoom)
        edge = s.value
        snapAt = s.at
      }
      if (left) {
        const p = ops.previewTrimStart(tr, c, edge)
        return {
          kind: 'trim' as const,
          id: c.id,
          edge,
          snapAt,
          start: p.start,
          duration: p.duration,
          assetStart: p.assetStart ?? c.clip.asset.start ?? 0
        }
      }
      const p = ops.previewTrimEnd(tr, c, edge, lengths)
      return {
        kind: 'trim' as const,
        id: c.id,
        edge,
        snapAt,
        start: c.start,
        duration: p.duration,
        assetStart: c.clip.asset.start ?? 0
      }
    }
    const f = ops.fadeOf(c)
    const base = session.kind === 'fade-in' ? f.in : f.out
    const delta = (session.kind === 'fade-in' ? session.dx : -session.dx) / zoom
    const secs = Math.max(0, Math.min(base + delta, ops.dur(c), ops.MAX_FADE_DURATION))
    const v = Math.round(secs * 10) / 10
    return {
      kind: 'fade' as const,
      id: c.id,
      side: session.kind === 'fade-in' ? ('in' as const) : ('out' as const),
      seconds: v
    }
  }, [session, timeline, zoom, time, rows, rowAt, n, ci, lengths])

  const commitDrag = (): void => {
    const s = session
    const d = drag
    setSession(null)
    if (!s || !d) {
      // A press without movement is a click: inside a multi-selection it selects just that clip.
      if (s?.kind === 'move' && !s.started && s.ids.length > 1) editor.select(s.primary)
      return
    }
    if (d.kind === 'insert') {
      if (!d.valid || !d.row) return
      let base = timeline
      let ti: number
      if (d.row.kind === 'phantom') {
        ti = ci >= 0 ? ci : n
        base = ops.addTrack(base, d.c.clip.asset.type === 'audio' ? 'music' : 'track', ti)
      } else ti = d.row.index
      const clip = { ...d.c, start: d.row.kind === 'phantom' ? d.c.start : d.c.start }
      commit(ops.addClipRippling(base, ti, clip))
      editor.select(clip.id)
      return
    }
    if (d.kind === 'move') {
      if (!d.valid) return
      if ('moves' in d && d.moves) {
        commit(ops.moveClipsGroup(timeline, d.moves))
        return
      }
      const g = d.ghosts[0]
      if (!g.row) return
      if (g.row.kind === 'phantom') {
        const at = ci >= 0 ? ci : n
        const base = ops.addTrack(timeline, 'track', at)
        // Indices at and above `at` shifted up by one.
        commit(ops.moveClip(base, g.c.id, at, g.start))
        return
      }
      const move = ops.isCaption(g.c) ? ops.moveClip : ops.moveClipRippling
      commit(
        move(
          timeline,
          g.c.id,
          g.trackIndex,
          'rawStart' in d && d.rawStart !== undefined ? d.rawStart : g.start
        )
      )
      return
    }
    if (d.kind === 'trim') {
      commit(
        s.kind === 'trim-left'
          ? ops.trimStart(timeline, d.id, d.edge)
          : ops.trimEnd(timeline, d.id, d.edge, lengths)
      )
      return
    }
    if (d.kind === 'fade') commit(ops.setFade(timeline, d.id, d.side, d.seconds))
  }

  // ─── pointer input ───────────────────────────────────────────────────────────
  const onGrip = (c: TimelineClip, e: React.PointerEvent, grip: Grip): void => {
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const multi = e.metaKey || e.ctrlKey
    if (grip === 'body') {
      if (e.shiftKey) return editor.select(c.id, 'range')
      if (multi) return editor.select(c.id, 'toggle')
      // Dragging a clip that is part of the selection moves the whole selection.
      const ids = selected.has(c.id) && selected.size > 1 ? [...selected] : [c.id]
      if (!selected.has(c.id) || selected.size === 1) editor.select(c.id)
      const { y } = pointAt(e.clientX, e.clientY)
      setSession({
        kind: 'move',
        ids,
        primary: c.id,
        x0: e.clientX,
        y0: e.clientY,
        dx: 0,
        y,
        started: false,
        free: e.altKey
      })
      return
    }
    editor.select(c.id)
    if (grip === 'trim-left' || grip === 'trim-right')
      setSession({ kind: grip, id: c.id, x0: e.clientX, dx: 0, free: e.altKey })
    else setSession({ kind: grip, id: c.id, x0: e.clientX, dx: 0 })
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    if (!session || session.kind === 'insert') return
    const dx = e.clientX - session.x0
    if (session.kind === 'move') {
      const started = session.started || Math.hypot(dx, e.clientY - session.y0) > MOVE_THRESHOLD
      const { y } = pointAt(e.clientX, e.clientY)
      setSession({ ...session, dx, y, started, free: e.altKey })
    } else if (session.kind === 'trim-left' || session.kind === 'trim-right')
      setSession({ ...session, dx, free: e.altKey })
    else setSession({ ...session, dx })
    autoScroll(e.clientX)
  }

  const autoScroll = (clientX: number): void => {
    const vp = viewport()
    if (!vp) return
    const r = vp.getBoundingClientRect()
    if (clientX > r.right - 30) vp.scrollLeft += 12
    else if (clientX < r.left + 30) vp.scrollLeft -= 12
  }

  // ─── actions ─────────────────────────────────────────────────────────────────
  const removeSelected = useCallback((): void => {
    if (!selected.size) return
    commit(ops.removeClips(timeline, selected))
    editor.select(null)
  }, [selected, timeline, commit, editor])

  const split = useCallback((): void => {
    let t = timeline
    const right: string[] = []
    for (const id of selected) {
      const r = ops.splitClip(t, id, time)
      if (r.rightId) {
        t = r.timeline
        right.push(r.rightId)
      }
    }
    if (!right.length) {
      toast('Put the playhead inside a selected clip to split it.')
      return
    }
    commit(t)
  }, [selected, timeline, time, commit])

  const nudge = useCallback(
    (dt: number): void => {
      const locs = [...selected]
        .map((id) => ops.findClip(timeline, id))
        .filter((l): l is ops.Loc => !!l)
      if (!locs.length) return
      const moves = locs.map((l) => ({
        id: l.clip.id,
        clip: l.clip,
        trackIndex: l.trackIndex,
        start: Math.round((l.clip.start + dt) * 1000) / 1000,
        duration: ops.dur(l.clip)
      }))
      if (moves.some((m) => m.start < 0) || !ops.groupMoveValid(timeline, moves)) return
      commit(ops.moveClipsGroup(timeline, moves), 'nudge')
    },
    [selected, timeline, commit]
  )

  const copy = useCallback((): void => {
    const clips = [...selected]
      .map((id) => ops.findClip(timeline, id)?.clip)
      .filter((c): c is TimelineClip => !!c)
    if (clips.length) editor.setClipboard(clips)
  }, [selected, timeline, editor])

  const paste = useCallback((): void => {
    const src = editor.getClipboard()
    if (!src.length) return
    const first = Math.min(...src.map((c) => c.start))
    let t = timeline
    const ids: string[] = []
    for (const c0 of src) {
      const c = { ...structuredClone(c0), id: ops.uid(t) }
      const want = time + (c0.start - first)
      if (ops.isCaption(c)) {
        const i = ops.captionTrackIndex(t)
        c.start = ops.findFreeStart(i >= 0 ? t.tracks[i] : { clips: [] }, want, ops.dur(c))
        t = ops.addCaption(t, c)
      } else {
        // Prefer the lane the copy came from (by the selected clip), else any lane with room.
        const sel = editor.primary ? ops.findClip(t, editor.primary) : null
        const lane = sel && ops.canPlace(t.tracks[sel.trackIndex], c) ? sel.trackIndex : -1
        if (lane >= 0 && !ops.wouldOverlap(t.tracks[lane], { start: want, duration: ops.dur(c) })) {
          c.start = want
          t = ops.addClip(t, lane, c)
        } else {
          c.start = want
          t = ops.placeOnFreeTrack(t, c)
        }
      }
      ids.push(c.id)
    }
    commit(t)
    editor.setSelection(ids)
  }, [editor, timeline, time, commit])

  const duplicate = useCallback((): void => {
    copy()
    const src = editor.getClipboard()
    if (!src.length) return
    const end = Math.max(...src.map(ops.clipEnd))
    let t = timeline
    const ids: string[] = []
    const first = Math.min(...src.map((c) => c.start))
    for (const c0 of src) {
      const loc = ops.findClip(t, c0.id)
      const c = { ...structuredClone(c0), id: ops.uid(t), start: end + (c0.start - first) }
      if (
        loc &&
        !ops.wouldOverlap(t.tracks[loc.trackIndex], { start: c.start, duration: ops.dur(c) })
      )
        t = ops.addClip(t, loc.trackIndex, c)
      else t = ops.isCaption(c) ? ops.addCaption(t, c) : ops.placeOnFreeTrack(t, c)
      ids.push(c.id)
    }
    commit(t)
    editor.setSelection(ids)
  }, [copy, editor, timeline, commit])

  const addText = (): void => {
    const c = ops.textClip(timeline, time)
    commit(ops.placeOnFreeTrack(timeline, c, 'titles'))
    editor.select(c.id)
  }

  const hasMedia = timeline.tracks.some((tr) =>
    tr.clips.some((c) => c.clip.asset.type === 'video' || c.clip.asset.type === 'audio')
  )
  const addCaptions = (): void => {
    const slot = ops.nextCaptionSlot(timeline, time, duration)
    const c = ops.captionClip(timeline, slot.start, slot.duration)
    commit(ops.addCaption(timeline, c))
    editor.select(c.id)
    onSeek(c.start)
  }

  const canSplitNow = [...selected].some((id) =>
    ops.canSplit(ops.findClip(timeline, id)?.clip, time)
  )

  // ─── keyboard ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement
      if (
        el?.tagName === 'INPUT' ||
        el?.tagName === 'TEXTAREA' ||
        el?.tagName === 'SELECT' ||
        el?.isContentEditable
      )
        return
      const mod = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()
      if (mod && (k === '=' || k === '+')) return setZoom((z) => Math.min(200, z * 1.25))
      if (mod && k === '-') return setZoom((z) => Math.max(4, z / 1.25))
      if (mod && k === 'z') {
        e.preventDefault()
        return e.shiftKey ? editor.redo() : editor.undo()
      }
      if (mod && k === 'y') {
        e.preventDefault()
        return editor.redo()
      }
      if (mod && k === 'a') {
        e.preventDefault()
        return editor.setSelection(
          timeline.tracks.flatMap((tr) =>
            tr.clips.filter((c) => !ops.isCaption(c)).map((c) => c.id)
          )
        )
      }
      if (mod && k === 'c') return copy()
      if (mod && k === 'v') {
        e.preventDefault()
        return paste()
      }
      if (mod && k === 'd') {
        e.preventDefault()
        return duplicate()
      }
      if (e.key === 'Escape') {
        if (session) setSession(null)
        else editor.select(null)
        return
      }
      if (mod || e.altKey) return
      if (k === 's') return split()
      if (!selected.size) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        removeSelected()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        nudge(e.shiftKey ? -1 : -0.1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        nudge(e.shiftKey ? 1 : 0.1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editor, timeline, selected, session, copy, paste, duplicate, split, removeSelected, nudge])

  // ─── canvas ──────────────────────────────────────────────────────────────────
  const canvas = ops.canvasOf(timeline.resolution ?? '1920x1080')
  const hasText = timeline.tracks.some((tr) =>
    tr.clips.some((c) => c.clip.asset.type === 'text' || ops.isCaption(c))
  )
  const setResolution = (res: string | null): void => {
    if (!res || res === timeline.resolution) return
    const from = timeline.resolution ?? '1920x1080'
    const next = { ...timeline, resolution: res }
    commit(next)
    const k = ops.pixelScale(from, res)
    if (k && hasText)
      toast(`Text and captions kept their pixel sizes.`, {
        action: {
          label: `Scale them ×${+k.toFixed(2)}`,
          onClick: () => commit(ops.scaleTextPx(next, k))
        }
      })
  }

  // ─── ruler scrub ─────────────────────────────────────────────────────────────
  const scrubAt = (t: number): void => {
    setHover(t)
    for (let i = n - 1; i >= 0; i--)
      for (const c of timeline.tracks[i].clips) {
        const a = c.clip.asset
        if ((a.type !== 'video' && a.type !== 'image') || t < c.start || t > ops.clipEnd(c))
          continue
        const m = media.get(a.id ?? '')
        if (!m) continue
        const src = (a.start ?? 0) + (t - c.start)
        return onScrub({
          time: t,
          sprite: m.sprite,
          frame: a.type === 'video' ? frameAt(m.sprite, src) : null
        })
      }
    onScrub({ time: t })
  }
  const rulerDown = useRef(false)

  const step = zoom >= 60 ? 1 : zoom >= 25 ? 2 : zoom >= 10 ? 5 : zoom >= 5 ? 10 : 30
  const ticks = Array.from({ length: Math.ceil(width / zoom / step) + 1 }, (_, i) => i * step)
  const count = timeline.tracks.reduce((s, tr) => s + tr.clips.length, 0)
  const snapAt = drag && 'snapAt' in drag ? (drag.snapAt ?? null) : null

  // ─── render helpers ──────────────────────────────────────────────────────────
  const geom = (
    c: TimelineClip
  ): { left: number; width: number; sourceStart: number; fade: { in: number; out: number } } => {
    let start = c.start
    let d = ops.dur(c)
    let sourceStart = c.clip.asset.start ?? 0
    let fade = ops.fadeOf(c)
    if (drag?.kind === 'trim' && drag.id === c.id) {
      start = drag.start
      d = drag.duration
      sourceStart = drag.assetStart
    } else if (drag?.kind === 'fade' && drag.id === c.id)
      fade = { ...fade, [drag.side]: drag.seconds }
    else if ((drag?.kind === 'move' || drag?.kind === 'insert') && drag.moved.has(c.id))
      start = drag.moved.get(c.id)!
    return { left: start * zoom, width: d * zoom, sourceStart, fade }
  }
  const movingIds = session?.kind === 'move' && session.started ? new Set(session.ids) : null

  const tile = (c: TimelineClip, trackIndex: number): React.JSX.Element => {
    const g = geom(c)
    const label = clipLabel(c, media)
    const tr = timeline.tracks[trackIndex]
    return (
      <ContextMenu key={c.id}>
        <ContextMenuTrigger asChild>
          <ClipTile
            c={c}
            m={media.get(c.clip.asset.id ?? '')}
            zoom={zoom}
            left={g.left}
            width={g.width}
            sourceStart={g.sourceStart}
            label={label}
            selected={selected.has(c.id)}
            active={drag?.kind === 'trim' && drag.id === c.id}
            dimmed={!!movingIds?.has(c.id)}
            fade={g.fade}
            view={view}
            onGrip={(e, grip) => onGrip(c, e, grip)}
            onContextMenu={() => {
              if (!selected.has(c.id)) editor.select(c.id)
            }}
          />
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            onSelect={() =>
              onMention(
                `clip ${c.id} (${label}, ${tc(c.start)}–${tc(ops.clipEnd(c))} on ${tr?.name ?? `track ${trackIndex + 1}`})`
              )
            }
          >
            Reference in chat
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onSeek(c.start)}>Jump to start</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem disabled={!ops.canSplit(c, time)} onSelect={split}>
            <Scissors /> Split at playhead <ContextMenuShortcut>S</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={copy}>
            <Copy /> Copy <ContextMenuShortcut>{kbd('⌘C')}</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={duplicate}>
            <ClipboardPaste /> Duplicate <ContextMenuShortcut>{kbd('⌘D')}</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={removeSelected}>
            <Trash2 /> Delete <ContextMenuShortcut>{kbd('⌫')}</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    )
  }

  const ghosts =
    drag?.kind === 'move'
      ? drag.ghosts
          .filter((g) => g.row)
          .map((g) => ({ c: g.c, start: g.start, row: g.row!, valid: drag.valid }))
      : drag?.kind === 'insert' && drag.row
        ? [{ c: drag.c, start: drag.start, row: drag.row, valid: drag.valid }]
        : []

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b px-3">
        <span className="mr-2 text-sm font-medium">Timeline</span>
        <ToolButton label="Split at playhead" kbd="S" disabled={!canSplitNow} onClick={split}>
          <Scissors />
        </ToolButton>
        <ToolButton label="Add text" onClick={addText}>
          <Type />
        </ToolButton>
        <ToolButton
          label={hasMedia ? 'Add captions' : 'Captions need a video or audio clip to caption'}
          disabled={!hasMedia}
          onClick={addCaptions}
        >
          <Captions />
        </ToolButton>
        <ToolButton
          label="Add track"
          onClick={() => commit(ops.addTrack(timeline, 'track', ci >= 0 ? ci : n))}
        >
          <Plus />
        </ToolButton>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-muted-foreground font-mono text-[11px]"
                >
                  <Crop />{' '}
                  {canvas.aspect
                    ? `${canvas.aspect} · ${canvas.tier}`
                    : (timeline.resolution ?? '1920x1080')}
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Canvas</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
              Aspect
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={canvas.aspect ?? ''}
              onValueChange={(a) => {
                const tier =
                  canvas.tier && ops.resolutionFor(a, canvas.tier) ? canvas.tier : '1080p'
                setResolution(ops.resolutionFor(a, tier) ?? ops.resolutionFor(a, '720p'))
              }}
            >
              {ops.ASPECTS.map((a) => (
                <DropdownMenuRadioItem
                  key={a.aspect}
                  value={a.aspect}
                  onSelect={(e) => e.preventDefault()}
                >
                  {a.label}{' '}
                  <span className="text-muted-foreground ml-auto font-mono text-[11px]">
                    {a.aspect}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
              Size
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={canvas.tier ?? ''}
              onValueChange={(tier) =>
                setResolution(ops.resolutionFor(canvas.aspect ?? '16:9', tier))
              }
            >
              {ops.TIERS.map((s) => {
                const res = ops.resolutionFor(canvas.aspect ?? '16:9', s.key)
                return (
                  <DropdownMenuRadioItem
                    key={s.key}
                    value={s.key}
                    disabled={!res}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {s.key}
                    <span className="text-muted-foreground ml-auto font-mono text-[11px]">
                      {res ?? '—'}
                    </span>
                  </DropdownMenuRadioItem>
                )
              })}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <label className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm">
              Background
              <input
                type="color"
                className="ml-auto h-5 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
                value={
                  /^#[0-9a-f]{6}$/i.test(timeline.background ?? '')
                    ? timeline.background
                    : '#000000'
                }
                onChange={(e) => commit({ ...timeline, background: e.target.value }, 'background')}
              />
            </label>
            <p className="text-muted-foreground px-2 pt-1 pb-1.5 text-[11px] leading-snug">
              Sizes are output pixels. Changing the canvas doesn’t resize text or captions.
            </p>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex-1" />
        <span className="text-muted-foreground hidden font-mono text-[11px] lg:inline">
          {selected.size > 1 ? `${selected.size} selected · ` : ''}
          {count} clip{count === 1 ? '' : 's'} · {tc(duration)}
        </span>
        <ToolButton
          label="Zoom to fit"
          onClick={() => {
            const vp = viewport()
            if (vp && duration)
              setZoom(Math.min(200, Math.max(4, (vp.clientWidth - 40) / duration)))
          }}
        >
          <Crosshair />
        </ToolButton>
        <ZoomOut className="text-muted-foreground size-3.5" />
        <Slider
          className="w-24"
          min={4}
          max={200}
          step={1}
          value={[zoom]}
          onValueChange={([v]) => setZoom(v)}
        />
        <ZoomIn className="text-muted-foreground size-3.5" />
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex min-h-full" style={{ width: width + LABEL_W }}>
          <div
            className="bg-background sticky left-0 z-50 shrink-0 border-r"
            style={{ width: LABEL_W }}
          >
            <div className="bg-background sticky top-0 z-10 border-b" style={{ height: RULER_H }} />
            {rows.map((r) =>
              r.kind === 'phantom' ? (
                <button
                  key="phantom"
                  className="text-muted-foreground/70 hover:text-foreground flex w-full items-center gap-1.5 border-b px-3 text-[11px]"
                  style={{ height: r.h }}
                  onClick={() => commit(ops.addTrack(timeline, 'track', ci >= 0 ? ci : n))}
                >
                  <Plus className="size-3" /> New track
                </button>
              ) : (
                <TrackLabel
                  key={`t${r.index}`}
                  index={r.index}
                  timeline={timeline}
                  height={r.h}
                  renaming={renaming === r.index}
                  onRename={(name) => {
                    setRenaming(null)
                    if (name !== null) commit(ops.renameTrack(timeline, r.index, name))
                  }}
                  onStartRename={() => setRenaming(r.index)}
                  onMove={(d) => commit(ops.moveTrack(timeline, r.index, r.index + d))}
                  onDelete={() => {
                    const k = timeline.tracks[r.index].clips.length
                    commit(ops.removeTrack(timeline, r.index))
                    if (k)
                      toast(`Deleted a track with ${k} clip${k === 1 ? '' : 's'}`, {
                        action: { label: 'Undo', onClick: editor.undo }
                      })
                  }}
                  canUp={
                    !ops.isCaptionTrack(timeline.tracks[r.index]) &&
                    r.index < (ci >= 0 ? n - 2 : n - 1)
                  }
                  canDown={!ops.isCaptionTrack(timeline.tracks[r.index]) && r.index > 0}
                />
              )
            )}
          </div>
          <div
            ref={areaRef}
            className="relative"
            style={{ width, minHeight: Math.max(lanesH, 0), height: '100%' }}
            onPointerMove={onPointerMove}
            onPointerUp={commitDrag}
            onPointerCancel={() => setSession(null)}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(MEDIA_MIME) || !mediaDrag.item) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
              const { t, y } = pointAt(e.clientX, e.clientY)
              setSession({
                kind: 'insert',
                media: mediaDrag.item,
                time: Math.round(t * 20) / 20,
                y
              })
              autoScroll(e.clientX)
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node) && session?.kind === 'insert')
                setSession(null)
            }}
            onDrop={(e) => {
              if (!e.dataTransfer.types.includes(MEDIA_MIME)) return
              e.preventDefault()
              commitDrag()
              mediaDrag.item = null
            }}
          >
            {/* Ruler: click or drag to seek; hovering shows that frame in the player. */}
            <div
              className="bg-background/95 sticky top-0 z-40 cursor-col-resize border-b backdrop-blur"
              style={{ height: RULER_H }}
              onPointerDown={(e) => {
                ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
                rulerDown.current = true
                onSeek(pointAt(e.clientX, e.clientY).t)
              }}
              onPointerMove={(e) => {
                const t = pointAt(e.clientX, e.clientY).t
                scrubAt(t)
                if (rulerDown.current) onSeek(t)
              }}
              onPointerUp={() => (rulerDown.current = false)}
              onPointerLeave={() => {
                setHover(null)
                onScrub(null)
              }}
            >
              {ticks.map((t) => (
                <div
                  key={t}
                  className="text-muted-foreground pointer-events-none absolute top-0 h-full border-l pl-1 font-mono text-[10px] leading-6"
                  style={{ left: t * zoom }}
                >
                  {tc(t).replace(/\.\d$/, '')}
                </div>
              ))}
              {hover !== null && (
                <div
                  className="bg-popover text-popover-foreground pointer-events-none absolute top-0.5 z-10 -translate-x-1/2 rounded border px-1 font-mono text-[10px] leading-4 tabular-nums shadow-sm"
                  style={{ left: hover * zoom }}
                >
                  {tc(hover)}
                </div>
              )}
            </div>

            {rows.map((r) =>
              r.kind === 'phantom' ? (
                <div
                  key="phantom"
                  className={cn(
                    'absolute inset-x-0 border-b border-dashed transition-colors',
                    ghosts.some((g) => g.row.kind === 'phantom') && 'bg-muted/40'
                  )}
                  style={{ top: r.top, height: r.h }}
                  onClick={() => editor.select(null)}
                >
                  {count === 0 && (
                    <span className="text-muted-foreground pointer-events-none absolute inset-y-0 left-3 flex items-center text-[11px]">
                      Drag media here, or ask the agent for a cut.
                    </span>
                  )}
                </div>
              ) : (
                <div
                  key={`t${r.index}`}
                  className="absolute inset-x-0 border-b"
                  style={{ top: r.top, height: r.h }}
                  onPointerDown={(e) => {
                    if (e.target !== e.currentTarget || e.button !== 0) return
                    editor.select(null)
                    onSeek(pointAt(e.clientX, e.clientY).t)
                  }}
                >
                  {timeline.tracks[r.index].clips.map((c) => tile(c, r.index))}
                </div>
              )
            )}

            {ghosts.map((g) => (
              <div
                key={`ghost-${g.c.id}`}
                className={cn(
                  'pointer-events-none absolute z-30 rounded-md border-2 border-dashed',
                  g.valid
                    ? 'border-foreground/60 bg-foreground/10'
                    : 'border-destructive bg-destructive/15'
                )}
                style={{
                  top: g.row.top + 4,
                  height: Math.max(g.row.h - 8, 16),
                  left: g.start * zoom,
                  width: Math.max(6, ops.dur(g.c) * zoom - 1)
                }}
              >
                <span className="text-foreground/80 truncate px-1.5 text-[10px] leading-5 font-medium">
                  {clipLabel(g.c, media)} · {tc(g.start)}
                </span>
              </div>
            ))}

            {snapAt !== null && (
              <div
                className="pointer-events-none absolute bottom-0 z-30 w-px bg-amber-500"
                style={{ left: snapAt * zoom, top: RULER_H }}
              />
            )}
            {hover !== null && (
              <div
                className="bg-foreground/25 pointer-events-none absolute bottom-0 z-10 w-px"
                style={{ left: hover * zoom, top: RULER_H }}
              />
            )}
            <div
              className="pointer-events-none absolute top-0 bottom-0 z-40 w-px bg-red-500"
              style={{ left: time * zoom }}
            >
              <span className="absolute -top-px left-1/2 size-2.5 -translate-x-1/2 rotate-45 rounded-[2px] bg-red-500" />
            </div>
          </div>
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
      <div className="text-muted-foreground hidden h-6 shrink-0 items-center gap-3 border-t px-3 text-[10px] xl:flex">
        <span>Drag to move · edges trim · top knobs fade</span>
        <span>
          <Kbd>{kbd('⌘').replace('+', '')}</Kbd>/<Kbd>⇧</Kbd> click multi-select
        </span>
        <span>
          <Kbd>Alt</Kbd> drag without snapping
        </span>
        <span>
          <Kbd>←</Kbd>
          <Kbd>→</Kbd> nudge
        </span>
        <span>
          <Kbd>{kbd('⌘Z')}</Kbd> undo
        </span>
      </div>
    </div>
  )
}

function ToolButton({
  label,
  kbd,
  disabled,
  onClick,
  children
}: {
  label: string
  kbd?: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          >
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {kbd && <Kbd className="ml-1.5">{kbd}</Kbd>}
      </TooltipContent>
    </Tooltip>
  )
}

function TrackLabel({
  index,
  timeline,
  height,
  renaming,
  onRename,
  onStartRename,
  onMove,
  onDelete,
  canUp,
  canDown
}: {
  index: number
  timeline: Timeline
  height: number
  renaming: boolean
  onRename: (name: string | null) => void
  onStartRename: () => void
  onMove: (d: number) => void
  onDelete: () => void
  canUp: boolean
  canDown: boolean
}): React.JSX.Element {
  const tr = timeline.tracks[index]
  const { icon: Icon } = TYPE[trackKind(tr.clips)] ?? TYPE.video
  const name = tr.name ?? `Track ${index + 1}`
  return (
    <div
      className="group/label text-muted-foreground flex items-center gap-1.5 border-b pr-1 pl-3 text-xs"
      style={{ height }}
      onDoubleClick={onStartRename}
    >
      <Icon className="size-3.5 shrink-0" />
      {renaming ? (
        <input
          autoFocus
          defaultValue={tr.name ?? ''}
          placeholder={name}
          className="text-foreground bg-background min-w-0 flex-1 rounded border px-1 text-xs outline-none"
          onBlur={(e) => onRename(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onRename((e.target as HTMLInputElement).value)
            if (e.key === 'Escape') onRename(null)
          }}
        />
      ) : (
        <span className="min-w-0 flex-1 truncate" title={name}>
          {name}
        </span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            className="shrink-0 opacity-0 group-hover/label:opacity-100 data-[state=open]:opacity-100"
            aria-label="Track options"
          >
            <MoreVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={onStartRename}>
            <Pencil /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!canUp} onSelect={() => onMove(1)}>
            <ArrowUp /> Move layer up
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!canDown} onSelect={() => onMove(-1)}>
            <ArrowDown /> Move layer down
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2 /> Delete track
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
