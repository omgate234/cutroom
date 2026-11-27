import { useEffect, useState } from 'react'
import { ArrowLeft, Bold, Italic, RotateCcw, Strikethrough, Underline } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Toggle } from '@/components/ui/toggle'
import type { MediaItem, TimelineClip } from '@shared/timeline'
import * as ops from '@shared/timeline-ops'
import type { Editor } from '@/hooks/use-editor'
import { TYPE } from '@/components/timeline/clip-tile'
import {
  CAPTION_ANIMATIONS,
  CAPTION_FONTS,
  CAPTION_PRESETS,
  TEXT_FONTS,
  TEXT_SAMPLES,
  WEIGHT_NAMES,
  assToHex,
  captionPresetPatch,
  hexToAss,
  matchingPreset,
  nearestWeight,
  weightsFor
} from '@shared/style-presets'
import { EffectsPanel } from './effects-panel'
import { cn } from '@/lib/utils'

type A = Record<string, any>

// Clip inspector: replaces the media panel while one clip is selected. Every control writes
// timeline.json through the editor, so each change is one undo step and re-renders the preview.
export function Inspector({
  editor,
  clip: c,
  media,
  onClose
}: {
  editor: Editor
  clip: TimelineClip
  media?: MediaItem
  onClose: () => void
}): React.JSX.Element {
  const { timeline, lengths, commit } = editor
  const a = c.clip.asset as A
  const body = c.clip as A
  const type = a.type as string
  const { icon: Icon } = TYPE[type] ?? TYPE.video
  const visual = type === 'video' || type === 'image'
  const sound = type === 'video' || type === 'audio'

  const setClip = (patch: A, key?: string): void =>
    commit(ops.patchClip(timeline, c.id, patch), key && `${c.id}:${key}`)
  const setAsset = (patch: A, key?: string): void =>
    commit(ops.patchAsset(timeline, c.id, patch), key && `${c.id}:${key}`)
  const setNested = (field: string, patch: A, key?: string): void =>
    setAsset({ [field]: { ...(a[field] ?? {}), ...patch } }, key)
  const fade = ops.fadeOf(c)
  const len = lengths.get(a.id ?? '')

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-2">
        <Button variant="ghost" size="icon-xs" aria-label="Back to media" onClick={onClose}>
          <ArrowLeft />
        </Button>
        <Icon className="text-muted-foreground size-3.5" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {type === 'text' ? 'Text' : type === 'caption' ? 'Captions' : (media?.name ?? a.id)}
        </span>
        <span className="text-muted-foreground font-mono text-[10px]">{c.id}</span>
      </div>
      <ScrollArea className="min-h-0 flex-1 [&_[data-radix-scroll-area-viewport]>div]:!block">
        <div className="flex flex-col gap-5 p-3 pb-6">
          <Section title="Timing">
            <div className="grid grid-cols-2 gap-2">
              <NumField
                label="Start"
                value={c.start}
                min={0}
                onCommit={(v) => commit(ops.setTiming(timeline, c.id, { start: v }, lengths))}
              />
              <NumField
                label="Duration"
                value={c.clip.duration}
                min={ops.MIN_CLIP_DURATION}
                onCommit={(v) => commit(ops.setTiming(timeline, c.id, { duration: v }, lengths))}
              />
              {sound && (
                <NumField
                  label="Source in"
                  value={a.start ?? 0}
                  min={0}
                  max={len}
                  onCommit={(v) =>
                    commit(ops.setTiming(timeline, c.id, { assetStart: v }, lengths))
                  }
                />
              )}
              {type !== 'caption' && (
                <>
                  <NumField
                    label="Fade in"
                    value={fade.in}
                    min={0}
                    max={Math.min(ops.MAX_FADE_DURATION, c.clip.duration)}
                    onCommit={(v) => commit(ops.setFade(timeline, c.id, 'in', v))}
                  />
                  <NumField
                    label="Fade out"
                    value={fade.out}
                    min={0}
                    max={Math.min(ops.MAX_FADE_DURATION, c.clip.duration)}
                    onCommit={(v) => commit(ops.setFade(timeline, c.id, 'out', v))}
                  />
                </>
              )}
            </div>
            {sound && len !== undefined && (
              <p className="text-muted-foreground text-[11px]">Source is {len.toFixed(2)}s long.</p>
            )}
          </Section>

          {visual && (
            <Section
              title="Frame"
              action={
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-muted-foreground"
                  onClick={() =>
                    commit(
                      ops.patchAsset(
                        ops.patchClip(timeline, c.id, {
                          fit: undefined,
                          position: undefined,
                          scale: undefined,
                          offset: undefined,
                          opacity: undefined,
                          filter: undefined
                        }),
                        c.id,
                        { volume: undefined }
                      )
                    )
                  }
                >
                  <RotateCcw /> Reset
                </Button>
              }
            >
              <Row label="Fit">
                <Pick
                  value={body.fit === null ? 'none' : (body.fit ?? 'crop')}
                  options={[
                    ['crop', 'Crop · fill, keep aspect'],
                    ['contain', 'Contain · fit inside'],
                    ['cover', 'Cover · stretch to fill'],
                    ['none', 'None · native size']
                  ]}
                  onChange={(v) => setClip({ fit: v === 'none' ? null : v })}
                />
              </Row>
              <Row label="Position">
                <AnchorPad
                  value={body.position ?? 'center'}
                  names={[
                    'top_left',
                    'top',
                    'top_right',
                    'left',
                    'center',
                    'right',
                    'bottom_left',
                    'bottom',
                    'bottom_right'
                  ]}
                  onChange={(v) => setClip({ position: v })}
                />
              </Row>
              <SliderRow
                label="Scale"
                value={body.scale ?? 1}
                min={0}
                max={4}
                step={0.05}
                fmt={(v) => `${v.toFixed(2)}×`}
                onCommit={(v) => setClip({ scale: v })}
              />
              <SliderRow
                label="Offset x"
                value={body.offset?.x ?? 0}
                min={-1}
                max={1}
                step={0.01}
                fmt={(v) => v.toFixed(2)}
                onCommit={(v) => setClip({ offset: { x: v, y: body.offset?.y ?? 0 } })}
              />
              <SliderRow
                label="Offset y"
                value={body.offset?.y ?? 0}
                min={-1}
                max={1}
                step={0.01}
                fmt={(v) => v.toFixed(2)}
                onCommit={(v) => setClip({ offset: { x: body.offset?.x ?? 0, y: v } })}
              />
              <SliderRow
                label="Opacity"
                value={body.opacity ?? 1}
                min={0}
                max={1}
                step={0.01}
                fmt={(v) => `${Math.round(v * 100)}%`}
                onCommit={(v) => setClip({ opacity: v })}
              />
              <Row label="Filter">
                <Pick
                  value={body.filter ?? 'none'}
                  options={[
                    ['none', 'None'],
                    ...[
                      'blur',
                      'boost',
                      'contrast',
                      'darken',
                      'greyscale',
                      'lighten',
                      'muted',
                      'negative'
                    ].map((f) => [f, f] as [string, string])
                  ]}
                  onChange={(v) => setClip({ filter: v === 'none' ? undefined : v })}
                />
              </Row>
            </Section>
          )}

          {(visual || type === 'text') && (
            <EffectsPanel
              key={c.id}
              body={c.clip}
              patch={setClip}
              timelineLut={timeline.lut}
              setTimelineLut={(lut) => commit({ ...timeline, lut })}
            />
          )}

          {sound && (
            <Section title="Audio">
              <SliderRow
                label="Volume"
                value={a.volume ?? 1}
                min={0}
                max={2}
                step={0.01}
                fmt={(v) => `${Math.round(v * 100)}%`}
                onCommit={(v) => setAsset({ volume: v })}
              />
            </Section>
          )}

          {type === 'text' && <TextPanel a={a} setAsset={setAsset} setNested={setNested} />}
          {type === 'caption' && <CaptionPanel a={a} setAsset={setAsset} setNested={setNested} />}
        </div>
      </ScrollArea>
    </div>
  )
}

