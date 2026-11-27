import { useState } from 'react'
import { Check, CircleAlert, Copy, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { AgentKind } from '@shared/ipc'

export function CopyCommand({ text }: { text: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className="bg-muted hover:bg-muted/70 group/cmd flex max-w-full items-center gap-2 rounded-md px-2 py-1 font-mono text-[11px] transition-colors"
          onClick={(e) => {
            e.stopPropagation()
            void navigator.clipboard.writeText(text)
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1400)
          }}
        >
          <span className="truncate">{text}</span>
          {copied ? (
            <Check className="size-3 shrink-0 text-emerald-500" />
          ) : (
            <Copy className="size-3 shrink-0 opacity-60" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent>{copied ? 'Copied' : 'Copy'}</TooltipContent>
    </Tooltip>
  )
}

export function SignInCard({
  name,
  kind,
  command,
  onRetry
}: {
  name: string
  kind: AgentKind
  command?: string
  onRetry?: () => void
}): React.JSX.Element {
  return (
    <div className="bg-muted/40 flex flex-col gap-2.5 rounded-xl border p-3 text-sm">
      <div className="flex gap-2">
        <CircleAlert className="text-muted-foreground mt-0.5 size-4 shrink-0" />
        <div className="flex flex-col gap-1">
          <span className="font-medium">
            Sign in to {name}
            {kind !== 'pi' && ' CLI'}
          </span>
          <span className="text-muted-foreground text-xs leading-relaxed">
            {kind === 'pi'
              ? 'Cutroom uses your Pi CLI login. Click Sign in, then type /login in Pi.'
              : `Cutroom needs you signed into ${name} CLI on this computer. Being signed into the ChatGPT or Claude web app is not enough. Click Sign in or run the command below in a terminal, then complete the browser login opened by the CLI.`}{' '}
            Wait for the terminal to confirm login succeeded, then return to Cutroom. You can close
            the terminal afterward.
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-6">
        <Button size="sm" onClick={() => void window.api.openLogin(kind)}>
          Sign in <ExternalLink />
        </Button>
        {onRetry && (
          <Button size="sm" variant="ghost" onClick={onRetry}>
            Retry
          </Button>
        )}
        <CopyCommand
          text={
            command ??
            (kind === 'claude' ? 'claude auth login' : kind === 'codex' ? 'codex login' : 'pi')
          }
        />
      </div>
    </div>
  )
}
