// Pure timeline edits, ported from DirectorFE editor/timelineOps.js onto Cutroom's format
// (VideoDB wire shape: { id, start, clip: { duration, asset, ... } }). Every op returns a new
// Timeline; nothing here touches the DOM or disk. Track index 0 renders at the bottom.
import type { Motion } from './effects'
import type { MediaItem, Timeline, TimelineAsset, TimelineClip, TimelineTrack } from './timeline'

export const MIN_CLIP_DURATION = 0.1
export const DEFAULT_DURATION = 5
export const CAPTION_DEFAULT_DURATION = 10
export const CAPTION_MIN_SLOT = 1
export const MAX_FADE_DURATION = 10

// Source length per media id (assets.json durations), for trim and split bounds.
export type Lengths = Map<string, number>
export const lengthsOf = (media: MediaItem[]): Lengths =>
  new Map(media.filter((m) => m.duration).map((m) => [m.id, m.duration!]))

export function uid(t?: Timeline): string {
  const used = new Set(t?.tracks.flatMap((tr) => tr.clips.map((c) => c.id)) ?? [])
  for (;;) {
    const id = `c-${Math.random().toString(36).slice(2, 8)}`
    if (!used.has(id)) return id
  }
}

export const dur = (c: TimelineClip): number => c.clip.duration
export const clipEnd = (c: TimelineClip): number => c.start + c.clip.duration
export const isTrimmable = (a?: TimelineAsset): boolean =>
  a?.type === 'video' || a?.type === 'audio'
export const isCaption = (c?: TimelineClip): boolean => c?.clip.asset.type === 'caption'
export const isCaptionTrack = (t?: TimelineTrack): boolean => (t?.clips ?? []).some(isCaption)
export const captionTrackIndex = (t: Timeline): number => t.tracks.findIndex(isCaptionTrack)
// Captions live on their own lane; nothing else shares it. An empty lane takes anything.
export const canPlace = (track: TimelineTrack | undefined, c: TimelineClip): boolean =>
  !track || !track.clips.length || isCaption(c) === isCaptionTrack(track)

type Span = { start: number; duration: number }
const overlaps = (a: Span, b: TimelineClip): boolean =>
  a.start < clipEnd(b) - 1e-6 && b.start < a.start + a.duration - 1e-6

export function wouldOverlap(
  track: TimelineTrack,
  s: Span,
  ignore?: Set<string> | string
): boolean {
  const skip = (id: string): boolean =>
    typeof ignore === 'string' ? id === ignore : !!ignore?.has(id)
  return track.clips.some((c) => !skip(c.id) && overlaps(s, c))
}

export interface Loc {
  trackIndex: number
  clip: TimelineClip
}
export function findClip(t: Timeline, id: string): Loc | null {
  for (let trackIndex = 0; trackIndex < t.tracks.length; trackIndex++) {
    const clip = t.tracks[trackIndex].clips.find((c) => c.id === id)
    if (clip) return { trackIndex, clip }
  }
  return null
}

// Nearest free start >= desired on a track: desired, else after each existing clip.
export function findFreeStart(track: TimelineTrack, desired: number, duration: number): number {
  const s = Math.max(0, desired)
  if (!wouldOverlap(track, { start: s, duration })) return s
  const ends = track.clips.map(clipEnd).sort((a, b) => a - b)
  for (const e of ends) if (e >= s && !wouldOverlap(track, { start: e, duration })) return e
  return ends.length ? ends[ends.length - 1] : s
}

// Shift-click: every non-caption clip between anchor and target on the same track.
export function rangeSelectIds(t: Timeline, anchor: string | null, id: string): string[] {
  const to = findClip(t, id)
  const from = anchor ? findClip(t, anchor) : null
  if (!to || isCaption(to.clip) || !from || from.trackIndex !== to.trackIndex) return [id]
  const ordered = sorted(t.tracks[to.trackIndex].clips).filter((c) => !isCaption(c))
  const a = ordered.findIndex((c) => c.id === anchor)
  const b = ordered.findIndex((c) => c.id === id)
  if (a < 0 || b < 0) return [id]
  return ordered.slice(Math.min(a, b), Math.max(a, b) + 1).map((c) => c.id)
}

