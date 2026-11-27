import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, ArrowRight, Check, FolderOpen, FolderPlus, KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { AgentInfo, AgentKind, Settings } from '@shared/ipc'
import { AgentIcon, CutroomMark } from '@/components/brand'
import { ThemeToggle } from '@/components/theme-toggle'
import { SkillsPanel } from '@/components/skills-panel'
import { CopyCommand, SignInCard } from '@/components/sign-in-card'
import { VideoDbConnect } from './videodb-connect'
import { cn } from '@/lib/utils'

const STEPS = ['VideoDB', 'Agent', 'Skills', 'Ready'] as const
const ease = [0.22, 1, 0.36, 1] as const

function Steps({ step }: { step: number }): React.JSX.Element {
  return (
    <ol className="flex w-full items-center gap-2">
      {STEPS.map((label, i) => (
        <li key={label} className={cn('flex items-center gap-2', i < STEPS.length - 1 && 'flex-1')}>
          <span
            className={cn(
              'flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap transition-colors duration-300',
              i <= step ? 'text-foreground' : 'text-muted-foreground'
            )}
          >
            <span
              className={cn(
                'relative flex size-5 items-center justify-center rounded-full border text-[10px] font-medium transition-colors duration-300',
                i < step && 'bg-primary text-primary-foreground border-primary',
                i === step && 'border-foreground'
              )}
            >
              <AnimatePresence mode="wait" initial={false}>
                {i < step ? (
                  <motion.span
                    key="c"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                  >
                    <Check className="size-3" strokeWidth={3} />
                  </motion.span>
                ) : (
                  <motion.span key="n" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    {i + 1}
                  </motion.span>
                )}
              </AnimatePresence>
            </span>
            {label}
          </span>
          {i < STEPS.length - 1 && (
            <span className="bg-border relative h-px min-w-4 flex-1 overflow-hidden">
              <motion.span
                className="bg-foreground absolute inset-0 origin-left"
                animate={{ scaleX: i < step ? 1 : 0 }}
                transition={{ duration: 0.4, ease }}
              />
            </span>
          )}
        </li>
      ))}
    </ol>
  )
}

function AccountStep({ onDone }: { onDone: () => void }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-5">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Connect VideoDB</h1>
        <p className="text-muted-foreground text-sm">
          Sign in securely through your browser. Your footage is uploaded, transcribed, searched and
          rendered through the VideoDB account you choose.
        </p>
      </div>
      <VideoDbConnect onConnected={onDone} />
    </div>
  )
}

function AgentStep({
  initial,
  onBack,
  onDone
}: {
  initial: AgentKind
  onBack: () => void
  onDone: (k: AgentKind) => void
}): React.JSX.Element {
  const [agents, setAgents] = useState<AgentInfo[] | null>(null)
  const [pick, setPick] = useState<AgentKind | null>(null)

  const detect = (): void => {
    setAgents(null)
    void window.api.detectAgents().then((list: AgentInfo[]) => {
      setAgents(list)
      const usable = list.filter((a) => a.usable)
      setPick((p) => p ?? (usable.find((a) => a.kind === initial) ?? usable[0])?.kind ?? null)
    })
  }
  useEffect(detect, [initial])

  const picked = agents?.find((a) => a.kind === pick)
  const needsLogin = picked?.signedIn === false
  // Sign-in happens in a terminal and the browser; re-check when the user comes back.
  useEffect(() => {
    if (!needsLogin || !pick) return
    const recheck = (): void =>
      void window.api
        .signedIn(pick)
        .then((ok: boolean | undefined) =>
          setAgents((list) =>
            list ? list.map((a) => (a.kind === pick ? { ...a, signedIn: ok } : a)) : list
          )
        )
    window.addEventListener('focus', recheck)
    return () => window.removeEventListener('focus', recheck)
  }, [needsLogin, pick])

  return (
    <div className="flex flex-col gap-5">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Pick your agent</h1>
        <p className="text-muted-foreground text-sm">
          Install and sign into Codex CLI or Claude Code CLI on this computer, or use Pi. A login to
          the ChatGPT or Claude web app does not connect your agent to Cutroom. You can switch
          agents any time.
        </p>
      </div>
      <div role="radiogroup" className="flex flex-col gap-2">
        {(agents ?? [{ kind: 'claude' }, { kind: 'codex' }, { kind: 'pi' }]).map((a, i) => {
          const info = agents ? (a as AgentInfo) : null
          const selected = pick === a.kind
          return (
            <motion.button
              key={a.kind}
              role="radio"
              aria-checked={selected}
              disabled={!info?.usable}
              onClick={() => info?.usable && setPick(a.kind)}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06, duration: 0.3, ease }}
              className={cn(
                'relative flex items-center gap-3 rounded-xl border p-3 text-left transition-[border-color,background-color,opacity] duration-200',
                selected ? 'border-foreground bg-muted/40' : 'hover:bg-muted/30',
                info && !info.usable && 'cursor-default'
              )}
            >
              <span
                className={cn(
                  'bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg transition-opacity',
                  info && !info.usable && 'opacity-50'
                )}
              >
                <AgentIcon kind={a.kind} className="size-5" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex items-center gap-2 text-sm font-medium">
                  {info?.name ?? ' '}
                  {!info && (
                    <span className="bg-muted relative h-3 w-20 overflow-hidden rounded">
                      <span className="animate-shimmer absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-foreground/10 to-transparent" />
                    </span>
                  )}
                  {info?.installed && info.version && (
                    <Badge variant="secondary" className="font-mono text-[10px]">
                      v{info.version}
                    </Badge>
                  )}
                  {info && !info.installed && <Badge variant="outline">Not installed</Badge>}
                  {info?.installed && !info.usable && (
                    <Badge variant="outline">Update needed</Badge>
                  )}
                  {info?.usable && info.signedIn === false && (
                    <Badge variant="outline">Not signed in</Badge>
                  )}
                </span>
                {info?.note && <CopyCommand text={info.note.replace(/^.*Update: /, '')} />}
                {info?.note?.startsWith('Needs') && (
                  <span className="text-muted-foreground text-xs">
                    {info.note.split('. Update')[0]}.
                  </span>
                )}
              </span>
              <span
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors',
                  selected && 'border-foreground bg-foreground'
                )}
              >
                <AnimatePresence>
                  {selected && (
                    <motion.span
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      exit={{ scale: 0 }}
                      className="bg-background size-1.5 rounded-full"
                    />
                  )}
                </AnimatePresence>
              </span>
            </motion.button>
          )
        })}
      </div>
      <AnimatePresence>
        {needsLogin && picked && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <SignInCard name={picked.name} kind={picked.kind} command={picked.login} />
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft /> Back
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={detect} disabled={!agents}>
            Re-check
          </Button>
          <Button onClick={() => pick && onDone(pick)} disabled={!pick || needsLogin}>
            Continue <ArrowRight />
          </Button>
        </div>
      </div>
    </div>
  )
}

