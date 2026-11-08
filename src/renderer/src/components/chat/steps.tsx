import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Brain,
  Check,
  ChevronRight,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDot,
  Clapperboard,
  Download,
  FilePen,
  FileText,
  FolderInput,
  Globe,
  Images,
  Library,
  ListChecks,
  ListTodo,
  ScanSearch,
  Scissors,
  Search,
  ShieldQuestion,
  Shuffle,
  Terminal,
  Trash2,
  Wrench,
  X,
  type LucideIcon
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { PermissionAsk } from '@shared/ipc'
import { cn } from '@/lib/utils'

export type Block = { type: string; text?: string; data?: string; mimeType?: string }
export type ToolContent =
  | { type: 'content'; content: Block }
  | { type: 'diff'; path: string; oldText?: string | null; newText: string }
  | { type: 'terminal'; terminalId: string }

export interface ToolItem {
  type: 'tool'
  id: string
  title: string
  kind?: string | null
  status?: string | null
  rawInput?: unknown
  content: ToolContent[]
}

// One fixed vocabulary: ACP tool kinds, then the VideoDB tools (MCP or the vdb CLI) by name.
const KIND_ICON: Record<string, LucideIcon> = {
  read: FileText,
  edit: FilePen,
  delete: Trash2,
  move: FolderInput,
  search: Search,
  execute: Terminal,
  think: Brain,
  fetch: Globe,
  switch_mode: Shuffle,
  other: Wrench
}

const VDB: Record<string, { icon: LucideIcon; label: string }> = {
  list_media: { icon: Library, label: 'List media' },
  list: { icon: Library, label: 'List media' },
  search_footage: { icon: ScanSearch, label: 'Search footage' },
  search: { icon: ScanSearch, label: 'Search footage' },
  get_frames: { icon: Images, label: 'Look at frames' },
  frames: { icon: Images, label: 'Look at frames' },
  validate_timeline: { icon: ListChecks, label: 'Validate timeline' },
  validate: { icon: ListChecks, label: 'Validate timeline' },
  compile_timeline: { icon: Clapperboard, label: 'Render preview' },
  compile: { icon: Clapperboard, label: 'Render preview' },
  inspect_cuts: { icon: Scissors, label: 'Inspect cuts' },
  cuts: { icon: Scissors, label: 'Inspect cuts' },
  export_video: { icon: Download, label: 'Export video' },
  export: { icon: Download, label: 'Export video' }
}