// ─── snapping ────────────────────────────────────────────────────────────────
export function snapTargets(t: Timeline, exclude: Set<string>, extra: number[] = []): number[] {
  const set = new Set([0, ...extra])
  for (const tr of t.tracks)
    for (const c of tr.clips) {
      if (exclude.has(c.id)) continue
      set.add(c.start)
      set.add(clipEnd(c))
    }
  return [...set]
}

export function snap(
  value: number,
  targets: number[],
  pxPerSecond: number,
  thresholdPx = 7
): { value: number; at: number | null } {
  let best: number | null = null
  let bestD = Infinity
  for (const x of targets) {
    const d = Math.abs(x - value) * pxPerSecond
    if (d <= thresholdPx && d < bestD) {
      best = x
      bestD = d
    }
  }
  return best === null ? { value, at: null } : { value: best, at: best }
}

// ─── internals ───────────────────────────────────────────────────────────────
const sorted = (clips: TimelineClip[]): TimelineClip[] =>
  [...clips].sort((a, b) => a.start - b.start)
const withTracks = (t: Timeline, tracks: TimelineTrack[]): Timeline => ({ ...t, tracks })
const setTrackClips = (t: Timeline, i: number, clips: TimelineClip[]): Timeline =>
  withTracks(
    t,
    t.tracks.map((tr, j) => (j === i ? { ...tr, clips: sorted(clips) } : tr))
  )
function mapClip(t: Timeline, id: string, fn: (c: TimelineClip) => TimelineClip): Timeline {
  const loc = findClip(t, id)
  if (!loc) return t
  return setTrackClips(
    t,
    loc.trackIndex,
    t.tracks[loc.trackIndex].clips.map((c) => (c.id === id ? fn(c) : c))
  )
}
const r3 = (n: number): number => Math.round(n * 1000) / 1000

// ─── tracks ──────────────────────────────────────────────────────────────────
function trackName(t: Timeline, base: string): string {
  const names = new Set(t.tracks.map((x) => x.name))
  if (!names.has(base)) return base
  let n = 2
  while (names.has(`${base} ${n}`)) n++
  return `${base} ${n}`
}

export const addTrack = (t: Timeline, name = 'track', at = t.tracks.length): Timeline => {
  const tracks = [...t.tracks]
  tracks.splice(at, 0, { name: trackName(t, name), clips: [] })
  return withTracks(t, tracks)
}

export const removeTrack = (t: Timeline, i: number): Timeline =>
  withTracks(
    t,
    t.tracks.filter((_, j) => j !== i)
  )

export const renameTrack = (t: Timeline, i: number, name: string): Timeline =>
  withTracks(
    t,
    t.tracks.map((tr, j) => (j === i ? { ...tr, name: name.trim() || undefined } : tr))
  )

// Reorder by render layer (higher index draws on top). The caption lane stays the top layer.
export function moveTrack(t: Timeline, from: number, to: number): Timeline {
  const n = t.tracks.length
  if (from === to || from < 0 || from >= n || isCaptionTrack(t.tracks[from])) return t
  const ceil = isCaptionTrack(t.tracks[n - 1]) ? n - 2 : n - 1
  const dest = Math.max(0, Math.min(to, ceil))
  if (dest === from) return t
  const tracks = [...t.tracks]
  const [tr] = tracks.splice(from, 1)
  tracks.splice(dest, 0, tr)
  // Explicit z_index would fight the new order; render order is array order.
  return withTracks(
    t,
    tracks.map((tr) => {
      const rest = { ...tr }
      delete rest.z_index
      return rest
    })
  )
}

// ─── clips ───────────────────────────────────────────────────────────────────
export const addClip = (t: Timeline, i: number, c: TimelineClip): Timeline =>
  setTrackClips(t, i, [...t.tracks[i].clips, c])

export function removeClips(t: Timeline, ids: Set<string>): Timeline {
  if (!ids.size) return t
  return withTracks(
    t,
    t.tracks.map((tr) =>
      tr.clips.some((c) => ids.has(c.id))
        ? { ...tr, clips: tr.clips.filter((c) => !ids.has(c.id)) }
        : tr
    )
  )
}

