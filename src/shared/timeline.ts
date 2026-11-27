// Project timeline = VideoDB editor wire format plus ids/names for targeted edits.
// toWire() strips those and fills the same defaults the SDK sends.

import { MOTION_PRESETS, EASINGS, EFFECTS, KEYFRAME_PROPERTIES, type Lut } from './effects'

export type AssetType = 'video' | 'audio' | 'image' | 'text' | 'caption'

export interface TimelineAsset {
  type: AssetType
  id?: string
  start?: number
  volume?: number
  text?: string
  src?: string
  [key: string]: unknown
}

export interface TimelineClipBody {
  asset: TimelineAsset
  duration: number
  [key: string]: unknown
}

export interface TimelineClip {
  id: string
  start: number
  clip: TimelineClipBody
}

export interface TimelineTrack {
  name?: string
  z_index?: number
  clips: TimelineClip[]
}

export interface Timeline {
  lut?: Lut
  background?: string
  resolution?: string
  tracks: TimelineTrack[]
}

export type MediaKind = 'video' | 'audio' | 'image'
export type MediaStatus = 'uploading' | 'indexing' | 'ready' | 'failed'

export interface MediaItem {
  id: string
  name: string
  kind: MediaKind
  duration?: number
  status: MediaStatus
  error?: string
  thumbnail?: string
  stream_url?: string
  index_ids?: Record<string, string>
  sprite?: SpriteManifest
}

// videodb-server GET /video/<id>/sprite/ manifest (same contract DirectorFE's spriteStrip.js reads).
export interface SpriteManifest {
  interval: number
  grid: { columns: number; rows: number }
  thumbnail: { width: number; height: number }
  thumbnail_count?: number
  sheets: string[]
  duration?: number
}

export interface AssetsFile {
  media: MediaItem[]
}

export interface Issue {
  path: string
  message: string
}

