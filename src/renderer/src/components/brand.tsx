import { siClaude } from 'simple-icons'
import { SquareCode } from 'lucide-react'
import logo from '@/assets/logo.svg'
import type { AgentKind } from '@shared/ipc'
import { cn } from '@/lib/utils'

export function AgentIcon({
  kind,
  className
}: {
  kind: AgentKind
  className?: string
}): React.JSX.Element {
  if (kind === 'claude')
    return (
      <svg
        viewBox="0 0 24 24"
        className={cn('size-4', className)}
        fill={`#${siClaude.hex}`}
        aria-hidden
      >
        <path d={siClaude.path} />
      </svg>
    )
  if (kind === 'codex') return <SquareCode className={cn('size-4', className)} aria-hidden />
  return (
    <span
      className={cn(
        'inline-flex size-4 items-center justify-center font-serif text-[1.05em] leading-none italic',
        className
      )}
      aria-hidden
    >
      π
    </span>
  )
}

export const AGENT_LABEL: Record<AgentKind, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  pi: 'Pi'
}

export function CutroomMark({ className }: { className?: string }): React.JSX.Element {
  return <img src={logo} alt="Cutroom" draggable={false} className={cn('inline-block size-9 select-none', className)} />
}
