import { useState } from 'react'
import { toast } from 'sonner'
import { Check, History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { AgentStatus, SessionInfo } from '@shared/ipc'
import { AGENT_LABEL } from '@/components/brand'
import { ago, errMsg } from '@/lib/format'

// Past sessions of the running agent in this project folder (ACP session/list); picking one loads
// it with its transcript (session/load).
export function SessionHistory({
  status,
  disabled
}: {
  status: AgentStatus
  disabled?: boolean
}): React.JSX.Element | null {
  const [list, setList] = useState<SessionInfo[] | null>(null)
  if (status.state !== 'ready' || !status.canList) return null

  const refresh = (): void => {
    setList(null)
    void window.api.agent
      .listSessions()
      .then((l: SessionInfo[]) => setList(l))
      .catch((e: unknown) => {
        setList([])
        toast.error(errMsg(e))
      })
  }

  return (
    <DropdownMenu onOpenChange={(o) => o && refresh()}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label="Past sessions" disabled={disabled}>
              <History />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Past sessions</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
          {AGENT_LABEL[status.kind]} sessions in this project
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {list === null ? (
          <div className="flex justify-center py-4">
            <Spinner />
          </div>
        ) : list.length === 0 ? (
          <p className="text-muted-foreground px-2 py-3 text-xs">No earlier sessions.</p>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            {list.map((s) => {
              const current = s.sessionId === status.sessionId
              return (
                <DropdownMenuItem
                  key={s.sessionId}
                  disabled={!status.canLoad}
                  onSelect={() => {
                    if (!current)
                      void window.api.agent
                        .loadSession(s.sessionId)
                        .catch((e: unknown) => toast.error(errMsg(e)))
                  }}
                  className="flex items-start gap-2"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-xs">{s.title || 'Untitled session'}</span>
                    {s.updatedAt && (
                      <span className="text-muted-foreground text-[10px]">{ago(s.updatedAt)}</span>
                    )}
                  </span>
                  {current && <Check className="mt-0.5 size-3.5 shrink-0" />}
                </DropdownMenuItem>
              )
            })}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