function SkillsStep({
  onBack,
  onDone
}: {
  onBack: () => void
  onDone: () => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-5">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Teach it VideoDB</h1>
        <p className="text-muted-foreground text-sm">
          Editing works out of the box. The VideoDB skills let the agent go further when you ask:
          search your whole library, reframe, dub, generate music or voice.
        </p>
      </div>
      <SkillsPanel />
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft /> Back
        </Button>
        <Button onClick={onDone}>
          Continue <ArrowRight />
        </Button>
      </div>
    </div>
  )
}

function ReadyStep({
  agent,
  onBack,
  onFinish
}: {
  agent: AgentKind
  onBack: () => void
  onFinish: () => void
}): React.JSX.Element {
  const lines = [
    { icon: <KeyRound className="size-4" />, text: 'VideoDB connected' },
    {
      icon: <AgentIcon kind={agent} />,
      text: `${agent === 'claude' ? 'Claude Code' : agent === 'codex' ? 'Codex' : 'Pi'} will edit your timelines`
    },
    {
      icon: <FolderOpen className="size-4" />,
      text: 'Projects live in ~/.cutroom; no folders to manage'
    }
  ]
  return (
    <div className="flex flex-col gap-5">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">You’re set</h1>
        <p className="text-muted-foreground text-sm">
          Make a folder for your first edit, drop footage in, and tell the agent what you want.
        </p>
      </div>
      <ul className="flex flex-col gap-2.5">
        {lines.map((l, i) => (
          <motion.li
            key={i}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 + i * 0.08, duration: 0.3, ease }}
            className="flex items-center gap-3 text-sm"
          >
            <span className="bg-muted flex size-8 items-center justify-center rounded-lg">
              {l.icon}
            </span>
            {l.text}
          </motion.li>
        ))}
      </ul>
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft /> Back
        </Button>
        <Button onClick={onFinish}>
          <FolderPlus /> Create my first project
        </Button>
      </div>
    </div>
  )
}

export function Onboarding({
  settings,
  onFinish
}: {
  settings: Settings
  onFinish: (s: Settings) => void
}): React.JSX.Element {
  const [step, setStep] = useState(0)
  const [dir, setDir] = useState(1)
  const [agent, setAgent] = useState<AgentKind>(settings.agent)

  const go = (n: number): void => {
    setDir(n > step ? 1 : -1)
    setStep(n)
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div className="drag flex h-11 shrink-0 items-center justify-end px-3 win:pr-36">
        <div className="no-drag">
          <ThemeToggle />
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center px-6 pb-16">
        <div className="w-full max-w-[440px]">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease }}
            className="mb-10 flex flex-col gap-7"
          >
            <div className="flex items-center gap-2.5">
              <CutroomMark className="size-8" />
              <span className="font-semibold tracking-tight">Cutroom</span>
            </div>
            <Steps step={step} />
          </motion.div>
          <AnimatePresence mode="wait" custom={dir} initial={false}>
            <motion.div
              key={step}
              custom={dir}
              variants={{
                enter: (d: number) => ({ opacity: 0, x: d * 28 }),
                center: { opacity: 1, x: 0 },
                exit: (d: number) => ({ opacity: 0, x: d * -28 })
              }}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.28, ease }}
            >
              {step === 0 && <AccountStep onDone={() => go(1)} />}
              {step === 1 && (
                <AgentStep
                  initial={agent}
                  onBack={() => go(0)}
                  onDone={(k) => {
                    setAgent(k)
                    void window.api.settings.set({ agent: k })
                    go(2)
                  }}
                />
              )}
              {step === 2 && <SkillsStep onBack={() => go(1)} onDone={() => go(3)} />}
              {step === 3 && (
                <ReadyStep
                  agent={agent}
                  onBack={() => go(2)}
                  onFinish={() => void window.api.settings.set({ onboarded: true }).then(onFinish)}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
