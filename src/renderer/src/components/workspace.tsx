import { useCallback, useRef, useState } from 'react'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import type { ProjectState } from '@shared/ipc'
import type { ProjectApi } from '@/hooks/use-project'
import { TopBar } from '@/components/top-bar'
import { MediaPanel } from '@/components/media-panel'
import { Player } from '@/components/player'
import { TimelineView } from '@/components/timeline-view'
import { ChatPanel } from '@/components/chat-panel'

export function Workspace({
  api,
  project
}: {
  api: ProjectApi
  project: ProjectState
}): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [time, setTime] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ text: string; n: number } | null>(null)

  const seek = useCallback((t: number) => {
    const v = videoRef.current
    if (v && Number.isFinite(v.duration)) v.currentTime = Math.min(t, v.duration)
    setTime(t)
  }, [])

  const mention = useCallback((text: string) => setDraft((d) => ({ text, n: (d?.n ?? 0) + 1 })), [])

  return (
    <div className="flex h-full flex-col">
      <TopBar api={api} project={project} />
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="19" minSize={220}>
          <MediaPanel project={project} api={api} onMention={mention} />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize="53" minSize={420}>
          <ResizablePanelGroup orientation="vertical">
            <ResizablePanel defaultSize="62" minSize={200}>
              <Player
                ref={videoRef}
                compile={api.compile}
                timeline={project.timeline}
                onTime={setTime}
              />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize="38" minSize={150}>
              <TimelineView
                project={project}
                time={time}
                onSeek={seek}
                selected={selected}
                onSelect={setSelected}
                onChange={api.writeTimeline}
                onMention={mention}
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize="28" minSize={320}>
          <ChatPanel project={project} draft={draft} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
