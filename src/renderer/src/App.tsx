import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AnimatePresence, motion } from 'motion/react'
import type { Settings } from '@shared/ipc'
import { useProject } from '@/hooks/use-project'
import { Onboarding } from '@/components/onboarding'
import { Welcome } from '@/components/welcome'
import { Workspace } from '@/components/workspace'

export default function App(): React.JSX.Element {
  const p = useProject()
  const [settings, setSettings] = useState<Settings | null>(null)

  useEffect(() => {
    void window.api.settings.get().then(setSettings)
  }, [])

  const { open } = p
  useEffect(
    () =>
      window.api.on(
        'agent:background-done',
        (r: { dir: string; name: string; stopReason: string }) =>
          toast(`${r.name}: the agent ${r.stopReason === 'end_turn' ? 'finished' : 'stopped'}`, {
            action: { label: 'Open', onClick: () => void open(r.dir) }
          })
      ),
    [open]
  )

  const screen = !settings
    ? 'loading'
    : !settings.onboarded
      ? 'onboarding'
      : p.project
        ? 'workspace'
        : 'home'

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={screen === 'workspace' ? `ws:${p.project?.dir}` : screen}
        className="h-full"
        initial={{ opacity: 0, scale: 0.985 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 1.01 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      >
        {screen === 'onboarding' && settings && (
          <Onboarding
            settings={settings}
            onFinish={(s) => {
              setSettings(s)
              void p.create()
            }}
          />
        )}
        {screen === 'home' && <Welcome onOpen={p.open} onCreate={p.create} />}
        {screen === 'workspace' && p.project && <Workspace api={p} project={p.project} />}
      </motion.div>
    </AnimatePresence>
  )
}
