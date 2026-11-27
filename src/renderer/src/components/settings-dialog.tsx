import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { AgentInfo, AgentKind } from '@shared/ipc'
import { AGENT_LABEL, AgentIcon } from '@/components/brand'
import { VideoDbConnect } from './videodb-connect'
import { SkillsPanel } from '@/components/skills-panel'

export function SettingsDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
}): React.JSX.Element {
  const [agent, setAgent] = useState<AgentKind>('claude')
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const { theme, setTheme } = useTheme()

  useEffect(() => {
    if (!open) return
    setError('')
    void window.api.settings.get().then((s) => {
      setAgent(s.agent)
    })
    void window.api.detectAgents().then(setAgents)
  }, [open])

  const save = async (): Promise<void> => {
    setSaving(true)
    setError('')
    try {
      await window.api.settings.set({ agent })
      toast.success('Settings saved', { description: 'The next agent session uses them.' })
      onOpenChange(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Account, agent and appearance.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5">
          <div className="grid gap-2">
            <Label>VideoDB account</Label>
            <VideoDbConnect
              onConnected={() => {
                setError('')
                toast.success('VideoDB account connected')
              }}
            />
            <p className="text-muted-foreground text-xs">
              Signing in changes the connected account immediately.
            </p>
          </div>
          <div className="grid gap-2">
            <Label>Agent</Label>
            <Select value={agent} onValueChange={(v) => setAgent(v as AgentKind)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['claude', 'codex', 'pi'] as AgentKind[]).map((k) => {
                  const info = agents.find((a) => a.kind === k)
                  return (
                    <SelectItem key={k} value={k} disabled={!!info && !info.usable}>
                      <AgentIcon kind={k} />
                      {AGENT_LABEL[k]}
                      <span className="text-muted-foreground ml-auto pl-3 font-mono text-[11px]">
                        {!info
                          ? ''
                          : info.usable
                            ? info.signedIn === false
                              ? 'not signed in'
                              : `v${info.version}`
                            : info.installed
                              ? 'update needed'
                              : 'not installed'}
                      </span>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs leading-relaxed">
              Cutroom uses your local CLI login. For Codex, run <code>codex login</code>; for Claude
              Code, run <code>claude auth login</code> in a terminal. Signing into the web apps
              alone is not enough. You can close the terminal after login.
            </p>
          </div>
          <div className="grid gap-2">
            <Label>VideoDB skills</Label>
            <SkillsPanel compact />
          </div>
          <div className="grid gap-2">
            <Label>Appearance</Label>
            <ToggleGroup
              type="single"
              variant="outline"
              value={theme}
              onValueChange={(v) => v && setTheme(v)}
              className="w-full"
            >
              <ToggleGroupItem value="light" className="flex-1">
                <Sun /> Light
              </ToggleGroupItem>
              <ToggleGroupItem value="dark" className="flex-1">
                <Moon /> Dark
              </ToggleGroupItem>
              <ToggleGroupItem value="system" className="flex-1">
                <Monitor /> System
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
        {error && (
          <p role="alert" className="text-destructive text-xs">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <Spinner /> : <Check />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
