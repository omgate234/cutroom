import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Clapperboard,
  Ellipsis,
  FolderOpen,
  FolderSearch,
  Pencil,
  Plus,
  Search,
  Settings2,
  Trash2
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Kbd } from '@/components/ui/kbd'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty'
import { SettingsDialog } from '@/components/settings-dialog'
import { ThemeToggle } from '@/components/theme-toggle'
import { AGENT_LABEL, AgentIcon, CutroomMark } from '@/components/brand'
import type { ProjectSummary, Settings } from '@shared/ipc'
import { frameAt, frameStyle } from '@/lib/sprite'
import { ago, errMsg, tc } from '@/lib/format'

const ease = [0.22, 1, 0.36, 1] as const

function Cover({ p }: { p: ProjectSummary }): React.JSX.Element {
  const [pos, setPos] = useState<number | null>(null)
  const [h, setH] = useState(0)
  const c = p.cover
  const f = c?.sprite && c.duration ? frameAt(c.sprite, (pos ?? 0.15) * c.duration) : null
  return (
    <div
      ref={(el) => {
        if (el && el.clientHeight !== h) setH(el.clientHeight)
      }}
      className="bg-muted relative aspect-video overflow-hidden rounded-lg"
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        setPos(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)))
      }}
      onMouseLeave={() => setPos(null)}
    >
      {f && c?.sprite && h ? (
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2"
          style={frameStyle(c.sprite, f, h)}
        />
      ) : c?.thumbnail ? (
        <img src={c.thumbnail} alt="" className="size-full object-cover" />
      ) : (
        <div className="text-muted-foreground/60 flex size-full items-center justify-center">
          <Clapperboard className="size-7" strokeWidth={1.5} />
        </div>
      )}
      {pos !== null && f && (
        <span
          className="absolute bottom-0 left-0 h-0.5 bg-red-500"
          style={{ width: `${pos * 100}%` }}
        />
      )}
      {p.duration > 0 && (
        <span className="absolute right-1.5 bottom-1.5 rounded bg-black/65 px-1.5 py-0.5 font-mono text-[10px] text-white tabular-nums">
          {tc(p.duration)}
        </span>
      )}
    </div>
  )
}