// Clip-level fields (fit, position, scale, opacity, offset, filter, transition). `undefined` clears.
export const patchClip = (t: Timeline, id: string, patch: Record<string, unknown>): Timeline =>
  mapClip(t, id, (c) => {
    const body = { ...c.clip, ...patch }
    for (const k of Object.keys(patch)) if (patch[k] === undefined) delete body[k]
    return { ...c, clip: body }
  })

export const patchAsset = (t: Timeline, id: string, patch: Record<string, unknown>): Timeline =>
  mapClip(t, id, (c) => {
    const asset = { ...c.clip.asset, ...patch } as TimelineAsset
    for (const k of Object.keys(patch)) if (patch[k] === undefined) delete asset[k]
    return { ...c, clip: { ...c.clip, asset } }
  })

// Timeline geometry from the inspector: start, duration and (video/audio) source in-point,
// clamped to the source and to the neighbours on the track.
export function setTiming(
  t: Timeline,
  id: string,
  next: { start?: number; duration?: number; assetStart?: number },
  lengths: Lengths
): Timeline {
  const loc = findClip(t, id)
  if (!loc) return t
  const c = loc.clip
  const track = t.tracks[loc.trackIndex]
  const a = c.clip.asset
  const len = isTrimmable(a) ? lengths.get(a.id ?? '') : undefined
  let assetStart = isTrimmable(a) ? Math.max(0, next.assetStart ?? a.start ?? 0) : undefined
  if (len !== undefined && assetStart !== undefined)
    assetStart = Math.min(assetStart, len - MIN_CLIP_DURATION)
  let duration = Math.max(MIN_CLIP_DURATION, next.duration ?? dur(c))
  if (len !== undefined && assetStart !== undefined) duration = Math.min(duration, len - assetStart)
  const start = Math.max(0, next.start ?? c.start)
  if (wouldOverlap(track, { start, duration }, id)) return t
  return mapClip(t, id, (x) => ({
    ...x,
    start: r3(start),
    clip: {
      ...x.clip,
      duration: r3(duration),
      ...(assetStart !== undefined ? { asset: { ...x.clip.asset, start: r3(assetStart) } } : {})
    }
  }))
}

// One side of a fade. VideoDB's transition has one shared duration for in and out.
export function setFade(t: Timeline, id: string, side: 'in' | 'out', seconds: number): Timeline {
  const loc = findClip(t, id)
  if (!loc || isCaption(loc.clip)) return t
  const cur = (loc.clip.clip.transition ?? {}) as {
    in?: string | null
    out?: string | null
    duration?: number
  }
  const tr = { in: cur.in ?? null, out: cur.out ?? null, duration: cur.duration ?? 0.5 }
  if (seconds > 0) {
    tr[side] = 'fade'
    tr.duration = r3(Math.min(seconds, dur(loc.clip), MAX_FADE_DURATION))
  } else tr[side] = null
  return patchClip(t, id, {
    transition: tr.in || tr.out ? tr : undefined,
    ...(seconds > 0 ? { motion: undefined } : {})
  })
}

export function fadeOf(c: TimelineClip): { in: number; out: number } {
  const tr = c.clip.transition as
    { in?: string | null; out?: string | null; duration?: number } | undefined
  const d = tr?.duration ?? 0.5
  return { in: tr?.in ? d : 0, out: tr?.out ? d : 0 }
}

export function moveClip(t: Timeline, id: string, toTrack: number, start: number): Timeline {
  const loc = findClip(t, id)
  if (!loc) return t
  const moved = { ...loc.clip, start: r3(Math.max(0, start)) }
  const next = setTrackClips(
    t,
    loc.trackIndex,
    t.tracks[loc.trackIndex].clips.filter((c) => c.id !== id)
  )
  return setTrackClips(next, toTrack, [...next.tracks[toTrack].clips, moved])
}

