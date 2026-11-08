import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { Checkpoint, CompileState, ProjectState } from '@shared/ipc'
import type { AssetsFile, Timeline } from '@shared/timeline'
import { errMsg } from '@/lib/format'

export interface ProjectApi {
  project: ProjectState | null
  compile: CompileState
  history: Checkpoint[]
  open: (dir?: string) => Promise<void>
  create: () => Promise<void>
  writeTimeline: (t: Timeline) => Promise<void>
  rename: (patch: { name?: string; description?: string }) => Promise<void>
  close: () => void
}

export function useProject(): ProjectApi {
  const [project, setProject] = useState<ProjectState | null>(null)
  const [compile, setCompile] = useState<CompileState>({ state: 'idle' })
  const [history, setHistory] = useState<Checkpoint[]>([])

  useEffect(() => {
    const offs = [
      window.api.on('project:timeline', (timeline: Timeline) =>
        setProject((p) => (p ? { ...p, timeline } : p))
      ),
      window.api.on('project:assets', (assets: AssetsFile) =>
        setProject((p) => (p ? { ...p, assets } : p))
      ),
      window.api.on('project:compile', (c: CompileState) => setCompile(c)),
      window.api.on('project:history', (h: Checkpoint[]) => setHistory(h))
    ]
    return () => offs.forEach((off) => off())
  }, [])

  const open = useCallback(async (dir?: string) => {
    try {
      setCompile({ state: 'idle' })
      const r = dir ? await window.api.project.open(dir) : await window.api.project.pick()
      if (!r) return
      setProject(r.state)
      setHistory(r.history)
    } catch (e) {
      toast.error(errMsg(e))
    }
  }, [])

  const create = useCallback(async () => {
    try {
      setCompile({ state: 'idle' })
      const r = await window.api.projects.create()
      setProject(r.state)
      setHistory(r.history)
    } catch (e) {
      toast.error(errMsg(e))
    }
  }, [])

  const rename = useCallback(async (patch: { name?: string; description?: string }) => {
    const meta = await window.api.project.rename(patch)
    setProject((p) => (p ? { ...p, meta, name: meta.name } : p))
  }, [])

  // Optimistic: the watcher echoes the same content back.
  const writeTimeline = useCallback(async (timeline: Timeline) => {
    setProject((p) => (p ? { ...p, timeline } : p))
    await window.api.project.writeTimeline(timeline)
  }, [])

  return {
    project,
    compile,
    history,
    open,
    create,
    rename,
    writeTimeline,
    close: () => {
      void window.api.project.close()
      setProject(null)
    }
  }
}
