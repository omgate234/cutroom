import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import { Check, CircleAlert, ExternalLink, KeyRound, Monitor, Moon, Sun } from 'lucide-react'
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
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
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
import { SkillsPanel } from '@/components/skills-panel'

export function SettingsDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
}): React.JSX.Element {
  const [apiKey, setApiKey] = useState('')
  const [agent, setAgent] = useState<AgentKind>('claude')
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const { theme, setTheme } = useTheme()

  useEffect(() => {
    if (!open) return
    setError('')
    void window.api.settings.get().then((s) => {
      setApiKey(s.apiKey)
      setAgent(s.agent)
    })
    void window.api.detectAgents().then(setAgents)
  }, [open])

  const save = async (): Promise<void> => {
    setSaving(true)
    const r = await window.api.settings.validateKey(apiKey)
    setSaving(false)
    if (!r.ok) return setError(r.error)
    await window.api.settings.set({ apiKey: apiKey.trim(), agent })
    toast.success('Settings saved', { description: 'The next agent session uses them.' })
    onOpenChange(false)
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
            <Label htmlFor="apikey">VideoDB API key</Label>
            <InputGroup>
              <InputGroupAddon>
                {error ? <CircleAlert className="text-destructive" /> : <KeyRound />}
              </InputGroupAddon>
              <InputGroupInput
                id="apikey"
                type="password"
                className="font-mono"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value)
                  setError('')
                }}
                onKeyDown={(e) => e.key === 'Enter' && void save()}
              />
            </InputGroup>
            {error ? (
              <p className="text-destructive text-xs">{error}</p>
            ) : (
              <button
                className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1 text-xs"
                onClick={() => void window.api.openExternal('https://console.videodb.io')}
              >
                console.videodb.io <ExternalLink className="size-3" />
              </button>
            )}
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
                            ? `v${info.version}`
                            : info.installed
                              ? 'update needed'
                              : 'not installed'}
                      </span>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
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
