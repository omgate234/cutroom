// VideoDB editor wire contract; shared by UI, validation and agent tools.
export const MOTION_PRESETS = [
  'fade',
  'slide_up',
  'slide_down',
  'slide_left',
  'slide_right',
  'pop',
  'wipe_left',
  'wipe_right'
] as const
export const EASINGS = ['linear', 'ease_in', 'ease_out', 'ease_in_out', 'back_out'] as const
export const EFFECTS = ['zoom_in', 'shake'] as const
export const KEYFRAME_PROPERTIES = ['offset.x', 'offset.y', 'scale', 'rotation', 'opacity'] as const
export interface Lut {
  src: string
  intensity: number
}
export interface MotionPreset {
  preset: (typeof MOTION_PRESETS)[number]
  duration: number
  amount: number
  easing: (typeof EASINGS)[number]
}
export interface Motion {
  enter?: MotionPreset
  exit?: MotionPreset
  keyframes?: Partial<
    Record<
      (typeof KEYFRAME_PROPERTIES)[number],
      { time: number; value: number; easing?: (typeof EASINGS)[number] }[]
    >
  >
}
export const motionPreset = (preset: MotionPreset['preset'], duration = 0.4): MotionPreset => ({
  preset,
  duration,
  amount: 0.08,
  easing: 'ease_out'
})

export function validateCube(text: string): void {
  let size = 0
  let rows = 0
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    if (!line || line.startsWith('TITLE ')) continue
    const [key, ...rest] = line.split(/\s+/)
    if (key === 'LUT_3D_SIZE') {
      if (size || rest.length !== 1 || !/^\d+$/.test(rest[0]))
        throw new Error('Invalid LUT_3D_SIZE')
      size = Number(rest[0])
      if (size < 2 || size > 65) throw new Error('LUT size must be 2–65')
    } else if (key === 'DOMAIN_MIN' || key === 'DOMAIN_MAX') {
      if (rest.length !== 3 || rest.some((v) => Number(v) !== (key === 'DOMAIN_MIN' ? 0 : 1)))
        throw new Error('Only the default 0–1 LUT domain is supported')
    } else {
      const values = line.split(/\s+/)
      if (values.length !== 3 || values.some((v) => !Number.isFinite(Number(v))))
        throw new Error('Expected a 3D .cube LUT with RGB rows')
      rows++
    }
  }
  if (!size || rows !== size ** 3) throw new Error('LUT RGB row count does not match LUT_3D_SIZE')
}
