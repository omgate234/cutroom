import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowUp,
  AudioLines,
  CircleAlert,
  File as FileIcon,
  Film,
  ImageIcon,
  Paperclip,
  SquarePen,
  Scissors,
  Smartphone,
  Square,
  X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea
} from '@/components/ui/input-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { AgentKind, AgentSnapshot, AgentStatus, Attachment, ProjectState } from '@shared/ipc'
import { EMPTY_CHAT, isStep, reduceChat, type ChatState, type SeqEvent } from '@shared/chat'
import { SessionHistory } from '@/components/chat/session-history'
import { AGENT_LABEL, AgentIcon } from '@/components/brand'
import { AgentControls } from '@/components/chat/agent-controls'
import { SignInCard } from '@/components/sign-in-card'
import { ErrorStep, PermissionStep, PlanStep, ThoughtStep, ToolStep } from '@/components/chat/steps'
import { cn } from '@/lib/utils'
import { errMsg } from '@/lib/format'

const STARTERS = [
  { icon: Film, text: 'Make a 30 second highlight of the best moments, with captions.' },
  { icon: Scissors, text: 'Tighten this: remove silences, filler words and false starts.' },
  { icon: Smartphone, text: 'Cut a vertical short for Reels from the strongest moment.' }
]

interface Attached {
  a: Attachment
  preview?: string
}

function AttachmentIcon({
  mime,
  className
}: {
  mime: string
  className?: string
}): React.JSX.Element {
  const Icon = mime.startsWith('video/')
    ? Film
    : mime.startsWith('audio/')
      ? AudioLines
      : mime.startsWith('image/')
        ? ImageIcon
        : FileIcon
  return <Icon className={className} />
}

const fmtSize = (n: number): string =>
  n > 1e9
    ? `${(n / 1e9).toFixed(1)} GB`
    : n > 1e6
      ? `${(n / 1e6).toFixed(1)} MB`
      : `${Math.max(1, Math.round(n / 1e3))} KB`

function Chip({ f, onRemove }: { f: Attached; onRemove?: () => void }): React.JSX.Element {
  return (
    <motion.span
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className="bg-muted group/chip flex max-w-52 items-center gap-1.5 rounded-md py-1 pr-1.5 pl-1 text-xs"
      title={f.a.path}
    >
      {f.preview ? (
        <img src={f.preview} className="size-6 shrink-0 rounded object-cover" />
      ) : (
        <span className="bg-background flex size-6 shrink-0 items-center justify-center rounded">
          <AttachmentIcon mime={f.a.mime} className="size-3.5" />
        </span>
      )}
      <span className="min-w-0 truncate">{f.a.name}</span>
      <span className="text-muted-foreground shrink-0 font-mono text-[10px]">
        {fmtSize(f.a.size)}
      </span>
      {onRemove && (
        <button
          className="text-muted-foreground hover:text-foreground shrink-0"
          onClick={onRemove}
          aria-label="Remove"
        >
          <X className="size-3" />
        </button>
      )}
    </motion.span>
  )
}

