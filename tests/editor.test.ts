import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateTimeline, toWire, type Timeline } from '../src/shared/timeline'
import { validateCube, motionPreset } from '../src/shared/effects'
import { setFade, patchClip } from '../src/shared/timeline-ops'
const timeline = (): Timeline => ({
  resolution: '1080x1920',
  tracks: [
    {
      clips: [
        { id: 'title', start: 0, clip: { duration: 3, asset: { type: 'text', text: 'Hello' } } }
      ]
    }
  ]
})
const assets = { media: [] }
const cube =
  'LUT_3D_SIZE 2\n' +
  Array.from({ length: 8 }, (_, i) => `${i & 1} ${(i >> 1) & 1} ${(i >> 2) & 1}`).join('\n')
test('timeline and clip LUTs, motion and stable editor IDs serialize correctly', () => {
  const t = timeline()
  t.lut = { src: 'https://example.test/grade.cube', intensity: 0.7 }
  Object.assign(t.tracks[0].clips[0].clip, { lut: t.lut, motion: { enter: motionPreset('pop') } })
  assert.deepEqual(validateTimeline(t, assets), [])
  const wire = toWire(t).timeline as {
    lut: unknown
    tracks: {
      clips: { id?: string; clip: { lut: unknown; motion: { enter: { preset: string } } } }[]
    }[]
  }
  assert.deepEqual(wire.lut, t.lut)
  assert.deepEqual(wire.tracks[0].clips[0].clip.lut, t.lut)
  assert.equal(wire.tracks[0].clips[0].clip.motion.enter.preset, 'pop')
  assert.equal(wire.tracks[0].clips[0].id, undefined)
})
test('invalid motion combinations fail before rendering', () => {
  for (const conflict of [{ effect: 'zoom_in' }, { transition: { in: 'fade', duration: 0.4 } }]) {
    const t = timeline()
    Object.assign(t.tracks[0].clips[0].clip, {
      motion: { enter: motionPreset('fade') },
      ...conflict
    })
    assert(validateTimeline(t, assets).some((i) => i.path.endsWith('.motion')))
  }
})
test('audio and captions cannot silently receive visual effects', () => {
  const t = timeline()
  Object.assign(t.tracks[0].clips[0].clip, {
    asset: { type: 'caption', src: 'auto' },
    motion: { enter: motionPreset('pop') }
  })
  assert(validateTimeline(t, assets).some((i) => i.message.includes('require a video')))
})
test('finite timing, LUT strength and ordered keyframes are enforced', () => {
  const t = timeline()
  t.tracks[0].clips[0].start = Infinity
  t.lut = { src: '/local.cube', intensity: 2 }
  t.tracks[0].clips[0].clip.motion = {
    keyframes: {
      scale: [
        { time: 1, value: 1 },
        { time: 0, value: 2 }
      ]
    }
  }
  assert.equal(validateTimeline(t, assets).length, 3)
})
test('LUT parser accepts valid cubes and rejects malformed, oversized and nondefault domains', () => {
  validateCube(cube)
  for (const invalid of [
    cube.replace('SIZE 2', 'SIZE 66'),
    cube + '\n0 0 0',
    cube + '\nDOMAIN_MAX 2 2 2',
    'LUT_1D_SIZE 2\n0 0 0',
    cube.replace('0 0 0', 'NaN 0 0')
  ])
    assert.throws(() => validateCube(invalid))
})
test('choosing a fade replaces motion and leaves the previous edit immutable', () => {
  const t = timeline()
  const moving = patchClip(t, 'title', { motion: { enter: motionPreset('slide_up') } })
  const faded = setFade(moving, 'title', 'in', 0.3)
  assert.equal(faded.tracks[0].clips[0].clip.motion, undefined)
  assert(moving.tracks[0].clips[0].clip.motion)
  assert.deepEqual(validateTimeline(faded, assets), [])
})

test('splitting motion preserves entrance on the first half and exit on the second', async () => {
  const { splitClip } = await import('../src/shared/timeline-ops')
  const t = timeline()
  t.tracks[0].clips[0].clip.motion = { enter: motionPreset('slide_up'), exit: motionPreset('fade') }
  const split = splitClip(t, 'title', 1.5).timeline.tracks[0].clips
  assert.equal(split.length, 2)
  assert.deepEqual(split[0].clip.motion, { enter: motionPreset('slide_up') })
  assert.deepEqual(split[1].clip.motion, { exit: motionPreset('fade') })
})

test('splitting a keyframed clip leaves its curve untouched instead of restarting it', async () => {
  const { splitClip, canSplit } = await import('../src/shared/timeline-ops')
  const t = timeline()
  t.tracks[0].clips[0].clip.motion = { keyframes: { scale: [{time: 0, value: 1}, {time: 3, value: 2}] } }
  assert.equal(canSplit(t.tracks[0].clips[0], 1.5), false)
  assert.equal(splitClip(t, 'title', 1.5).timeline, t)
})

test('caption presets exposed to the agent match the editor and preserve source settings', async () => {
  const { CAPTION_PRESETS, captionPresetList, captionPresetPatch, matchingPreset } =
    await import('../src/shared/style-presets')
  const list = captionPresetList()
  assert.equal(list.length, 9)
  for (const [index, preset] of CAPTION_PRESETS.entries()) {
    assert.deepEqual(list[index].asset, { type: 'caption', src: 'auto', ...preset.config })
    assert(list[index].look.length > 0)
    const original = { type: 'caption', src: 'custom.ass', animation: 'karaoke', font: { spacing: 2 } }
    const updated = { ...original, ...captionPresetPatch(original, preset.config) }
    assert.equal(updated.src, 'custom.ass')
    assert.equal((updated.font as Record<string, unknown>).spacing, 2)
    assert.equal(matchingPreset(updated), preset.key)
    if (preset.config.animation === null) assert.equal(updated.animation, undefined)
  }
})