// Gap-aware "make room" drop. Clips whose centre is left of the drop's centre stay put (the drop
// clamps flush to them); clips right of it are pushed right, cascading, only as far as needed.
export function resolveRipple(
  track: TimelineTrack,
  cand: Span,
  ignore?: Set<string> | string
): { start: number; moved: Map<string, number> } {
  const skip = (c: TimelineClip): boolean =>
    typeof ignore === 'string' ? c.id === ignore : !!ignore?.has(c.id)
  const centre = Math.max(0, cand.start) + cand.duration / 2
  const others = track.clips.filter((c) => !skip(c))
  const left = (c: TimelineClip): boolean => c.start + dur(c) / 2 < centre
  const leftEnd = others.filter(left).reduce((m, c) => Math.max(m, clipEnd(c)), 0)
  const start = Math.max(0, cand.start, leftEnd)
  let barrier = start + cand.duration
  const moved = new Map<string, number>()
  for (const c of sorted(others)) {
    if (left(c)) continue
    if (c.start < barrier - 1e-6) {
      moved.set(c.id, r3(barrier))
      barrier += dur(c)
    }
  }
  return { start: r3(start), moved }
}

const applyMoved = (clips: TimelineClip[], moved: Map<string, number>): TimelineClip[] =>
  clips.map((c) => (moved.has(c.id) ? { ...c, start: moved.get(c.id)! } : c))

export function moveClipRippling(
  t: Timeline,
  id: string,
  toTrack: number,
  start: number
): Timeline {
  const loc = findClip(t, id)
  if (!loc) return t
  const next = setTrackClips(
    t,
    loc.trackIndex,
    t.tracks[loc.trackIndex].clips.filter((c) => c.id !== id)
  )
  const r = resolveRipple(next.tracks[toTrack], { start, duration: dur(loc.clip) }, id)
  return setTrackClips(next, toTrack, [
    ...applyMoved(next.tracks[toTrack].clips, r.moved),
    { ...loc.clip, start: r.start }
  ])
}

export function addClipRippling(t: Timeline, i: number, c: TimelineClip): Timeline {
  const r = resolveRipple(t.tracks[i], { start: c.start, duration: dur(c) })
  return setTrackClips(t, i, [...applyMoved(t.tracks[i].clips, r.moved), { ...c, start: r.start }])
}

// Multi-select move: one shared track + time delta, committed only into free space.
export type GroupMove = { id: string; trackIndex: number; start: number }
export function moveClipsGroup(t: Timeline, moves: GroupMove[]): Timeline {
  const by = new Map(moves.map((m) => [m.id, m]))
  const pulled = new Map<string, TimelineClip>()
  let next = withTracks(
    t,
    t.tracks.map((tr) => {
      if (!tr.clips.some((c) => by.has(c.id))) return tr
      const keep: TimelineClip[] = []
      for (const c of tr.clips) by.has(c.id) ? pulled.set(c.id, c) : keep.push(c)
      return { ...tr, clips: keep }
    })
  )
  for (const m of moves) {
    const c = pulled.get(m.id)
    if (!c || m.trackIndex < 0 || m.trackIndex >= next.tracks.length) continue
    next = setTrackClips(next, m.trackIndex, [
      ...next.tracks[m.trackIndex].clips,
      { ...c, start: r3(Math.max(0, m.start)) }
    ])
  }
  return next
}

export function groupMoveValid(
  t: Timeline,
  moves: (GroupMove & { duration: number; clip: TimelineClip })[]
): boolean {
  const ids = new Set(moves.map((m) => m.id))
  return moves.every((m) => {
    const tr = t.tracks[m.trackIndex]
    if (m.trackIndex < 0 || m.start < -1e-6) return false
    if (!tr) return true // a new lane
    return (
      canPlace({ ...tr, clips: tr.clips.filter((c) => !ids.has(c.id)) }, m.clip) &&
      !wouldOverlap(tr, { start: m.start, duration: m.duration }, ids)
    )
  })
}

// ─── trims (the live drag and the commit share these, so what you see is what lands) ──
export function previewTrimStart(
  track: TimelineTrack,
  c: TimelineClip,
  newStart: number
): { start: number; duration: number; assetStart?: number } {
  const end = clipEnd(c)
  const prevEnd = track.clips
    .filter((x) => x.id !== c.id && clipEnd(x) <= c.start + 1e-6)
    .reduce((m, x) => Math.max(m, clipEnd(x)), 0)
  const a = c.clip.asset
  const trim = isTrimmable(a)
  const aStart = a.start ?? 0
  const floor = Math.max(0, prevEnd, trim ? c.start - aStart : 0)
  const start = Math.min(Math.max(newStart, floor), end - MIN_CLIP_DURATION)
  const delta = start - c.start
  return {
    start: r3(start),
    duration: r3(dur(c) - delta),
    ...(trim ? { assetStart: r3(aStart + delta) } : {})
  }
}