export function ChatPanel({
  project,
  draft
}: {
  project: ProjectState
  draft: { text: string; n: number } | null
}): React.JSX.Element {
  const [status, setStatus] = useState<AgentStatus>({ state: 'off' })
  const [chat, setChat] = useState<ChatState>(EMPTY_CHAT)
  const { items, running } = chat
  const [input, setInput] = useState('')
  const [kind, setKind] = useState<AgentKind>('claude')
  const bottomRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)

  // The transcript lives in the main process. Live events that race the snapshot are buffered and
  // replayed past its seq, so nothing is lost or applied twice.
  const sync = useRef<{ seq: number; ready: boolean; buffer: SeqEvent[] }>({
    seq: 0,
    ready: false,
    buffer: []
  })
  useEffect(() => {
    sync.current = { seq: 0, ready: false, buffer: [] }
    const offs = [
      window.api.on('agent:status', (s: AgentStatus) => {
        setStatus(s)
        if (s.state !== 'off') setKind(s.kind)
      }),
      window.api.on('agent:event', (e: SeqEvent) => {
        const st = sync.current
        if (!st.ready) return void st.buffer.push(e)
        if (e.seq <= st.seq) return
        st.seq = e.seq
        setChat((c) => reduceChat(c, e))
      })
    ]
    void window.api.agent
      .attach()
      .then((snap: AgentSnapshot) => {
        const st = sync.current
        let c = snap.chat
        st.seq = snap.seq
        for (const e of st.buffer.sort((x, y) => x.seq - y.seq))
          if (e.seq > st.seq) {
            c = reduceChat(c, e)
            st.seq = e.seq
          }
        st.buffer = []
        st.ready = true
        setChat(c)
        setStatus(snap.status)
        if (snap.status.state !== 'off') setKind(snap.status.kind)
      })
      .catch((e: unknown) => toast.error(errMsg(e)))
    return () => offs.forEach((off) => off())
  }, [project.dir])

  useEffect(() => {
    if (!draft) return
    setInput((v) => (v ? `${v.trimEnd()} ${draft.text} ` : `${draft.text} `))
    textRef.current?.focus()
  }, [draft])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [items, running])

  const start = (k: AgentKind): void => {
    setKind(k)
    void window.api.agent.start(k).catch((e) => toast.error(errMsg(e)))
  }

  // After signing in elsewhere, coming back to the window restarts the agent once it is signed in.
  const loginKind = status.state === 'error' && status.needsLogin ? status.kind : null
  useEffect(() => {
    if (!loginKind) return
    const recheck = (): void =>
      void window.api.signedIn(loginKind).then((ok: boolean | undefined) => {
        if (ok) start(loginKind)
      })
    window.addEventListener('focus', recheck)
    return () => window.removeEventListener('focus', recheck)
  }, [loginKind])

  const [files, setFiles] = useState<Attached[]>([])
  const [dropping, setDropping] = useState(false)

  const addPaths = async (paths: string[]): Promise<void> => {
    const list: Attachment[] = await window.api.attach.paths(paths)
    setFiles((f) => [
      ...f,
      ...list.filter((a) => !f.some((x) => x.a.path === a.path)).map((a) => ({ a }))
    ])
  }

  // Finder copies carry real paths; screenshots and copied images are bytes, saved into the project first.
  const addFiles = async (list: File[]): Promise<void> => {
    const withPath = list.map((f) => [f, window.api.pathForFile(f)] as const)
    await addPaths(withPath.filter(([, p]) => p).map(([, p]) => p))
    for (const [f] of withPath.filter(([, p]) => !p)) {
      const bytes = new Uint8Array(await f.arrayBuffer())
      const name =
        f.name && f.name !== 'image.png' ? f.name : `pasted-${Date.now().toString(36)}.png`
      const a: Attachment = await window.api.attach.save(name, bytes, f.type || 'image/png')
      setFiles((x) => [
        ...x,
        { a, preview: f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined }
      ])
    }
  }

  const send = (text: string): void => {
    const t = text.trim() || (files.length ? 'See the attached files.' : '')
    if (!t || running || status.state !== 'ready') return
    setInput('')
    setFiles([])
    void window.api.agent
      .prompt(
        t,
        files.map((f) => f.a)
      )
      .catch((e: unknown) => toast.error(errMsg(e)))
  }

  const answer = (requestId: string, optionId: string | null): void =>
    void window.api.agent.reply(requestId, optionId)

  const ready = status.state === 'ready'

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <AgentIcon kind={kind} className="size-3.5" />
        <span className="text-sm font-medium">{AGENT_LABEL[kind]}</span>
        <span className="relative flex size-1.5">
          {status.state === 'starting' && (
            <span className="absolute inset-0 animate-ping rounded-full bg-amber-500/70" />
          )}
          <span
            className={cn(
              'relative size-1.5 rounded-full transition-colors duration-500',
              status.state === 'ready' && 'bg-emerald-500',
              status.state === 'starting' && 'bg-amber-500',
              (status.state === 'error' || status.state === 'off') && 'bg-muted-foreground/40'
            )}
          />
        </span>
        <span className="text-muted-foreground truncate text-xs">
          {status.state === 'starting'
            ? 'Starting…'
            : status.state === 'error'
              ? 'Not running'
              : status.state === 'off'
                ? 'Off'
                : ''}
        </span>
        <div className="flex-1" />
        <SessionHistory status={status} disabled={running} />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="New session"
              disabled={running || !ready}
              onClick={() =>
                void window.api.agent.newSession().catch((e: unknown) => toast.error(errMsg(e)))
              }
            >
              <SquarePen />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New session</TooltipContent>
        </Tooltip>
      </div>

      <ScrollArea className="min-h-0 flex-1 [&_[data-radix-scroll-area-viewport]>div]:!block">
        <div className="flex flex-col gap-2.5 p-3">
          <AnimatePresence>
            {status.state === 'error' && status.needsLogin && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <SignInCard
                  name={AGENT_LABEL[status.kind]}
                  kind={status.kind}
                  onRetry={() => start(status.kind)}
                />
              </motion.div>
            )}
            {status.state === 'error' && !status.needsLogin && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="border-destructive/30 bg-destructive/5 text-destructive flex gap-2 overflow-hidden rounded-lg border px-3 py-2 text-xs"
              >
                <CircleAlert className="mt-px size-3.5 shrink-0" />
                <span className="selectable">{status.error}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {items.length === 0 && ready && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
              className="flex flex-col gap-3 pt-6"
            >
              <div className="flex flex-col items-center gap-2 pb-2 text-center">
                <span className="bg-muted flex size-10 items-center justify-center rounded-xl">
                  <AgentIcon kind={kind} className="size-5" />
                </span>
                <p className="text-muted-foreground max-w-64 text-xs leading-relaxed">
                  {AGENT_LABEL[kind]} reads the transcripts, searches your footage, edits the
                  timeline and checks its own cuts.
                </p>
              </div>
              {STARTERS.map(({ icon: Icon, text }, i) => (
                <motion.button
                  key={text}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.08 + i * 0.05 }}
                  className="hover:bg-muted/60 text-foreground/80 hover:text-foreground flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors"
                  onClick={() => send(text)}
                >
                  <Icon className="text-muted-foreground mt-px size-3.5 shrink-0" />
                  {text}
                </motion.button>
              ))}
            </motion.div>
          )}

          {items.map((it, i) => {
            const last = !items[i + 1] || !isStep(items[i + 1])
            switch (it.type) {
              case 'user':
                return (
                  <div
                    key={i}
                    className="animate-rise bg-muted selectable ml-8 self-end rounded-2xl rounded-br-md px-3 py-2 text-sm break-words whitespace-pre-wrap"
                  >
                    {it.files?.length ? (
                      <span className="mb-1.5 flex flex-wrap gap-1">
                        {it.files.map((a) => (
                          <Chip key={a.path} f={{ a }} />
                        ))}
                      </span>
                    ) : null}
                    {it.text}
                  </div>
                )
              case 'agent':
                return (
                  <div
                    key={i}
                    className="md selectable animate-rise min-w-0 px-0.5 text-sm leading-relaxed break-words"
                  >
                    <Markdown remarkPlugins={[remarkGfm]}>{it.text}</Markdown>
                  </div>
                )
              case 'thought':
                return (
                  <ThoughtStep
                    key={i}
                    text={it.text}
                    live={running && i === items.length - 1}
                    last={last}
                  />
                )
              case 'tool':
                return <ToolStep key={it.id} t={it} last={last} />
              case 'plan':
                return <PlanStep key={i} entries={it.entries} last={last} />
              case 'permission':
                return (
                  <PermissionStep
                    key={it.ask.requestId}
                    ask={it.ask}
                    answer={it.answer}
                    last={last}
                    onAnswer={(o) => answer(it.ask.requestId, o)}
                  />
                )
              case 'error':
                return <ErrorStep key={i} text={it.text} />
            }
          })}

          <AnimatePresence>
            {running && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="relative w-fit overflow-hidden px-0.5 text-xs"
              >
                <span className="text-muted-foreground">Working</span>
                <span className="animate-shimmer via-background/80 absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent to-transparent" />
              </motion.div>
            )}
          </AnimatePresence>
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      <div
        className="relative shrink-0 p-3 pt-0"
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          setDropping(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setDropping(false)
          void addFiles([...e.dataTransfer.files])
        }}
      >
        <AnimatePresence>
          {dropping && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="bg-background/85 pointer-events-none absolute inset-x-3 top-0 bottom-3 z-10 flex items-center justify-center gap-2 rounded-lg border-2 border-dashed text-sm font-medium backdrop-blur-sm"
            >
              <Paperclip className="size-4" /> Attach to message
            </motion.div>
          )}
        </AnimatePresence>
        {/* The group dims for ANY disabled child; only a disabled textarea should dim the composer. */}
        <InputGroup className="has-[textarea:focus]:ring-ring/30 transition-shadow has-disabled:bg-transparent has-disabled:opacity-100 dark:has-disabled:bg-input/30 has-[textarea:disabled]:opacity-50">
          {files.length > 0 && (
            <InputGroupAddon align="block-start" className="flex-wrap gap-1">
              <AnimatePresence initial={false}>
                {files.map((f) => (
                  <Chip
                    key={f.a.path}
                    f={f}
                    onRemove={() => setFiles((x) => x.filter((y) => y.a.path !== f.a.path))}
                  />
                ))}
              </AnimatePresence>
            </InputGroupAddon>
          )}
          <InputGroupTextarea
            onPaste={(e) => {
              const list = [...e.clipboardData.files]
              if (!list.length) return
              e.preventDefault()
              void addFiles(list)
            }}
            ref={textRef}
            rows={3}
            className="max-h-48 min-h-16 text-sm"
            placeholder={ready ? 'Describe the edit…' : 'Waiting for the agent…'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                send(input)
              }
            }}
          />
          <InputGroupAddon align="block-end" className="gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <InputGroupButton
                  size="icon-xs"
                  aria-label="Attach files"
                  onClick={() =>
                    void window.api.attach
                      .pick()
                      .then((list: Attachment[]) =>
                        setFiles((f) => [...f, ...list.map((a) => ({ a }))])
                      )
                  }
                >
                  <Paperclip />
                </InputGroupButton>
              </TooltipTrigger>
              <TooltipContent>Attach files · or paste / drop them</TooltipContent>
            </Tooltip>
            <Select value={kind} onValueChange={(v) => start(v as AgentKind)}>
              <SelectTrigger
                size="sm"
                className="h-6 gap-1 border-0 px-1.5 text-xs shadow-none dark:bg-transparent"
                aria-label="Agent"
              >
                <AgentIcon kind={kind} className="size-3.5" />
              </SelectTrigger>
              <SelectContent position="popper" side="top" align="start">
                {(['claude', 'codex', 'pi'] as AgentKind[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    <AgentIcon kind={k} />
                    {AGENT_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <AgentControls status={status} />
            <div className="flex-1" />
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={running ? 'stop' : 'send'}
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                {running ? (
                  <InputGroupButton
                    size="icon-xs"
                    variant="secondary"
                    aria-label="Stop"
                    onClick={() => void window.api.agent.cancel()}
                  >
                    <Square className="fill-current" />
                  </InputGroupButton>
                ) : (
                  <InputGroupButton
                    size="icon-xs"
                    variant="default"
                    aria-label="Send"
                    disabled={!ready || (!input.trim() && !files.length)}
                    onClick={() => send(input)}
                  >
                    <ArrowUp />
                  </InputGroupButton>
                )}
              </motion.span>
            </AnimatePresence>
          </InputGroupAddon>
        </InputGroup>
      </div>
    </div>
  )
}