function EditDialog({
  project,
  onClose,
  onSaved
}: {
  project: ProjectSummary | null
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  useEffect(() => {
    if (project) {
      setName(project.name)
      setDescription(project.description)
    }
  }, [project])
  const save = async (): Promise<void> => {
    if (!project || !name.trim()) return
    await window.api.projects.update(project.dir, {
      name: name.trim(),
      description: description.trim()
    })
    onSaved()
    onClose()
  }
  return (
    <Dialog open={!!project} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit project</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="pname">Name</Label>
            <Input
              id="pname"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void save()}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pdesc">Description</Label>
            <Textarea
              id="pdesc"
              rows={3}
              placeholder="What is this edit for? The agent reads this too."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={!name.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function Welcome({
  onOpen,
  onCreate
}: {
  onOpen: (dir?: string) => Promise<void>
  onCreate: () => Promise<void>
}): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editing, setEditing] = useState<ProjectSummary | null>(null)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(() => {
    void window.api.projects.list().then(setProjects)
  }, [])

  useEffect(load, [load])
  useEffect(() => {
    void window.api.settings.get().then(setSettings)
  }, [settingsOpen])

  const create = useCallback(async () => {
    setCreating(true)
    await onCreate()
    setCreating(false)
  }, [onCreate])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key.toLowerCase() === 'n') {
        e.preventDefault()
        void create()
      }
      if (e.key.toLowerCase() === 'o') {
        e.preventDefault()
        void onOpen()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [create, onOpen])

  const remove = async (p: ProjectSummary): Promise<void> => {
    try {
      if (await window.api.projects.remove(p.dir, p.name, p.owned)) {
        setProjects((list) => list?.filter((x) => x.dir !== p.dir) ?? null)
        toast.success(p.owned ? 'Moved to Trash' : 'Removed from Cutroom')
      }
    } catch (e) {
      toast.error(errMsg(e))
    }
  }

  const q = query.trim().toLowerCase()
  const shown = (projects ?? []).filter(
    (p) => !q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
  )

  return (
    <div className="flex h-full flex-col">
      <div className="drag flex h-11 shrink-0 items-center justify-end gap-0.5 px-3">
        <div className="no-drag flex items-center gap-0.5">
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Settings"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-8 pt-6 pb-12">
          <motion.header
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease }}
            className="flex items-center gap-3"
          >
            <CutroomMark className="size-9" />
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-semibold tracking-tight">Projects</h1>
              {settings && (
                <button
                  className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs transition-colors"
                  onClick={() => setSettingsOpen(true)}
                >
                  <AgentIcon kind={settings.agent} className="size-3.5" /> Editing with{' '}
                  {AGENT_LABEL[settings.agent]}
                </button>
              )}
            </div>
            {(projects?.length ?? 0) > 6 && (
              <InputGroup className="w-56">
                <InputGroupAddon>
                  <Search />
                </InputGroupAddon>
                <InputGroupInput
                  placeholder="Search projects"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </InputGroup>
            )}
            <Button variant="ghost" onClick={() => void onOpen()}>
              <FolderSearch /> Open folder
            </Button>
            <Button onClick={() => void create()} disabled={creating}>
              <Plus /> New project{' '}
              <Kbd className="bg-primary-foreground/15 text-primary-foreground ml-1">⌘N</Kbd>
            </Button>
          </motion.header>

          {projects && projects.length === 0 && (
            <Empty className="mt-16">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Clapperboard />
                </EmptyMedia>
                <EmptyTitle>Start your first edit</EmptyTitle>
                <EmptyDescription>
                  Cutroom keeps projects in ~/.cutroom. Make one, drop footage in, and tell the
                  agent what you want.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={() => void create()} disabled={creating}>
                  <Plus /> New project
                </Button>
              </EmptyContent>
            </Empty>
          )}

          <div className="mt-8 grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-x-5 gap-y-7">
            <AnimatePresence>
              {shown.map((p, i) => (
                <motion.div
                  key={p.dir}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.35, delay: Math.min(i, 12) * 0.03, ease }}
                  className="group/card"
                >
                  <button className="w-full text-left" onClick={() => void onOpen(p.dir)}>
                    <div className="transition-transform duration-300 ease-out group-hover/card:-translate-y-0.5">
                      <Cover p={p} />
                    </div>
                  </button>
                  <div className="mt-2.5 flex items-start gap-2">
                    <button className="min-w-0 flex-1 text-left" onClick={() => void onOpen(p.dir)}>
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{p.name}</span>
                        {!p.owned && (
                          <Badge variant="outline" className="h-4 px-1 text-[10px]">
                            <FolderOpen className="size-2.5" /> folder
                          </Badge>
                        )}
                      </span>
                      {p.description && (
                        <span className="text-muted-foreground mt-0.5 line-clamp-2 block text-xs">
                          {p.description}
                        </span>
                      )}
                      <span className="text-muted-foreground mt-1 block text-[11px]">
                        {ago(p.updated)} · {p.mediaCount} media
                      </span>
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="opacity-0 transition-opacity group-hover/card:opacity-100 data-[state=open]:opacity-100"
                          aria-label="Project actions"
                        >
                          <Ellipsis />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setEditing(p)}>
                          <Pencil /> Rename and describe
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void window.api.reveal(p.dir)}>
                          <FolderOpen /> Show in Finder
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => void remove(p)}>
                          <Trash2 /> {p.owned ? 'Move to Trash' : 'Remove from list'}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      </div>
      <EditDialog project={editing} onClose={() => setEditing(null)} onSaved={load} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}