// ─── text ──────────────────────────────────────────────────────────────────────
function TextPanel({
  a,
  setAsset,
  setNested
}: {
  a: A
  setAsset: (p: A, key?: string) => void
  setNested: (f: string, p: A, key?: string) => void
}): React.JSX.Element {
  const font = a.font ?? {}
  const family = font.family ?? 'Clear Sans'
  const [draft, setDraft] = useState(a.text ?? '')
  useEffect(() => setDraft(a.text ?? ''), [a.text])
  const align = `${a.alignment?.vertical ?? 'center'}:${a.alignment?.horizontal ?? 'center'}`
  return (
    <>
      <Section title="Text">
        <Textarea
          value={draft}
          rows={3}
          className="text-sm"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => draft.trim() && draft !== a.text && setAsset({ text: draft })}
        />
        <div className="grid grid-cols-2 gap-1.5">
          {TEXT_SAMPLES.map((s) => {
            const on =
              family === s.font && (font.weight ?? 400) === s.weight && font.size === s.size
            return (
              <button
                key={s.key}
                className={cn(
                  'hover:bg-muted truncate rounded-md border px-2 py-1.5 text-left text-sm transition-colors',
                  on && 'border-foreground bg-muted'
                )}
                style={{ fontFamily: s.font, fontWeight: s.weight }}
                onClick={() =>
                  setNested('font', { family: s.font, weight: s.weight, size: s.size })
                }
              >
                {s.key}
              </button>
            )
          })}
        </div>
      </Section>
      <Section title="Font">
        <Row label="Family">
          <Pick
            value={family}
            options={(TEXT_FONTS.includes(family) ? TEXT_FONTS : [family, ...TEXT_FONTS]).map(
              (f) => [f, f]
            )}
            onChange={(f) =>
              setNested('font', { family: f, weight: nearestWeight(f, font.weight ?? 400) })
            }
          />
        </Row>
        <Row label="Weight">
          <Pick
            value={String(font.weight ?? 400)}
            options={weightsFor(family).map((w) => [String(w), WEIGHT_NAMES[w] ?? String(w)])}
            onChange={(w) => setNested('font', { weight: +w })}
          />
        </Row>
        <SliderRow
          label="Size"
          value={font.size ?? 48}
          min={8}
          max={400}
          step={1}
          fmt={(v) => `${v}px`}
          onCommit={(v) => setNested('font', { size: v })}
        />
        <ColorRow
          label="Colour"
          value={font.color ?? '#FFFFFF'}
          onChange={(v) => setNested('font', { color: v }, 'font.color')}
        />
        <SliderRow
          label="Opacity"
          value={font.opacity ?? 1}
          min={0}
          max={1}
          step={0.01}
          fmt={(v) => `${Math.round(v * 100)}%`}
          onCommit={(v) => setNested('font', { opacity: v })}
        />
        <SliderRow
          label="Line spacing"
          value={a.line_spacing ?? 0}
          min={0}
          max={60}
          step={1}
          fmt={(v) => `${v}px`}
          onCommit={(v) => setAsset({ line_spacing: v })}
        />
        <Row label="Align">
          <AnchorPad
            value={align}
            names={[
              'top:left',
              'top:center',
              'top:right',
              'center:left',
              'center:center',
              'center:right',
              'bottom:left',
              'bottom:center',
              'bottom:right'
            ]}
            onChange={(v) => {
              const [vertical, horizontal] = v.split(':')
              setAsset({ alignment: { horizontal, vertical } })
            }}
          />
        </Row>
      </Section>
      <ToggleCard
        title="Background"
        on={!!a.background}
        onToggle={(on) =>
          setAsset({
            background: on
              ? {
                  width: 0,
                  height: 0,
                  color: '#000000',
                  border_width: 20,
                  opacity: 0.6,
                  text_alignment: 'center'
                }
              : undefined
          })
        }
      >
        <ColorRow
          label="Fill"
          value={a.background?.color ?? '#000000'}
          onChange={(v) => setNested('background', { color: v }, 'bg.color')}
        />
        <SliderRow
          label="Opacity"
          value={a.background?.opacity ?? 1}
          min={0}
          max={1}
          step={0.01}
          fmt={(v) => `${Math.round(v * 100)}%`}
          onCommit={(v) => setNested('background', { opacity: v })}
        />
        <SliderRow
          label="Padding"
          value={a.background?.border_width ?? 0}
          min={0}
          max={120}
          step={1}
          fmt={(v) => `${v}px`}
          onCommit={(v) => setNested('background', { border_width: v })}
        />
        <SliderRow
          label="Width"
          value={a.background?.width ?? 0}
          min={0}
          max={3840}
          step={10}
          fmt={(v) => (v ? `${v}px` : 'auto')}
          onCommit={(v) => setNested('background', { width: v })}
        />
        <SliderRow
          label="Height"
          value={a.background?.height ?? 0}
          min={0}
          max={2160}
          step={10}
          fmt={(v) => (v ? `${v}px` : 'auto')}
          onCommit={(v) => setNested('background', { height: v })}
        />
      </ToggleCard>
      <ToggleCard
        title="Outline"
        on={!!a.border}
        onToggle={(on) => setAsset({ border: on ? { color: '#000000', width: 2 } : undefined })}
      >
        <ColorRow
          label="Colour"
          value={a.border?.color ?? '#000000'}
          onChange={(v) => setNested('border', { color: v }, 'border.color')}
        />
        <SliderRow
          label="Width"
          value={a.border?.width ?? 0}
          min={0}
          max={20}
          step={0.5}
          fmt={(v) => `${v}px`}
          onCommit={(v) => setNested('border', { width: v })}
        />
      </ToggleCard>
      <ToggleCard
        title="Shadow"
        on={!!a.shadow}
        onToggle={(on) => setAsset({ shadow: on ? { color: '#000000', x: 3, y: 3 } : undefined })}
      >
        <ColorRow
          label="Colour"
          value={a.shadow?.color ?? '#000000'}
          onChange={(v) => setNested('shadow', { color: v }, 'shadow.color')}
        />
        <SliderRow
          label="Offset x"
          value={a.shadow?.x ?? 0}
          min={0}
          max={40}
          step={1}
          fmt={(v) => `${v}px`}
          onCommit={(v) => setNested('shadow', { x: v })}
        />
        <SliderRow
          label="Offset y"
          value={a.shadow?.y ?? 0}
          min={0}
          max={40}
          step={1}
          fmt={(v) => `${v}px`}
          onCommit={(v) => setNested('shadow', { y: v })}
        />
      </ToggleCard>
    </>
  )
}

