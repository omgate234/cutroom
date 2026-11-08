import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import { AnimatePresence, motion } from 'motion/react'
import { AlertCircle, Clapperboard, Pause, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Spinner } from '@/components/ui/spinner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import type { CompileState } from '@shared/ipc'
import type { Timeline } from '@shared/timeline'
import { timelineDuration } from '@shared/timeline'
import { tc } from '@/lib/format'
import { cn } from '@/lib/utils'

interface Props {
  ref: React.RefObject<HTMLVideoElement | null>
  compile: CompileState
  timeline: Timeline
  onTime: (t: number) => void
}

export function Player({ ref, compile, timeline, onTime }: Props): React.JSX.Element {
  const [stream, setStream] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [swapping, setSwapping] = useState(false)
  const hlsRef = useRef<Hls | null>(null)

  // Keep showing the last good render while a new one compiles or fails.
  useEffect(() => {
    if (compile.state === 'ok') setStream(compile.stream_url)
    if (compile.state === 'idle' && !timeline.tracks.some((t) => t.clips.length)) setStream(null)
  }, [compile, timeline])

  useEffect(() => {
    const video = ref.current
    if (!video || !stream) return
    const resumeAt = video.currentTime
    setSwapping(true)
    hlsRef.current?.destroy()
    if (Hls.isSupported()) {
      const hls = new Hls()
      hls.loadSource(stream)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (resumeAt) video.currentTime = resumeAt
      })
      hlsRef.current = hls
    } else video.src = stream
    return () => {
      hlsRef.current?.destroy()
      hlsRef.current = null
    }
  }, [stream, ref])

  const toggle = (): void => {
    const v = ref.current
    if (!v || !stream) return
    if (v.paused) void v.play()
    else v.pause()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement)?.tagName
      if (e.code === 'Space' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const total = duration || timelineDuration(timeline)

  return (
    <div className="flex h-full flex-col">
      <div className="relative min-h-0 flex-1 bg-neutral-100 dark:bg-black/50">
        <video
          ref={ref}
          className={cn(
            'absolute inset-0 size-full object-contain transition-opacity duration-300',
            swapping && 'opacity-40'
          )}
          onClick={toggle}
          onCanPlay={() => setSwapping(false)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => {
            setTime(e.currentTarget.currentTime)
            onTime(e.currentTarget.currentTime)
          }}
          onDurationChange={(e) =>
            setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)
          }
        />
        {!stream &&
          compile.state !== 'compiling' &&
          compile.state !== 'invalid' &&
          compile.state !== 'error' && (
            <Empty className="absolute inset-0 border-0">
              <EmptyHeader>
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="bg-muted mb-1 flex size-10 items-center justify-center rounded-xl"
                >
                  <Clapperboard className="text-muted-foreground size-5" />
                </motion.div>
                <EmptyTitle className="text-sm">Nothing to preview yet</EmptyTitle>
                <EmptyDescription className="text-xs">
                  Import footage and ask the agent for a cut. Every save to timeline.json renders
                  here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        <AnimatePresence>
          {compile.state === 'compiling' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="bg-foreground/10 absolute inset-x-0 top-0 h-0.5 overflow-hidden">
                <span className="animate-shimmer bg-foreground/70 absolute inset-y-0 w-1/3" />
              </div>
              <motion.div
                initial={{ y: -6 }}
                animate={{ y: 0 }}
                className="bg-background/85 absolute top-3 right-3 flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs shadow-sm backdrop-blur"
              >
                <Spinner className="size-3" /> Rendering preview
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
        {(compile.state === 'invalid' || compile.state === 'error') && (
          <div className="absolute inset-x-3 top-3 max-w-xl">
            <Alert variant="destructive" className="bg-background/95 animate-rise shadow-sm">
              <AlertCircle />
              <AlertTitle>
                {compile.state === 'invalid' ? 'timeline.json has problems' : 'Preview unavailable'}
              </AlertTitle>
              <AlertDescription>
                {compile.state === 'error' ? (
                  <span className="selectable">{compile.error}</span>
                ) : (
                  <ScrollArea className="max-h-32">
                    <ul className="selectable space-y-0.5 font-mono text-xs">
                      {compile.issues.map((i, n) => (
                        <li key={n}>
                          <span className="text-foreground">{i.path || 'timeline'}</span>{' '}
                          {i.message}
                        </li>
                      ))}
                    </ul>
                  </ScrollArea>
                )}
              </AlertDescription>
            </Alert>
          </div>
        )}
      </div>
      <div className="flex h-11 shrink-0 items-center gap-3 border-t px-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={toggle}
          disabled={!stream}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={playing ? 'p' : 'l'}
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.5, opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="inline-flex"
            >
              {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
            </motion.span>
          </AnimatePresence>
        </Button>
        <span className="text-muted-foreground shrink-0 font-mono text-xs whitespace-nowrap tabular-nums">
          {tc(time)} / {tc(total)}
        </span>
        <Slider
          className="flex-1"
          min={0}
          max={total || 1}
          step={0.05}
          value={[Math.min(time, total || 1)]}
          disabled={!stream}
          onValueChange={([v]) => {
            if (ref.current) ref.current.currentTime = v
          }}
        />
      </div>
    </div>
  )
}
