import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, CircleDashed, Download, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import type { AgentInfo, AgentKind, SkillScope } from '@shared/ipc'
import { AGENT_LABEL, AgentIcon } from '@/components/brand'
import { cn } from '@/lib/utils'

// Per-harness status of the global VideoDB skills, with one install/update action for all usable agents.
export function SkillsPanel({ compact }: { compact?: boolean }): React.JSX.Element {
  const [status, setStatus] = useState<SkillScope[] | null>(null)
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [busy, setBusy] = useState(false)

  const refresh = (): void => {
    void window.api.skills.status().then(setStatus)
  }
  useEffect(() => {
    refresh()
    void window.api.detectAgents().then(setAgents)
  }, [])

  const installed = (k: AgentKind): boolean => agents.some((a) => a.kind === k && a.installed)
  const targets = (status ?? []).filter((s) => installed(s.agent))
  const allDone = targets.length > 0 && targets.every((s) => s.missing.length === 0)

  const install = async (): Promise<void> => {
    setBusy(true)
    const r = await window.api.skills.install(targets.map((t) => t.agent))
    setBusy(false)
    refresh()
    if (r.ok) toast.success('VideoDB skills installed', { description: r.output })
    else toast.error('Could not install skills', { description: r.output })
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className={cn('flex flex-col', compact ? 'gap-1' : 'gap-2')}>
        {(['claude', 'codex', 'pi'] as AgentKind[]).map((k, i) => {
          const s = status?.find((x) => x.agent === k)
          const present = installed(k)
          const ok = !!s && s.missing.length === 0
          return (
            <motion.li
              key={k}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className={cn(
                'flex items-center gap-3 rounded-lg',
                compact ? 'py-1' : 'border px-3 py-2.5',
                !present && 'opacity-50'
              )}
            >
              <AgentIcon kind={k} className="size-4" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm">{AGENT_LABEL[k]}</span>
                <span className="text-muted-foreground block truncate font-mono text-[11px]">
                  {s?.dir ?? ' '}
                </span>
              </span>
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={!s ? 'load' : ok ? 'ok' : present ? 'missing' : 'na'}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className={cn(
                    'flex items-center gap-1.5 text-xs',
                    ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'
                  )}
                >
                  {!s ? (
                    <Spinner className="size-3" />
                  ) : ok ? (
                    <>
                      <Check className="size-3.5" /> {s.installed.length} skill{s.installed.length === 1 ? "" : "s"}
                    </>
                  ) : present ? (
                    <>
                      <CircleDashed className="size-3.5" /> Not installed
                    </>
                  ) : (
                    'Agent not installed'
                  )}
                </motion.span>
              </AnimatePresence>
            </motion.li>
          )
        })}
      </ul>
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs">
          From{' '}
          <button
            className="hover:text-foreground underline underline-offset-2"
            onClick={() => void window.api.openExternal('https://github.com/video-db/skills')}
          >
            video-db/skills
          </button>
          . Lets the agent use all of VideoDB: search, reframe, dub, generate.
        </p>
        <Button
          size="sm"
          variant={allDone ? 'outline' : 'default'}
          onClick={() => void install()}
          disabled={busy || !targets.length}
        >
          {busy ? <Spinner /> : allDone ? <RefreshCw /> : <Download />}
          {busy ? 'Installing' : allDone ? 'Update' : 'Install'}
        </Button>
      </div>
    </div>
  )
}
