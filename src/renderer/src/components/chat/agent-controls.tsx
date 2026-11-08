import { Brain, Cpu, SlidersHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { InputGroupButton } from '@/components/ui/input-group'
import type { AgentStatus, ConfigChoice, ConfigOption } from '@shared/ipc'
import { errMsg } from '@/lib/format'

const trigger = 'h-6 gap-1 border-0 px-1.5 text-xs shadow-none dark:bg-transparent'

const set = (id: string, value: string | boolean): void => {
  window.api.agent.setConfig(id, value).catch((e) => toast.error(errMsg(e)))
}

// "Default (recommended)" is more useful shown as the model it resolves to.
const label = (c?: ConfigChoice): string =>
  !c
    ? ''
    : c.value === 'default' && c.description && c.description.length < 24
      ? c.description
      : c.name

const isToggle = (o: ConfigOption): boolean =>
  o.type === 'boolean' ||
  (o.options.length === 2 && o.options.every((c) => c.value === 'on' || c.value === 'off'))

const on = (o: ConfigOption): boolean => o.currentValue === true || o.currentValue === 'on'

function OptionSelect({ o, icon }: { o: ConfigOption; icon: React.ReactNode }): React.JSX.Element {
  const current = o.options.find((c) => c.value === o.currentValue)
  return (
    <Select value={String(o.currentValue)} onValueChange={(v) => set(o.id, v)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <SelectTrigger size="sm" className={trigger} aria-label={o.name}>
            {icon}
            <span className="max-w-28 truncate">{label(current)}</span>
          </SelectTrigger>
        </TooltipTrigger>
        <TooltipContent>{o.name}</TooltipContent>
      </Tooltip>
      <SelectContent className="max-h-80">
        {o.options.map((c) => (
          <SelectItem key={c.value} value={c.value}>
            <span className="flex flex-col">
              <span>{c.name}</span>
              {c.description && c.description !== c.name && (
                <span className="text-muted-foreground text-[11px]">{c.description}</span>
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// Model, thinking level, mode and toggles, rendered from whatever the agent advertises over ACP.
export function AgentControls({ status }: { status: AgentStatus }): React.JSX.Element | null {
  if (status.state !== 'ready') return null
  const cfg = status.config
  const model = cfg.find((o) => o.category === 'model' && o.type === 'select')
  const thought = cfg.find((o) => o.category === 'thought_level' && o.type === 'select')
  const mode = cfg.find((o) => o.category === 'mode' && o.type === 'select')
  const toggles = cfg.filter((o) => o.category && o.category !== 'mode' && isToggle(o))
  const modes = mode ? mode.options.map((c) => ({ id: c.value, name: c.name })) : status.modes
  const currentMode = mode ? String(mode.currentValue) : status.currentMode

  return (
    <>
      {model && <OptionSelect o={model} icon={<Cpu className="size-3" />} />}
      {thought && <OptionSelect o={thought} icon={<Brain className="size-3" />} />}
      {(modes.length > 0 || toggles.length > 0) && (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <InputGroupButton size="icon-xs" aria-label="Session options">
                  <SlidersHorizontal />
                </InputGroupButton>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>
              {modes.find((m) => m.id === currentMode)?.name ?? 'Options'}
              {toggles.filter(on).map((t) => ` · ${t.name}`)}
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start" className="w-56">
            {modes.length > 0 && (
              <>
                <DropdownMenuLabel>Permissions</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={currentMode}
                  onValueChange={(v) =>
                    mode
                      ? set(mode.id, v)
                      : void window.api.agent.setMode(v).catch((e) => toast.error(errMsg(e)))
                  }
                >
                  {modes.map((m) => (
                    <DropdownMenuRadioItem key={m.id} value={m.id}>
                      {m.name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </>
            )}
            {toggles.length > 0 && (
              <>
                {modes.length > 0 && <DropdownMenuSeparator />}
                {toggles.map((t) => (
                  <DropdownMenuCheckboxItem
                    key={t.id}
                    checked={on(t)}
                    onCheckedChange={(c) =>
                      set(t.id, t.type === 'boolean' ? !!c : c ? 'on' : 'off')
                    }
                  >
                    <span className="flex flex-col">
                      <span>{t.name}</span>
                      {t.description && (
                        <span className="text-muted-foreground text-[11px]">{t.description}</span>
                      )}
                    </span>
                  </DropdownMenuCheckboxItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  )
}