export function previewTrimEnd(
  track: TimelineTrack,
  c: TimelineClip,
  newEnd: number,
  lengths: Lengths
): { duration: number } {
  const nextStart = track.clips
    .filter((x) => x.id !== c.id && x.start >= clipEnd(c) - 1e-6)
    .reduce((m, x) => Math.min(m, x.start), Infinity)
  const a = c.clip.asset
  const len = isTrimmable(a) ? lengths.get(a.id ?? '') : undefined
  const ceil = len !== undefined ? c.start + (len - (a.start ?? 0)) : Infinity
  const end = Math.min(Math.max(newEnd, c.start + MIN_CLIP_DURATION), nextStart, ceil)
  return { duration: r3(end - c.start) }
}

export function trimStart(t: Timeline, id: string, newStart: number): Timeline {
  const loc = findClip(t, id)
  if (!loc) return t
  const p = previewTrimStart(t.tracks[loc.trackIndex], loc.clip, newStart)
  return mapClip(t, id, (c) => ({
    ...c,
    start: p.start,
    clip: {
      ...c.clip,
      duration: p.duration,
      ...(p.assetStart !== undefined ? { asset: { ...c.clip.asset, start: p.assetStart } } : {})
    }
  }))
}

export function trimEnd(t: Timeline, id: string, newEnd: number, lengths: Lengths): Timeline {
  const loc = findClip(t, id)
  if (!loc) return t
  const p = previewTrimEnd(t.tracks[loc.trackIndex], loc.clip, newEnd, lengths)
  return mapClip(t, id, (c) => ({ ...c, clip: { ...c.clip, duration: p.duration } }))
}

// Split strictly inside a clip. Left half keeps the id; the right half advances its in-point.
export function canSplit(c: TimelineClip | undefined, at: number): boolean {
  // Keyframe curves cannot be cut exactly with the current wire format. Keep them intact.
  const keyed = c?.clip.motion as Motion | undefined
  return !!c && !Object.keys(keyed?.keyframes ?? {}).length && at > c.start + MIN_CLIP_DURATION && at < clipEnd(c) - MIN_CLIP_DURATION
}

export function splitClip(
  t: Timeline,
  id: string,
  at: number
): { timeline: Timeline; rightId: string | null } {
  const loc = findClip(t, id)
  if (!loc || !canSplit(loc.clip, at)) return { timeline: t, rightId: null }
  const c = loc.clip
  const leftDur = r3(at - c.start)
  const rightId = uid(t)
  const tr = c.clip.transition as
    { in?: string | null; out?: string | null; duration?: number } | undefined
  // The fade-in stays on the left half and the fade-out on the right.
  const side = (keep: 'in' | 'out'): Record<string, unknown> | undefined => {
    if (!tr?.[keep]) return undefined
    return {
      in: keep === 'in' ? tr.in : null,
      out: keep === 'out' ? tr.out : null,
      duration: tr.duration
    }
  }
  const motion = c.clip.motion as Motion | undefined
  const motionSide = (keep: 'enter' | 'exit', duration: number): Motion | undefined => {
    const preset = motion?.[keep]
    return preset ? { [keep]: { ...preset, duration: Math.min(preset.duration, duration) } } : undefined
  }
  const left: TimelineClip = {
    ...c,
    clip: { ...c.clip, duration: leftDur, transition: side('in'), motion: motionSide('enter', leftDur) }
  }
  const right: TimelineClip = {
    ...c,
    id: rightId,
    start: r3(at),
    clip: {
      ...c.clip,
      duration: r3(clipEnd(c) - at),
      transition: side('out'),
      motion: motionSide('exit', r3(clipEnd(c) - at)),
      ...(isTrimmable(c.clip.asset)
        ? { asset: { ...c.clip.asset, start: r3((c.clip.asset.start ?? 0) + leftDur) } }
        : {})
    }
  }
  for (const x of [left, right]) if (!x.clip.transition) delete x.clip.transition
  const clips = t.tracks[loc.trackIndex].clips.flatMap((x) => (x.id === id ? [left, right] : [x]))
  return { timeline: setTrackClips(t, loc.trackIndex, clips), rightId }
}