// ─── captions ──────────────────────────────────────────────────────────────────
function CaptionPanel({
  a,
  setAsset,
  setNested
}: {
  a: A
  setAsset: (p: A, key?: string) => void
  setNested: (f: string, p: A, key?: string) => void
}): React.JSX.Element {
  const font = a.font ?? {}
  const name = font.font_name ?? 'Clear Sans'
  const preset = matchingPreset(a)
  const primary = assToHex(a.primary_color ?? '&H00FFFFFF')
  const secondary = assToHex(a.secondary_color ?? '&H000000FF')
  const back = assToHex(a.back_color ?? '&H00000000')
  const outline = assToHex(a.border?.outline_color ?? '&H00000000')
  const boxed = a.border?.style === 'opaque_box'
  return (
    <>
      <Section title="Style">
        <div className="grid grid-cols-2 gap-1.5">
          {CAPTION_PRESETS.map((p) => (
            <button
              key={p.key}
              className={cn(
                'hover:bg-muted truncate rounded-md border px-2 py-1.5 text-left text-xs transition-colors',
                preset === p.key && 'border-foreground bg-muted'
              )}
              style={{
                fontFamily: p.config.font.font_name,
                fontWeight: p.config.font.bold ? 700 : 400,
                fontStyle: p.config.font.italic ? 'italic' : undefined
              }}
              onClick={() => setAsset(captionPresetPatch(a, p.config))}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="text-muted-foreground text-[11px] leading-snug">
          Captions transcribe the speech of the video and audio clips beneath them.
        </p>
      </Section>
      <Section title="Font">
        <Row label="Family">
          <Pick
            value={name}
            options={(CAPTION_FONTS.includes(name) ? CAPTION_FONTS : [name, ...CAPTION_FONTS]).map(
              (f) => [f, f]
            )}
            onChange={(f) => setNested('font', { font_name: f })}
          />
        </Row>
        <SliderRow
          label="Size"
          value={font.font_size ?? 30}
          min={8}
          max={200}
          step={1}
          fmt={(v) => `${v}px`}
          onCommit={(v) => setNested('font', { font_size: v })}
        />
        <Row label="Style">
          <div className="flex gap-0.5">
            {(
              [
                ['bold', Bold],
                ['italic', Italic],
                ['underline', Underline],
                ['strikeout', Strikethrough]
              ] as const
            ).map(([k, I]) => (
              <Toggle
                key={k}
                size="sm"
                pressed={!!font[k]}
                onPressedChange={(v) => setNested('font', { [k]: v })}
                aria-label={k}
              >
                <I />
              </Toggle>
            ))}
          </div>
        </Row>
        <ColorRow
          label="Colour"
          value={primary.hex}
          onChange={(v) => setAsset({ primary_color: hexToAss(v, primary.alpha) }, 'primary')}
        />
      </Section>
      <ToggleCard
        title="Animation"
        on={!!a.animation}
        onToggle={(on) => setAsset({ animation: on ? 'karaoke' : undefined })}
      >
        <Row label="Effect">
          <Pick
            value={a.animation ?? 'karaoke'}
            options={CAPTION_ANIMATIONS.map((x) => [x, x.replace('_', ' ')])}
            onChange={(v) => setAsset({ animation: v })}
          />
        </Row>
        <ColorRow
          label="Highlight"
          value={secondary.hex}
          onChange={(v) => setAsset({ secondary_color: hexToAss(v, secondary.alpha) }, 'secondary')}
        />
      </ToggleCard>
      <ToggleCard
        title="Outline"
        on={!boxed && (a.border?.outline ?? 1) > 0}
        onToggle={(on) => setNested('border', { style: 'outline_and_shadow', outline: on ? 3 : 0 })}
      >
        <SliderRow
          label="Width"
          value={a.border?.outline ?? 1}
          min={0}
          max={12}
          step={0.5}
          fmt={(v) => `${v}px`}
          onCommit={(v) => setNested('border', { outline: v })}
        />
        <ColorRow
          label="Colour"
          value={outline.hex}
          onChange={(v) =>
            setNested('border', { outline_color: hexToAss(v, outline.alpha) }, 'outline')
          }
        />
      </ToggleCard>
      <ToggleCard
        title="Shadow"
        on={!boxed && (a.border?.shadow ?? 0) > 0}
        onToggle={(on) => setNested('border', { style: 'outline_and_shadow', shadow: on ? 2 : 0 })}
      >
        <SliderRow
          label="Depth"
          value={a.border?.shadow ?? 0}
          min={0}
          max={12}
          step={0.5}
          fmt={(v) => `${v}px`}
          onCommit={(v) => setNested('border', { shadow: v })}
        />
        <ColorRow
          label="Colour"
          value={back.hex}
          onChange={(v) => setAsset({ back_color: hexToAss(v, back.alpha) }, 'back')}
        />
      </ToggleCard>
      <ToggleCard
        title="Background box"
        on={boxed}
        onToggle={(on) =>
          on
            ? setAsset({
                border: { ...(a.border ?? {}), style: 'opaque_box', outline: 0 },
                back_color: hexToAss(back.hex, 0.85)
              })
            : setNested('border', { style: 'outline_and_shadow', outline: 2 })
        }
      >
        <ColorRow
          label="Fill"
          value={back.hex}
          onChange={(v) => setAsset({ back_color: hexToAss(v, back.alpha) }, 'back')}
        />
        <SliderRow
          label="Opacity"
          value={back.alpha}
          min={0}
          max={1}
          step={0.01}
          fmt={(v) => `${Math.round(v * 100)}%`}
          onCommit={(v) => setAsset({ back_color: hexToAss(back.hex, v) })}
        />
      </ToggleCard>
      <Section title="Position">
        <Row label="Anchor">
          <AnchorPad
            value={a.position?.alignment ?? 'bottom_center'}
            names={[
              'top_left',
              'top_center',
              'top_right',
              'middle_left',
              'middle_center',
              'middle_right',
              'bottom_left',
              'bottom_center',
              'bottom_right'
            ]}
            onChange={(v) => setNested('position', { alignment: v })}
          />
        </Row>
        <SliderRow
          label="Vertical margin"
          value={a.position?.margin_v ?? 30}
          min={0}
          max={800}
          step={5}
          fmt={(v) => `${v}px`}
          onCommit={(v) => setNested('position', { margin_v: v })}
        />
        <SliderRow
          label="Side margins"
          value={a.position?.margin_l ?? 30}
          min={0}
          max={400}
          step={5}
          fmt={(v) => `${v}px`}
          onCommit={(v) => setNested('position', { margin_l: v, margin_r: v })}
        />
      </Section>
    </>
  )
}

// ─── controls ──────────────────────────────────────────────────────────────────
function Section({
  title,
  action,
  children
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex h-6 items-center justify-between">
        <h3 className="text-muted-foreground text-xs font-medium">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function ToggleCard({
  title,
  on,
  onToggle,
  children
}: {
  title: string
  on: boolean
  onToggle: (on: boolean) => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="rounded-lg border">
      <button
        className="flex h-9 w-full items-center justify-between px-3 text-xs font-medium"
        onClick={() => onToggle(!on)}
      >
        {title}
        <span
          className={cn(
            'relative h-4 w-7 rounded-full transition-colors',
            on ? 'bg-foreground' : 'bg-muted-foreground/30'
          )}
        >
          <span
            className={cn(
              'bg-background absolute top-0.5 size-3 rounded-full transition-[left]',
              on ? 'left-3.5' : 'left-0.5'
            )}
          />
        </span>
      </button>
      {on && <div className="flex flex-col gap-2.5 border-t px-3 py-3">{children}</div>}
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <span className="text-muted-foreground w-20 shrink-0 text-xs">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function Pick({
  value,
  options,
  onChange
}: {
  value: string
  options: [string, string][]
  onChange: (v: string) => void
}): React.JSX.Element {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className="h-7 w-full text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, l]) => (
          <SelectItem key={v} value={v} className="text-xs">
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// Live value while dragging; one commit (one undo step, one render) on release.
function SliderRow({
  label,
  value,
  min,
  max,
  step,
  fmt,
  onCommit
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  fmt: (v: number) => string
  onCommit: (v: number) => void
}): React.JSX.Element {
  const [live, setLive] = useState<number | null>(null)
  const v = live ?? value
  return (
    <Row label={label}>
      <div className="flex items-center gap-2">
        <Slider
          className="flex-1"
          min={min}
          max={max}
          step={step}
          value={[Math.min(max, Math.max(min, v))]}
          onValueChange={([x]) => setLive(x)}
          onValueCommit={([x]) => {
            setLive(null)
            if (x !== value) onCommit(Math.round(x / step) * step)
          }}
        />
        <span className="text-muted-foreground w-12 shrink-0 text-right font-mono text-[11px] tabular-nums">
          {fmt(v)}
        </span>
      </div>
    </Row>
  )
}

function ColorRow({
  label,
  value,
  onChange
}: {
  label: string
  value: string
  onChange: (v: string) => void
}): React.JSX.Element {
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : '#ffffff'
  return (
    <Row label={label}>
      <label className="flex h-7 cursor-pointer items-center gap-2 rounded-md border px-1.5">
        <input
          type="color"
          value={hex}
          onChange={(e) => onChange(e.target.value)}
          className="h-4 w-6 cursor-pointer border-0 bg-transparent p-0"
        />
        <span className="font-mono text-[11px] uppercase">{hex}</span>
      </label>
    </Row>
  )
}

function NumField({
  label,
  value,
  min,
  max,
  onCommit
}: {
  label: string
  value: number
  min?: number
  max?: number
  onCommit: (v: number) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState(value.toFixed(2))
  useEffect(() => setDraft(value.toFixed(2)), [value])
  const commit = (): void => {
    let v = parseFloat(draft)
    if (!Number.isFinite(v)) return setDraft(value.toFixed(2))
    if (min !== undefined) v = Math.max(min, v)
    if (max !== undefined) v = Math.min(max, v)
    if (Math.abs(v - value) > 1e-4) onCommit(v)
    else setDraft(value.toFixed(2))
  }
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted-foreground text-[11px]">{label}</span>
      <span className="flex h-7 items-center rounded-md border px-2 focus-within:ring-2 focus-within:ring-ring/30">
        <input
          className="min-w-0 flex-1 bg-transparent font-mono text-xs tabular-nums outline-none"
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') {
              setDraft(value.toFixed(2))
              ;(e.target as HTMLInputElement).blur()
            }
          }}
        />
        <span className="text-muted-foreground text-[10px]">s</span>
      </span>
    </label>
  )
}

function AnchorPad({
  value,
  names,
  onChange
}: {
  value: string
  names: string[]
  onChange: (v: string) => void
}): React.JSX.Element {
  return (
    <div className="grid w-fit grid-cols-3 gap-0.5 rounded-md border p-0.5">
      {names.map((n) => (
        <button
          key={n}
          aria-label={n.replace(/[_:]/g, ' ')}
          title={n.replace(/[_:]/g, ' ')}
          className={cn(
            'hover:bg-muted flex size-6 items-center justify-center rounded-sm',
            value === n && 'bg-foreground hover:bg-foreground'
          )}
          onClick={() => onChange(n)}
        >
          <span
            className={cn(
              'size-1.5 rounded-full',
              value === n ? 'bg-background' : 'bg-muted-foreground/50'
            )}
          />
        </button>
      ))}
    </div>
  )
}
