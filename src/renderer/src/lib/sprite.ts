// Port of DirectorFE editor/spriteStrip.js: sprite manifest + tile geometry in, positioned cells out.
// Time is SOURCE time: a cell's frame is asset.start + x / pxPerSecond.
import type { SpriteManifest } from '@shared/timeline'

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const round = (v: number): number => Math.round(v * 100) / 100

export const manifestReady = (m?: SpriteManifest | null): m is SpriteManifest =>
  !!m &&
  Array.isArray(m.sheets) &&
  m.sheets.length > 0 &&
  finite(m.interval) &&
  m.interval > 0 &&
  m.grid?.columns > 0 &&
  m.grid?.rows > 0 &&
  m.thumbnail?.width > 0 &&
  m.thumbnail?.height > 0

export interface Frame {
  index: number
  url: string
  col: number
  row: number
}

export function frameAt(m: SpriteManifest | undefined | null, srcTime: number): Frame | null {
  if (!manifestReady(m)) return null
  const { columns, rows } = m.grid
  const perSheet = columns * rows
  const declared = finite(m.thumbnail_count) ? m.thumbnail_count : Infinity
  const cap = Math.min(declared, m.sheets.length * perSheet)
  if (cap < 1) return null
  const index = Math.min(
    Math.floor(Math.max(0, finite(srcTime) ? srcTime : 0) / m.interval),
    cap - 1
  )
  const within = index % perSheet
  return {
    index,
    url: m.sheets[Math.floor(index / perSheet)],
    col: within % columns,
    row: Math.floor(within / columns)
  }
}

// CSS for one frame drawn into a box of the given height (width follows the frame's aspect).
export function frameStyle(m: SpriteManifest, f: Frame, height: number): React.CSSProperties {
  const { width: tw, height: th } = m.thumbnail
  const scale = height / th
  return {
    width: round(tw * scale),
    height,
    backgroundImage: `url("${f.url}")`,
    backgroundSize: `${round(m.grid.columns * tw * scale)}px ${round(m.grid.rows * th * scale)}px`,
    backgroundPosition: `${round(-f.col * tw * scale)}px ${round(-f.row * th * scale)}px`
  }
}

export interface Cell {
  key: string
  left: number
  width: number
  style: React.CSSProperties
}

// Contiguous frames at natural fit-height width; only cells inside [viewStart, viewEnd] (tile-local px).
export function spriteCells(
  m: SpriteManifest | undefined | null,
  o: {
    width: number
    height: number
    pxPerSecond: number
    sourceStart?: number
    viewStart?: number
    viewEnd?: number
  }
): Cell[] {
  if (!manifestReady(m) || !(o.width > 0) || !(o.height > 0) || !(o.pxPerSecond > 0)) return []
  const { width: tw, height: th } = m.thumbnail
  const natural = (tw / th) * o.height
  const count = Math.max(1, Math.ceil(o.width / natural - 1e-6))
  const first = Math.max(0, Math.floor((o.viewStart ?? 0) / natural))
  const last = Math.min(
    count - 1,
    o.viewEnd === undefined ? Infinity : Math.ceil(o.viewEnd / natural) - 1
  )
  const cells: Cell[] = []
  for (let i = first; i <= last; i++) {
    const left = i * natural
    const f = frameAt(m, (o.sourceStart ?? 0) + left / o.pxPerSecond)
    if (!f) break
    const base = frameStyle(m, f, o.height)
    cells.push({
      key: `${i}:${f.index}`,
      left: round(left),
      width: round(Math.min(natural, o.width - left)),
      style: { ...base, width: round(Math.min(natural, o.width - left)) }
    })
  }
  return cells
}