// ─── builders ────────────────────────────────────────────────────────────────
export function clipFromMedia(
  t: Timeline,
  m: MediaItem,
  start: number,
  window?: { sourceStart?: number; duration?: number }
): TimelineClip {
  const isMedia = m.kind === 'video' || m.kind === 'audio'
  const from = isMedia ? Math.max(0, window?.sourceStart ?? 0) : 0
  const available = isMedia && m.duration ? m.duration - from : undefined
  const duration = Math.min(
    window?.duration ?? available ?? DEFAULT_DURATION,
    available ?? Infinity
  )
  return {
    id: uid(t),
    start: r3(Math.max(0, start)),
    clip: {
      duration: r3(duration),
      asset: isMedia
        ? { type: m.kind, id: m.id, start: r3(from), volume: 1 }
        : { type: 'image', id: m.id }
    }
  }
}

export function textClip(t: Timeline, start: number, text = 'Text'): TimelineClip {
  return {
    id: uid(t),
    start: r3(Math.max(0, start)),
    clip: {
      duration: DEFAULT_DURATION,
      asset: {
        type: 'text',
        text,
        font: { family: 'Inter', size: 48, color: '#FFFFFF', opacity: 1, weight: 400 },
        alignment: { horizontal: 'center', vertical: 'center' },
        tabsize: 4,
        line_spacing: 0
      }
    }
  }
}

export const CAPTION_BASE = {
  type: 'caption' as const,
  src: 'auto',
  font: {
    font_name: 'Open Sans',
    font_size: 56,
    bold: true,
    italic: false,
    underline: false,
    strikeout: false,
    scale_x: 100,
    scale_y: 100,
    spacing: 0,
    angle: 0
  },
  primary_color: '&H00FFFFFF',
  secondary_color: '&H0000FF00',
  back_color: '&H00000000',
  border: { style: 'outline_and_shadow', outline: 3, outline_color: '&H00000000', shadow: 0 },
  position: { alignment: 'bottom_center', margin_l: 30, margin_r: 30, margin_v: 30 },
  animation: 'karaoke'
}

export function captionClip(t: Timeline, start: number, duration: number): TimelineClip {
  return {
    id: uid(t),
    start: r3(Math.max(0, start)),
    clip: {
      duration: r3(Math.max(MIN_CLIP_DURATION, duration)),
      asset: structuredClone(CAPTION_BASE)
    }
  }
}

// Where the next caption goes: the whole edit if there are none yet, else from the playhead to
// the next caption (or the end), else after the last caption.
export function nextCaptionSlot(t: Timeline, playhead: number, total: number): Span {
  const i = captionTrackIndex(t)
  const caps = i < 0 ? [] : sorted(t.tracks[i].clips)
  if (!caps.length) return { start: 0, duration: Math.max(total, CAPTION_DEFAULT_DURATION) }
  let anchor = Math.max(0, playhead)
  for (const c of caps) if (c.start <= anchor && anchor < clipEnd(c)) anchor = clipEnd(c)
  const nxt = caps.find((c) => c.start > anchor)
  const gap = (nxt ? nxt.start : total) - anchor
  if (gap >= CAPTION_MIN_SLOT) return { start: anchor, duration: gap }
  const lastEnd = caps.reduce((m, c) => Math.max(m, clipEnd(c)), 0)
  return { start: lastEnd, duration: Math.max(total - lastEnd, CAPTION_DEFAULT_DURATION) }
}

// Caption lane is created as the top layer with its first caption.
export function addCaption(t: Timeline, c: TimelineClip): Timeline {
  const i = captionTrackIndex(t)
  if (i >= 0) return addClip(t, i, c)
  return withTracks(t, [...t.tracks, { name: trackName(t, 'captions'), clips: [c] }])
}

