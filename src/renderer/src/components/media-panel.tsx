import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import {
  AtSign,
  AudioLines,
  Film,
  ImageIcon,
  Link2,
  ListPlus,
  MoreHorizontal,
  Plus,
  Upload
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Spinner } from '@/components/ui/spinner'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle
} from '@/components/ui/item'
import type { ProjectState } from '@shared/ipc'
import type { MediaItem, Timeline, TimelineClip } from '@shared/timeline'
import { timelineDuration } from '@shared/timeline'
import type { ProjectApi } from '@/hooks/use-project'
import { frameAt, frameStyle } from '@/lib/sprite'
import { errMsg, tc } from '@/lib/format'

const KIND_ICON = { video: Film, audio: AudioLines, image: ImageIcon }

function StatusBadge({ m }: { m: MediaItem }): React.JSX.Element | null {
  if (m.status === 'uploading')
    return (
      <Badge variant="secondary">
        <Spinner className="size-3" /> Uploading
      </Badge>
    )
  if (m.status === 'indexing')
    return (
      <Badge variant="secondary">
        <Spinner className="size-3" /> Indexing
      </Badge>
    )
  if (m.status === 'failed') return <Badge variant="destructive">Failed</Badge>
  if (m.error) return <Badge variant="outline">Not searchable</Badge>
  return null
}

// Hovering scrubs through the video's sprite sheet; falls back to the poster.
function ScrubThumb({ m }: { m: MediaItem }): React.JSX.Element {
  const [pos, setPos] = useState<number | null>(null)
  const Icon = KIND_ICON[m.kind]
  const f =
    m.sprite && m.duration
      ? pos !== null
        ? frameAt(m.sprite, pos * m.duration)
        : !m.thumbnail
          ? frameAt(m.sprite, m.duration * 0.1)
          : null
      : null
  return (
    <div
      className="bg-muted relative h-10 w-16 shrink-0 overflow-hidden rounded-md"
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        setPos(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)))
      }}
      onMouseLeave={() => setPos(null)}
    >
      {f && m.sprite ? (
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2"
          style={frameStyle(m.sprite, f, 40)}
        />
      ) : m.thumbnail ? (
        <img src={m.thumbnail} alt="" className="size-full object-cover" />
      ) : (
        <div className="flex size-full items-center justify-center">
          <Icon className="text-muted-foreground size-4" />
        </div>
      )}
      {m.status === 'uploading' && (
        <div className="bg-background/40 absolute inset-0 overflow-hidden">
          <span className="animate-shimmer via-foreground/15 absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent to-transparent" />
        </div>
      )}
      {pos !== null && m.sprite && (
        <span
          className="absolute bottom-0 left-0 h-0.5 bg-red-500"
          style={{ width: `${pos * 100}%` }}
        />
      )}
    </div>
  )
}

function appendToMain(t: Timeline, m: MediaItem): Timeline {
  const tracks = t.tracks.length
    ? t.tracks.map((x) => ({ ...x, clips: [...x.clips] }))
    : [{ name: 'main', clips: [] }]
  const main = tracks[0]
  const start = main.clips.reduce((e, c) => Math.max(e, c.start + c.clip.duration), 0)
  const used = new Set(tracks.flatMap((x) => x.clips.map((c) => c.id)))
  let n = main.clips.length + 1
  while (used.has(`c${n}`)) n++
  const clip: TimelineClip = {
    id: `c${n}`,
    start,
    clip: {
      duration: m.kind === 'image' ? 5 : Math.round((m.duration ?? 5) * 100) / 100,
      asset: m.kind === 'image' ? { type: 'image', id: m.id } : { type: m.kind, id: m.id, start: 0 }
    }
  }
  main.clips.push(clip)
  return { ...t, tracks }
}