export const EMPTY_TIMELINE: Timeline = {
  background: '#000000',
  resolution: '1920x1080',
  tracks: []
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export function timelineDuration(t: Timeline): number {
  let end = 0
  for (const track of t.tracks ?? [])
    for (const c of track.clips ?? []) end = Math.max(end, (c.start ?? 0) + (c.clip?.duration ?? 0))
  return end
}

export function validateTimeline(raw: unknown, assets: AssetsFile): Issue[] {
  const issues: Issue[] = []
  const add = (path: string, message: string): void => void issues.push({ path, message })
  if (!isObj(raw)) return [{ path: '', message: 'timeline.json must be an object' }]
  if (raw.resolution !== undefined && (!/^[1-9]\d*x[1-9]\d*$/.test(String(raw.resolution))))
    add('resolution', 'must look like "1920x1080"')
  const finite = (v: unknown, min: number, max = Infinity): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
  const lut = (value: unknown, path: string): void => {
    if (value === undefined) return
    if (
      !isObj(value) ||
      typeof value.src !== 'string' ||
      !/^https?:\/\//.test(value.src) ||
      !finite(value.intensity ?? 1, 0, 1)
    )
      add(path, 'requires an uploaded LUT URL and intensity 0..1; import local .cube files first')
  }
  lut(raw.lut, 'lut')
  if (!Array.isArray(raw.tracks))
    return [...issues, { path: 'tracks', message: 'must be an array' }]

  const media = new Map(assets.media.map((m) => [m.id, m]))
  const ids = new Set<string>()

  raw.tracks.forEach((track: unknown, ti: number) => {
    const tp = `tracks[${ti}]`
    if (!isObj(track) || !Array.isArray(track.clips)) return add(tp, 'track needs a clips array')
    const spans: [number, number, string][] = []
    track.clips.forEach((item: unknown, ci: number) => {
      const p = `${tp}.clips[${ci}]`
      if (!isObj(item)) return add(p, 'must be an object')
      const id = typeof item.id === 'string' ? item.id : ''
      if (!id) add(`${p}.id`, 'every clip needs a unique string id')
      else if (ids.has(id)) add(`${p}.id`, `duplicate id "${id}"`)
      ids.add(id)
      const start = item.start
      if (!finite(start, 0)) add(`${p}.start`, 'must be a number >= 0')
      const clip = item.clip
      if (!isObj(clip)) return add(`${p}.clip`, 'missing clip object')
      const dur = clip.duration
      if (!finite(dur, Number.MIN_VALUE)) add(`${p}.clip.duration`, 'must be a number > 0')
      for (const k of ['scale', 'opacity'] as const) {
        const v = clip[k]
        if (v !== undefined && !finite(v, 0, k === 'scale' ? 10 : 1))
          add(`${p}.clip.${k}`, k === 'scale' ? 'must be 0..10' : 'must be 0..1')
      }
      const asset = clip.asset
      if (!isObj(asset)) return add(`${p}.clip.asset`, 'missing asset object')
      const type = asset.type
      lut(clip.lut, `${p}.clip.lut`)
      if ((type === 'audio' || type === 'caption') && (clip.lut || clip.motion || clip.effect))
        add(`${p}.clip`, 'LUTs, motion and effects require a video, image or text clip')
      if (clip.effect !== undefined && !EFFECTS.includes(clip.effect as never))
        add(`${p}.clip.effect`, 'unknown effect')
      if (clip.motion !== undefined) {
        const m = clip.motion
        if (!isObj(m)) add(`${p}.clip.motion`, 'must be an object')
        else {
          if (clip.effect || clip.transition)
            add(`${p}.clip.motion`, 'remove effect and transition before using motion')
          for (const edge of ['enter', 'exit']) {
            const v = m[edge]
            if (v === undefined) continue
            if (
              !isObj(v) ||
              !MOTION_PRESETS.includes(v.preset as never) ||
              !finite(v.duration ?? 0.4, Number.MIN_VALUE, 10) ||
              !finite(v.amount ?? 0.08, 0, 1) ||
              !EASINGS.includes((v.easing ?? 'ease_out') as never)
            )
              add(`${p}.clip.motion.${edge}`, 'invalid preset, duration, amount or easing')
          }
          if (m.keyframes !== undefined) {
            if (!isObj(m.keyframes)) add(`${p}.clip.motion.keyframes`, 'must be an object')
            else
              for (const [prop, frames] of Object.entries(m.keyframes)) {
                const path = `${p}.clip.motion.keyframes.${prop}`
                if (
                  !KEYFRAME_PROPERTIES.includes(prop as never) ||
                  !Array.isArray(frames) ||
                  !frames.length
                ) {
                  add(path, 'unknown property or empty keyframes')
                  continue
                }
                let previous = -1
                for (const f of frames) {
                  if (
                    !isObj(f) ||
                    !finite(f.time, 0) ||
                    f.time <= previous ||
                    !finite(
                      f.value,
                      prop === 'scale' || prop === 'opacity' ? 0 : -Infinity,
                      prop === 'opacity' ? 1 : prop === 'scale' ? 10 : Infinity
                    ) ||
                    !EASINGS.includes((f.easing ?? 'linear') as never)
                  )
                    add(
                      path,
                      'keyframes need ordered nonnegative times, finite values and valid easing'
                    )
                  if (isObj(f) && typeof f.time === 'number') previous = f.time
                }
              }
          }
        }
      }
      if (type === 'video' || type === 'audio' || type === 'image') {
        const m = typeof asset.id === 'string' ? media.get(asset.id) : undefined
        if (!m)
          add(`${p}.clip.asset.id`, `unknown media id "${String(asset.id)}" (see assets.json)`)
        else {
          if (m.kind !== type)
            add(`${p}.clip.asset.type`, `media ${m.id} is ${m.kind}, not ${type}`)
          if (m.status === 'uploading' || m.status === 'failed')
            add(`${p}.clip.asset.id`, `media ${m.id} is ${m.status}`)
          const from = typeof asset.start === 'number' ? asset.start : 0
          if (asset.start !== undefined && !finite(asset.start, 0)) add(`${p}.clip.asset.start`, 'must be a finite number >= 0')
          if (
            type !== 'image' &&
            m.duration &&
            typeof dur === 'number' &&
            from + dur > m.duration + 0.05
          )
            add(
              `${p}.clip`,
              `asset.start + duration = ${(from + dur).toFixed(2)}s runs past the source (${m.duration.toFixed(2)}s)`
            )
        }
      } else if (type === 'text') {
        if (asset.font !== undefined) {
          if (!isObj(asset.font)) add(`${p}.clip.asset.font`, 'must be an object')
          else {
            if (asset.font.weight !== undefined && (!finite(asset.font.weight, 100, 900) || !Number.isInteger(asset.font.weight))) add(`${p}.clip.asset.font.weight`, 'use a numeric weight such as 400 or 700, not a name like bold')
            if (asset.font.size !== undefined && !finite(asset.font.size, Number.MIN_VALUE)) add(`${p}.clip.asset.font.size`, 'must be a positive finite number')
          }
        }
        if (typeof asset.text !== 'string' || !asset.text)
          add(`${p}.clip.asset.text`, 'text asset needs text')
      } else if (type !== 'caption') {
        add(`${p}.clip.asset.type`, 'must be video, audio, image, text or caption')
      }
      if (typeof start === 'number' && typeof dur === 'number') spans.push([start, start + dur, id])
    })
    spans.sort((a, b) => a[0] - b[0])
    for (let i = 1; i < spans.length; i++)
      if (spans[i][0] < spans[i - 1][1] - 0.001)
        add(
          tp,
          `clips "${spans[i - 1][2]}" and "${spans[i][2]}" overlap; put overlapping clips on separate tracks`
        )
  })
  return issues
}

const ASSET_DEFAULTS: Record<string, Record<string, unknown>> = {
  video: { start: 0, volume: 1, crop: { top: 0, right: 0, bottom: 0, left: 0 } },
  audio: { start: 0, volume: 1 },
  image: { crop: { top: 0, right: 0, bottom: 0, left: 0 } },
  text: {
    font: { family: 'Clear Sans', size: 48, color: '#FFFFFF', opacity: 1 },
    alignment: { horizontal: 'center', vertical: 'center' },
    tabsize: 4,
    line_spacing: 0
  },
  caption: { src: 'auto' }
}

const CLIP_DEFAULTS = {
  scale: 1,
  opacity: 1,
  fit: 'crop',
  position: 'center',
  offset: { x: 0, y: 0 },
  z_index: 0
}

export function toWire(t: Timeline): { timeline: Record<string, unknown> } {
  return {
    timeline: {
      ...(t.lut ? { lut: t.lut } : {}),
      background: t.background ?? '#000000',
      resolution: t.resolution ?? '1920x1080',
      tracks: t.tracks.map((track, i) => ({
        z_index: track.z_index ?? i,
        clips: track.clips.map(({ start, clip }) => {
          const { asset, ...rest } = clip
          const assetOut = { ...ASSET_DEFAULTS[asset.type], ...asset }
          if (asset.type === 'text' || asset.type === 'caption') delete assetOut.id
          return { start, clip: { ...CLIP_DEFAULTS, ...rest, asset: assetOut } }
        })
      }))
    }
  }
}