export function describeTool(t: Pick<ToolItem, 'title' | 'kind' | 'rawInput'>): {
  icon: LucideIcon
  label: string
  detail?: string
  videodb: boolean
} {
  const mcp = t.title.match(/mcp__videodb__(\w+)|^videodb[_.:\s]+(\w+)/i)
  const name = mcp?.[1] ?? mcp?.[2]
  if (name && VDB[name]) return { ...VDB[name], videodb: true }
  const cmd =
    typeof (t.rawInput as { command?: unknown })?.command === 'string'
      ? (t.rawInput as { command: string }).command
      : t.title
  const cli = cmd.match(/\.cutroom\/bin\/vdb\s+(\w+)(.*)/)
  if (cli && VDB[cli[1]])
    return { ...VDB[cli[1]], detail: cli[2].trim() || undefined, videodb: true }
  const icon = KIND_ICON[t.kind ?? 'other'] ?? Wrench
  const clean = t.title.replace(/`/g, '').trim()
  if (t.kind === 'execute') return { icon, label: 'Run command', detail: clean, videodb: false }
  return { icon, label: clean || 'Tool', videodb: false }
}

function diffStat(c: Extract<ToolContent, { type: 'diff' }>): string {
  const a = (c.oldText ?? '').split('\n')
  const b = c.newText.split('\n')
  const setA = new Set(a)
  const setB = new Set(b)
  return `+${b.filter((l) => !setA.has(l)).length} −${a.filter((l) => !setB.has(l)).length}`
}

// The shared row frame: icon on a rail, label, trailing status.
function StepRow({
  icon: Icon,
  status,
  last,
  children,
  trailing,
  open
}: {
  icon: LucideIcon
  status: 'running' | 'done' | 'failed' | 'idle'
  last?: boolean
  children: React.ReactNode
  trailing?: React.ReactNode
  open?: boolean
}): React.JSX.Element {
  return (
    <div className="relative flex w-full items-center gap-2.5 py-1 text-left text-xs">
      {!last && <span className="bg-border absolute top-7 bottom-[-6px] left-[11px] w-px" />}
      <span
        className={cn(
          'bg-background relative z-10 flex size-[23px] shrink-0 items-center justify-center rounded-full border transition-colors duration-300',
          status === 'running' && 'border-foreground/40',
          status === 'failed' && 'border-destructive/50 text-destructive'
        )}
      >
        <Icon className="size-3" />
        {status === 'running' && (
          <span className="border-t-foreground absolute inset-[-1px] animate-spin rounded-full border border-transparent" />
        )}
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 truncate',
          status === 'running' ? 'text-foreground' : 'text-foreground/85'
        )}
      >
        {children}
      </span>
      {trailing}
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={status}
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-muted-foreground inline-flex"
        >
          {status === 'done' && <Check className="size-3.5" />}
          {status === 'failed' && <X className="text-destructive size-3.5" />}
        </motion.span>
      </AnimatePresence>
      {open !== undefined && (
        <ChevronRight
          className={cn(
            'text-muted-foreground size-3.5 transition-transform duration-200',
            open && 'rotate-90'
          )}
        />
      )}
    </div>
  )
}

const toStatus = (s?: string | null): 'running' | 'done' | 'failed' =>
  s === 'completed' ? 'done' : s === 'failed' ? 'failed' : 'running'

export function ToolStep({ t, last }: { t: ToolItem; last?: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const d = describeTool(t)
  const images = t.content.flatMap((c) =>
    c.type === 'content' && c.content.type === 'image' && c.content.data ? [c.content] : []
  )
  const texts = t.content.flatMap((c) =>
    c.type === 'content' && c.content.type === 'text' ? [c.content.text ?? ''] : []
  )
  const diffs = t.content.filter(
    (c): c is Extract<ToolContent, { type: 'diff' }> => c.type === 'diff'
  )

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="animate-rise">
      <CollapsibleTrigger className="hover:bg-muted/40 -mx-1 w-[calc(100%+0.5rem)] rounded-md px-1">
        <StepRow
          icon={d.icon}
          status={toStatus(t.status)}
          last={last && !images.length}
          open={open}
          trailing={diffs.map((x, i) => (
            <span key={i} className="text-muted-foreground font-mono text-[10px]">
              {diffStat(x)}
            </span>
          ))}
        >
          {d.label}
          {d.detail && (
            <span className="text-muted-foreground ml-1.5 font-mono text-[11px]">{d.detail}</span>
          )}
        </StepRow>
      </CollapsibleTrigger>
      {images.length > 0 && (
        <div className="relative pl-[34px]">
          {!last && <span className="bg-border absolute top-0 bottom-0 left-[11px] w-px" />}
          <div className="grid grid-cols-3 gap-1 pt-0.5 pb-1.5">
            {images.slice(0, 9).map((im, i) => (
              <motion.img
                key={i}
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.04 }}
                src={`data:${im.mimeType ?? 'image/jpeg'};base64,${im.data}`}
                className="aspect-video w-full rounded-sm object-cover"
              />
            ))}
          </div>
        </div>
      )}
      <CollapsibleContent className="data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0">
        <div className="selectable bg-muted/50 mb-1.5 ml-[34px] max-h-60 overflow-auto rounded-md p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
          {t.rawInput !== undefined && t.rawInput !== null && (
            <div className="text-muted-foreground">{JSON.stringify(t.rawInput, null, 2)}</div>
          )}
          {texts.map((x, i) => (
            <div key={i} className="mt-1.5">
              {x.length > 4000 ? `${x.slice(0, 4000)}…` : x}
            </div>
          ))}
          {diffs.map((x, i) => (
            <div key={i} className="mt-1.5">
              {x.path}
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function ThoughtStep({
  text,
  live,
  last
}: {
  text: string
  live: boolean
  last?: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="animate-rise">
      <CollapsibleTrigger className="hover:bg-muted/40 -mx-1 w-[calc(100%+0.5rem)] rounded-md px-1">
        <StepRow icon={Brain} status={live ? 'running' : 'done'} last={last} open={open}>
          {live ? 'Thinking' : 'Thought'}
          {!open && (
            <span className="text-muted-foreground ml-1.5 italic">
              {text.replace(/\s+/g, ' ').slice(0, 90)}
            </span>
          )}
        </StepRow>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="selectable text-muted-foreground mb-1.5 ml-[34px] text-xs leading-relaxed whitespace-pre-wrap italic">
          {text}
        </p>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function PlanStep({
  entries,
  last
}: {
  entries: { content: string; status: string }[]
  last?: boolean
}): React.JSX.Element {
  const done = entries.filter((e) => e.status === 'completed').length
  return (
    <div className="animate-rise">
      <StepRow icon={ListTodo} status={done === entries.length ? 'done' : 'running'} last={last}>
        Plan{' '}
        <span className="text-muted-foreground ml-1 font-mono text-[11px]">
          {done}/{entries.length}
        </span>
      </StepRow>
      <ul className="relative ml-[34px] space-y-1 pb-1.5 text-xs">
        {entries.map((e, j) => {
          const Icon =
            e.status === 'completed' ? CircleCheck : e.status === 'in_progress' ? CircleDot : Circle
          return (
            <li
              key={j}
              className={cn(
                'flex items-start gap-2 transition-colors duration-300',
                e.status === 'completed' && 'text-muted-foreground line-through',
                e.status === 'pending' && 'text-muted-foreground'
              )}
            >
              <Icon className="mt-px size-3.5 shrink-0" />
              {e.content}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function PermissionStep({
  ask,
  answer,
  onAnswer,
  last
}: {
  ask: PermissionAsk
  answer?: string
  onAnswer: (optionId: string | null) => void
  last?: boolean
}): React.JSX.Element {
  const d = describeTool({ title: ask.title, kind: ask.kind, rawInput: ask.rawInput })
  return (
    <div className="animate-rise">
      <StepRow icon={ShieldQuestion} status={answer ? 'done' : 'idle'} last={last}>
        {answer ? (
          <>
            {d.label} <span className="text-muted-foreground ml-1">· {answer}</span>
          </>
        ) : (
          <>Allow {d.label.toLowerCase()}?</>
        )}
      </StepRow>
      {!answer && (
        <div className="ml-[34px] flex flex-col gap-2 pb-2">
          {d.detail && (
            <code className="bg-muted/60 rounded-md px-2 py-1 font-mono text-[11px] break-all">
              {d.detail}
            </code>
          )}
          <div className="flex flex-wrap gap-1.5">
            {ask.options.map((o) => (
              <Button
                key={o.optionId}
                size="xs"
                variant={
                  o.kind === 'allow_once'
                    ? 'default'
                    : o.kind.startsWith('reject')
                      ? 'ghost'
                      : 'outline'
                }
                onClick={() => onAnswer(o.optionId)}
              >
                {o.name}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function ErrorStep({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="animate-rise border-destructive/30 bg-destructive/5 text-destructive flex gap-2 rounded-lg border px-3 py-2 text-xs">
      <CircleAlert className="mt-px size-3.5 shrink-0" />
      <span className="selectable">{text}</span>
    </div>
  )
}

export { Spinner }
