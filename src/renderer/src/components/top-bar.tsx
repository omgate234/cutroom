import { useState } from 'react'
import { toast } from 'sonner'
import { Download, FolderOpen, History, House, Settings2, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Spinner } from '@/components/ui/spinner'
import { Separator } from '@/components/ui/separator'
import { SettingsDialog } from '@/components/settings-dialog'
import { ThemeToggle } from '@/components/theme-toggle'
import type { ProjectApi } from '@/hooks/use-project'
import type { ProjectState } from '@shared/ipc'
import { timelineDuration } from '@shared/timeline'
import { errMsg, tc } from '@/lib/format'

function IconButton({
  label,
  onClick,
  children,
  disabled
}: {
  label: string
  onClick?: () => void
  children: React.ReactNode
  disabled?: boolean
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function InlineName({
  value,
  onSave
}: {
  value: string
  onSave: (v: string) => void
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const commit = (): void => {
    setEditing(false)
    if (draft.trim() && draft.trim() !== value) onSave(draft.trim())
    else setDraft(value)
  }
  if (editing)
    return (
      <input
        autoFocus
        className="bg-muted/60 focus:ring-ring/40 h-7 w-56 rounded-md px-2 text-sm font-medium outline-none focus:ring-2"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') {
            setDraft(value)
            setEditing(false)
          }
        }}
      />
    )
  return (
    <button
      className="hover:bg-muted/60 h-7 max-w-72 truncate rounded-md px-2 text-sm font-medium transition-colors"
      title="Rename"
      onClick={() => {
        setDraft(value)
        setEditing(true)
      }}
    >
      {value}
    </button>
  )
}

export function TopBar({
  api,
  project
}: {
  api: ProjectApi
  project: ProjectState
}): React.JSX.Element {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  const exportVideo = async (): Promise<void> => {
    setExporting(true)
    try {
      const r = (await window.api.project.export()) as Record<string, unknown>
      const url = (r.downloadUrl ?? r.download_url ?? r.url) as string | undefined
      if (url) {
        toast.success('Export ready', {
          action: { label: 'Download', onClick: () => void window.api.openExternal(url) }
        })
      } else toast.success('Export requested', { description: JSON.stringify(r).slice(0, 200) })
    } catch (e) {
      toast.error('Export failed', { description: errMsg(e) })
    } finally {
      setExporting(false)
    }
  }

  return (
    <header className="drag flex h-11 shrink-0 items-center gap-2 border-b pr-2 pl-20">
      <div className="no-drag flex min-w-0 items-center gap-1.5">
        <IconButton label="All projects" onClick={api.close}>
          <House />
        </IconButton>
        <span className="text-muted-foreground">/</span>
        <InlineName value={project.name} onSave={(name) => void api.rename({ name })} />
        <span className="text-muted-foreground font-mono text-xs tabular-nums">
          {tc(timelineDuration(project.timeline))}
        </span>
      </div>
      <div className="flex-1" />
      <div className="no-drag flex items-center gap-0.5">
        <IconButton
          label="Undo last change"
          onClick={() => void window.api.project.undo().catch((e) => toast.error(errMsg(e)))}
        >
          <Undo2 />
        </IconButton>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="History">
                  <History />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>History</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel>Timeline checkpoints</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {api.history.length === 0 && (
              <DropdownMenuItem disabled>No checkpoints yet</DropdownMenuItem>
            )}
            {api.history.map((c, i) => (
              <DropdownMenuItem
                key={c.hash}
                disabled={i === 0}
                onSelect={() =>
                  void window.api.project.restore(c.hash).catch((e) => toast.error(errMsg(e)))
                }
              >
                <span className="min-w-0 flex-1 truncate">{c.message}</span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {i === 0
                    ? 'current'
                    : new Date(c.date).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <IconButton label="Show project folder" onClick={() => void window.api.project.reveal()}>
          <FolderOpen />
        </IconButton>
        <ThemeToggle />
        <IconButton label="Settings" onClick={() => setSettingsOpen(true)}>
          <Settings2 />
        </IconButton>
        <Separator orientation="vertical" className="mx-1.5 h-5" />
        <Button size="sm" onClick={() => void exportVideo()} disabled={exporting}>
          {exporting ? <Spinner /> : <Download />} Export
        </Button>
      </div>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </header>
  )
}
