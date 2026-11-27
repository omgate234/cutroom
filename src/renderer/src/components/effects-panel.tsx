import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  MOTION_PRESETS,
  EASINGS,
  EFFECTS,
  motionPreset,
  type Motion,
  type Lut
} from '@shared/effects'
import type { TimelineClipBody } from '@shared/timeline'

const label = (s: string): string => s.replaceAll('_', ' ')
export function EffectsPanel({
  body,
  patch,
  timelineLut,
  setTimelineLut
}: {
  body: TimelineClipBody
  patch: (p: Partial<TimelineClipBody>) => void
  timelineLut?: Lut
  setTimelineLut: (lut?: Lut) => void
}): React.JSX.Element {
  const motion = (body.motion ?? {}) as Motion
  const [uploading, setUploading] = useState(false)
  const [scope, setScope] = useState<'clip' | 'timeline'>('clip')
  const lut = scope === 'clip' ? (body.lut as Lut | undefined) : timelineLut
  const setLut = useCallback(
    (v?: Lut): void => {
      if (scope === 'clip') patch({ lut: v })
      else setTimelineLut(v)
    },
    [scope, patch, setTimelineLut]
  )
  const currentSetter = useRef(setLut)
  const mounted = useRef(true)
  useEffect(() => {
    currentSetter.current = setLut
  }, [setLut])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const setMotion = (value: Motion): void =>
    patch({
      motion: Object.values(value).some(Boolean) ? value : undefined,
      effect: undefined,
      transition: undefined
    })
  return (
    <>
      <section className="grid gap-3" aria-label="Motion and effects">
        <h3 className="text-xs font-medium">Motion and effects</h3>
        {(['enter', 'exit'] as const).map((edge) => (
          <div key={edge} className="grid gap-2">
            <label className="grid gap-1 text-xs">
              {edge === 'enter' ? 'Entrance' : 'Exit'}
              <select
                className="bg-background rounded border p-2 capitalize"
                value={motion[edge]?.preset ?? ''}
                onChange={(e) =>
                  setMotion({
                    ...motion,
                    [edge]: e.target.value
                      ? motionPreset(
                          e.target.value as (typeof MOTION_PRESETS)[number],
                          Math.min(0.4, body.duration / 2)
                        )
                      : undefined
                  })
                }
              >
                <option value="">None</option>
                {MOTION_PRESETS.map((p) => (
                  <option key={p} value={p}>
                    {label(p)}
                  </option>
                ))}
              </select>
            </label>
            {motion[edge] && (
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-xs">
                  Duration (s)
                  <Input
                    type="number"
                    min={0.05}
                    max={Math.min(10, body.duration)}
                    step={0.05}
                    value={motion[edge].duration}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      if (Number.isFinite(n) && n > 0 && n <= Math.min(10, body.duration))
                        setMotion({ ...motion, [edge]: { ...motion[edge], duration: n } })
                    }}
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  Easing
                  <select
                    className="bg-background rounded border p-2"
                    value={motion[edge].easing}
                    onChange={(e) =>
                      setMotion({
                        ...motion,
                        [edge]: { ...motion[edge], easing: e.target.value }
                      } as Motion)
                    }
                  >
                    {EASINGS.map((p) => (
                      <option key={p} value={p}>
                        {label(p)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </div>
        ))}
        <label className="grid gap-1 text-xs">
          Continuous effect
          <select
            className="bg-background rounded border p-2"
            value={String(body.effect ?? '')}
            onChange={(e) => patch({ effect: e.target.value || undefined, motion: undefined })}
          >
            <option value="">None</option>
            {EFFECTS.map((p) => (
              <option key={p} value={p}>
                {label(p)}
              </option>
            ))}
          </select>
        </label>
        <p className="text-muted-foreground text-[11px]">
          Choosing motion replaces fades and continuous effects. Preview the rendered result before
          exporting.
        </p>
      </section>
      <section className="grid gap-2" aria-label="Colour grade">
        <h3 className="text-xs font-medium">Colour grade · 3D LUT</h3>
        <label className="grid gap-1 text-xs">
          Apply to
          <select
            className="bg-background rounded border p-2"
            value={scope}
            disabled={uploading}
            onChange={(e) => setScope(e.target.value as typeof scope)}
          >
            <option value="clip">Selected clip</option>
            <option value="timeline">Whole timeline</option>
          </select>
        </label>
        <Button
          size="sm"
          variant="outline"
          disabled={uploading}
          onClick={async () => {
            setUploading(true)
            try {
              const result = await window.api.project.importLut()
              if (result && mounted.current) currentSetter.current(result)
            } catch (e) {
              toast.error((e as Error).message)
            } finally {
              setUploading(false)
            }
          }}
        >
          {uploading ? 'Uploading…' : lut ? 'Replace .cube file' : 'Import .cube file'}
        </Button>
        {lut && (
          <>
            <label className="grid gap-1 text-xs">
              Intensity · {Math.round(lut.intensity * 100)}%
              <input
                aria-label="LUT intensity"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={lut.intensity}
                onChange={(e) => setLut({ ...lut, intensity: Number(e.target.value) })}
              />
            </label>
            <Button size="sm" variant="ghost" onClick={() => setLut(undefined)}>
              Remove grade
            </Button>
          </>
        )}
        <p className="text-muted-foreground text-[11px]">
          3D .cube, size 2–65. Timeline grades are applied beneath captions. The file is uploaded to
          your connected VideoDB account.
        </p>
      </section>
    </>
  )
}
