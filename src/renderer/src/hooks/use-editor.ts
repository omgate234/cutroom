import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Timeline, TimelineClip } from '@shared/timeline'
import { findClip, isCaption, lengthsOf, type Lengths } from '@shared/timeline-ops'
import type { ProjectState } from '@shared/ipc'

const CAP = 100
const COALESCE_MS = 800

// Editor state the timeline, inspector and media panel share: selection, clipboard and an undo
// stack over every timeline state (manual edits and agent edits alike).
export interface Editor {
  timeline: Timeline
  lengths: Lengths
  selected: Set<string>
  primary: string | null
  primaryClip: TimelineClip | null
  select: (id: string | null, mode?: 'replace' | 'toggle' | 'range') => void
  setSelection: (ids: string[], primary?: string | null) => void
  // `coalesce`: successive commits with the same key (a slider drag) become one undo step.
  commit: (t: Timeline, coalesce?: string) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  setClipboard: (clips: TimelineClip[]) => void
  getClipboard: () => TimelineClip[]
}

export function useEditor(
  project: ProjectState,
  write: (t: Timeline) => Promise<void>,
  rangeIds: (t: Timeline, anchor: string | null, id: string) => string[]
): Editor {
  const { timeline } = project
  const lengths = useMemo(() => lengthsOf(project.assets.media), [project.assets])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [primary, setPrimary] = useState<string | null>(null)
  const clipboard = useRef<TimelineClip[]>([])

  const hist = useRef<{ stack: string[]; index: number }>({ stack: [], index: -1 })
  const pending = useRef<{ key?: string; at: number; lastKey?: string }>({ at: 0 })
  const [can, setCan] = useState({ undo: false, redo: false })
  const bump = (): void => {
    const h = hist.current
    setCan({ undo: h.index > 0, redo: h.index >= 0 && h.index < h.stack.length - 1 })
  }

  // Record every distinct timeline state; a coalesced commit replaces the top instead.
  useEffect(() => {
    const snap = JSON.stringify(timeline)
    const h = hist.current
    if (h.stack[h.index] === snap) return
    const p = pending.current
    const merge = !!p.key && p.key === p.lastKey && Date.now() - p.at < COALESCE_MS && h.index > 0
    p.lastKey = p.key
    p.key = undefined
    if (merge) h.stack[h.index] = snap
    else {
      h.stack = h.stack.slice(0, h.index + 1)
      h.stack.push(snap)
      if (h.stack.length > CAP) h.stack.shift()
      h.index = h.stack.length - 1
    }
    bump()
  }, [timeline])

  // Drop selected ids that no longer exist (the agent rewrote the timeline, undo, delete).
  useEffect(() => {
    setSelected((s) => {
      const keep = [...s].filter((id) => findClip(timeline, id))
      return keep.length === s.size ? s : new Set(keep)
    })
    setPrimary((p) => (p && findClip(timeline, p) ? p : null))
  }, [timeline])

  const commit = useCallback(
    (t: Timeline, coalesce?: string) => {
      const p = pending.current
      if (!coalesce) p.lastKey = undefined
      p.key = coalesce
      p.at = Date.now()
      void write(t)
    },
    [write]
  )

  const jump = useCallback(
    (d: number) => {
      const h = hist.current
      const i = h.index + d
      if (i < 0 || i >= h.stack.length) return
      h.index = i
      pending.current = { at: 0 }
      bump()
      void write(JSON.parse(h.stack[i]) as Timeline)
    },
    [write]
  )

  const select = useCallback(
    (id: string | null, mode: 'replace' | 'toggle' | 'range' = 'replace') => {
      if (!id) {
        setSelected(new Set())
        setPrimary(null)
        return
      }
      const loc = findClip(timeline, id)
      // Captions never join a multi-selection.
      if (mode === 'replace' || !loc || isCaption(loc.clip)) {
        setSelected(new Set([id]))
        setPrimary(id)
        return
      }
      setSelected((s) => {
        const base = new Set(
          [...s].filter((x) => {
            const l = findClip(timeline, x)
            return l && !isCaption(l.clip)
          })
        )
        if (mode === 'toggle') {
          if (base.has(id)) base.delete(id)
          else base.add(id)
        } else for (const x of rangeIds(timeline, primary, id)) base.add(x)
        return base
      })
      setPrimary(id)
    },
    [timeline, primary, rangeIds]
  )

  const setSelection = useCallback(
    (ids: string[], p: string | null = ids[ids.length - 1] ?? null) => {
      setSelected(new Set(ids))
      setPrimary(p)
    },
    []
  )

  const primaryClip = useMemo(
    () => (primary && selected.size === 1 ? (findClip(timeline, primary)?.clip ?? null) : null),
    [timeline, primary, selected]
  )

  const setClipboard = useCallback((clips: TimelineClip[]) => {
    clipboard.current = structuredClone(clips)
  }, [])
  const getClipboard = useCallback(() => clipboard.current, [])

  return {
    timeline,
    lengths,
    selected,
    primary,
    primaryClip,
    select,
    setSelection,
    commit,
    undo: () => jump(-1),
    redo: () => jump(1),
    canUndo: can.undo,
    canRedo: can.redo,
    setClipboard,
    getClipboard
  }
}