export function MediaPanel({
  project,
  api,
  onMention
}: {
  project: ProjectState
  api: ProjectApi
  onMention: (text: string) => void
}): React.JSX.Element {
  const [dragging, setDragging] = useState(false)
  const [urlOpen, setUrlOpen] = useState(false)
  const [url, setUrl] = useState('')
  const media = project.assets.media

  const importPaths = (paths: string[]): void => {
    if (!paths.length) return
    window.api.project
      .importPaths(paths)
      .catch((e) => toast.error('Import failed', { description: errMsg(e) }))
  }

  const importUrl = (): void => {
    const u = url.trim()
    if (!u) return
    setUrlOpen(false)
    setUrl('')
    window.api.project
      .importUrl(u)
      .catch((e) => toast.error('Import failed', { description: errMsg(e) }))
  }

  return (
    <div
      className="relative flex h-full flex-col"
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        importPaths([...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter(Boolean))
      }}
    >
      <AnimatePresence>
        {dragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="bg-background/80 pointer-events-none absolute inset-2 z-30 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed backdrop-blur-sm"
          >
            <motion.span
              initial={{ y: 6 }}
              animate={{ y: [6, -2, 6] }}
              transition={{ repeat: Infinity, duration: 1.4 }}
            >
              <Upload className="size-5" />
            </motion.span>
            <span className="text-sm font-medium">Drop to import</span>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex h-10 shrink-0 items-center justify-between px-3">
        <span className="text-sm font-medium">Media</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="xs">
              <Plus /> Import
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() =>
                void window.api.project.importFiles().catch((e) => toast.error(errMsg(e)))
              }
            >
              <Upload /> Files…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setUrlOpen(true)}>
              <Link2 /> From URL…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {media.length === 0 ? (
        <Empty className="flex-1 border-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Upload />
            </EmptyMedia>
            <EmptyTitle className="text-sm">Drop footage here</EmptyTitle>
            <EmptyDescription className="text-xs">
              Video, audio or images. Each video is transcribed and described so the agent can
              search it.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ScrollArea className="min-h-0 flex-1 [&_[data-radix-scroll-area-viewport]>div]:!block">
          <ItemGroup className="gap-1 px-2 pb-3">
            {media.map((m, i) => (
              <motion.div
                key={m.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.3,
                  delay: Math.min(i, 8) * 0.03,
                  ease: [0.22, 1, 0.36, 1]
                }}
              >
                <Item size="sm" className="hover:bg-muted/50 group/media px-1.5 py-1.5">
                  <ItemMedia className="self-center">
                    <ScrubThumb m={m} />
                  </ItemMedia>
                  <ItemContent className="min-w-0 gap-0.5">
                    <ItemTitle className="w-full truncate text-xs" title={m.name}>
                      {m.name}
                    </ItemTitle>
                    <ItemDescription className="flex items-center gap-1.5 text-xs">
                      <span className="font-mono tabular-nums">
                        {m.kind === 'image' ? 'image' : tc(m.duration)}
                      </span>
                      <StatusBadge m={m} />
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="opacity-0 transition-opacity group-hover/media:opacity-100 data-[state=open]:opacity-100"
                          disabled={m.status === 'uploading' || m.status === 'failed'}
                        >
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => void api.writeTimeline(appendToMain(project.timeline, m))}
                        >
                          <ListPlus /> Add to timeline
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onMention(`media ${m.id} ("${m.name}")`)}>
                          <AtSign /> Reference in chat
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </ItemActions>
                </Item>
              </motion.div>
            ))}
          </ItemGroup>
          <p className="text-muted-foreground px-3 pb-3 text-xs">
            {media.length} item{media.length === 1 ? '' : 's'} · timeline{' '}
            {tc(timelineDuration(project.timeline))}
          </p>
        </ScrollArea>
      )}

      <Dialog open={urlOpen} onOpenChange={setUrlOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Import from URL</DialogTitle>
            <DialogDescription>A direct media link or a YouTube URL.</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && importUrl()}
          />
          <DialogFooter>
            <Button onClick={importUrl}>Import</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