// First non-caption track with room at [start, start+duration], else a new track.
export function placeOnFreeTrack(t: Timeline, c: TimelineClip, name = 'overlay'): Timeline {
  const ci = captionTrackIndex(t)
  for (let i = 0; i < t.tracks.length; i++) {
    if (i === ci) continue
    if (!wouldOverlap(t.tracks[i], { start: c.start, duration: dur(c) })) return addClip(t, i, c)
  }
  const at = ci >= 0 ? ci : t.tracks.length
  return addClip(addTrack(t, name, at), at, c)
}

// ─── canvas ──────────────────────────────────────────────────────────────────
export const ASPECTS = [
  { label: 'Horizontal', aspect: '16:9', ratio: [16, 9] },
  { label: 'Vertical', aspect: '9:16', ratio: [9, 16] },
  { label: 'Square', aspect: '1:1', ratio: [1, 1] }
] as const
export const TIERS = [
  { key: '720p', short: 720 },
  { key: '1080p', short: 1080 },
  { key: '4K', short: 2160 }
] as const
export const MAX_RENDER = { width: 3840, height: 2160 }

const even = (n: number): number => Math.max(2, 2 * Math.round(n / 2))
export function resolutionFor(aspect: string, tier: string): string | null {
  const a = ASPECTS.find((x) => x.aspect === aspect)
  const s = TIERS.find((x) => x.key === tier)
  if (!a || !s) return null
  const [w, h] = a.ratio
  const f =
    w >= h
      ? { w: even((s.short * w) / h), h: even(s.short) }
      : { w: even(s.short), h: even((s.short * h) / w) }
  return f.w > MAX_RENDER.width || f.h > MAX_RENDER.height ? null : `${f.w}x${f.h}`
}
export function canvasOf(res?: string): { aspect: string | null; tier: string | null } {
  for (const a of ASPECTS)
    for (const s of TIERS)
      if (resolutionFor(a.aspect, s.key) === res) return { aspect: a.aspect, tier: s.key }
  return { aspect: null, tier: null }
}
// Uniform factor between two resolutions (tier change), or null when the shape changes.
export function pixelScale(from?: string, to?: string): number | null {
  const p = (r?: string): number[] | null => {
    const m = /^(\d+)x(\d+)$/.exec(r ?? '')
    return m ? [+m[1], +m[2]] : null
  }
  const a = p(from)
  const b = p(to)
  if (!a || !b) return null
  const x = b[0] / a[0]
  const y = b[1] / a[1]
  return Math.abs(x - y) / y > 0.01 || y === 1 ? null : y
}

// Text and caption sizes are output pixels; this rescales them after a tier change.
const PX_FIELDS: Record<string, string[][]> = {
  text: [
    ['font', 'size'],
    ['border', 'width'],
    ['shadow', 'x'],
    ['shadow', 'y'],
    ['background', 'width'],
    ['background', 'height'],
    ['background', 'border_width'],
    ['line_spacing'],
    ['width'],
    ['height']
  ],
  caption: [
    ['font', 'font_size'],
    ['font', 'spacing'],
    ['border', 'outline'],
    ['border', 'shadow'],
    ['position', 'margin_l'],
    ['position', 'margin_r'],
    ['position', 'margin_v']
  ]
}
const INTS = new Set(['width', 'height'])
export function scaleTextPx(t: Timeline, factor: number): Timeline {
  if (!(factor > 0) || factor === 1) return t
  return withTracks(
    t,
    t.tracks.map((tr) => ({
      ...tr,
      clips: tr.clips.map((c) => {
        const fields = PX_FIELDS[c.clip.asset.type]
        if (!fields) return c
        let a = c.clip.asset as Record<string, any>
        for (const path of fields) {
          const parent = path.length > 1 ? a[path[0]] : a
          const key = path[path.length - 1]
          const v = parent?.[key]
          if (typeof v !== 'number') continue
          let s = v * factor
          if (INTS.has(path.join('.'))) s = Math.round(s)
          if (key === 'size' || key === 'font_size') s = Math.max(1, Math.round(s))
          a =
            path.length > 1 ? { ...a, [path[0]]: { ...a[path[0]], [key]: s } } : { ...a, [key]: s }
        }
        return { ...c, clip: { ...c.clip, asset: a as TimelineAsset } }
      })
    }))
  )
}
