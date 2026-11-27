// Text samples and caption presets, ported from DirectorFE editor/stylePresets.js into VideoDB's
// wire field names. Fonts stay inside the renderer's supported sets.

export const TEXT_FONTS = [
  'Inter',
  'Roboto',
  'Open Sans',
  'Lato',
  'Montserrat',
  'Oswald',
  'Raleway',
  'Poppins',
  'Ubuntu',
  'Arial',
  'Times New Roman',
  'Courier New',
  'Georgia',
  'Verdana'
]

export const CAPTION_FONTS = [
  'Alegreya Sans',
  'Bebas Neue',
  'Cormorant',
  'Do Hyeon',
  'Fira Sans',
  'Fjalla One',
  'Lato',
  'League Spartan',
  'Libre Baskerville',
  'Libre Franklin',
  'Lora',
  'M Plus 1p',
  'Merriweather',
  'Montserrat',
  'Noto Sans',
  'Nunito Sans',
  'Open Sans',
  'Oswald',
  'PT Sans',
  'Playfair Display',
  'Quicksand',
  'Roboto',
  'Rubik'
]

// Weights each face really has; the renderer does not fake the others.
const FONT_WEIGHTS: Record<string, number[]> = {
  Inter: [300, 400, 500, 600, 700, 800],
  Roboto: [300, 400, 500, 700, 900],
  'Open Sans': [300, 400, 600, 700, 800],
  Lato: [300, 400, 700, 900],
  Montserrat: [300, 400, 500, 600, 700, 800],
  Oswald: [300, 400, 500, 600, 700],
  Raleway: [300, 400, 500, 600, 700, 800],
  Poppins: [300, 400, 500, 600, 700, 800],
  Ubuntu: [300, 400, 500, 700]
}
export const WEIGHT_NAMES: Record<number, string> = {
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'Semibold',
  700: 'Bold',
  800: 'Extrabold',
  900: 'Black'
}
export const weightsFor = (f: string): number[] => FONT_WEIGHTS[f] ?? [400, 700]
export const nearestWeight = (f: string, w: number): number =>
  weightsFor(f).reduce((b, x) => (Math.abs(x - w) < Math.abs(b - w) ? x : b), weightsFor(f)[0])

export const TEXT_SAMPLES = [
  { key: 'Simple', font: 'Inter', weight: 400, size: 48 },
  { key: 'Title', font: 'Montserrat', weight: 700, size: 64 },
  { key: 'Clean', font: 'Open Sans', weight: 400, size: 52 },
  { key: 'Reliable', font: 'Roboto', weight: 700, size: 52 },
  { key: 'Friendly', font: 'Ubuntu', weight: 700, size: 52 },
  { key: 'Modern', font: 'Raleway', weight: 400, size: 54 },
  { key: 'Bold', font: 'Poppins', weight: 700, size: 60 },
  { key: 'Industrial', font: 'Oswald', weight: 700, size: 64 },
  { key: 'Light', font: 'Lato', weight: 400, size: 54 },
  { key: 'Serif', font: 'Times New Roman', weight: 700, size: 56 },
  { key: 'Editorial', font: 'Georgia', weight: 400, size: 52 },
  { key: 'Typewriter', font: 'Courier New', weight: 700, size: 44 },
  { key: 'Wide', font: 'Verdana', weight: 700, size: 48 },
  { key: 'Neutral', font: 'Arial', weight: 700, size: 52 }
]

export const CAPTION_ANIMATIONS = [
  'karaoke',
  'box_highlight',
  'color_highlight',
  'reveal',
  'impact',
  'supersize'
] as const

type CaptionConfig = {
  font: { font_name: string; font_size: number; bold: boolean; italic: boolean }
  animation: string | null
  primary_color: string
  secondary_color: string
  back_color: string
  border: { style: string; outline: number; outline_color: string }
  position: { alignment: string; margin_l: number; margin_r: number; margin_v: number }
}

const cap = (
  font: [string, number, boolean, boolean],
  animation: string | null,
  colors: [string, string, string],
  border: [string, number],
  position: [string, number, number]
): CaptionConfig => ({
  font: { font_name: font[0], font_size: font[1], bold: font[2], italic: font[3] },
  animation,
  primary_color: colors[0],
  secondary_color: colors[1],
  back_color: colors[2],
  border: { style: border[0], outline: border[1], outline_color: '&H00000000' },
  position: {
    alignment: position[0],
    margin_l: position[1],
    margin_r: position[1],
    margin_v: position[2]
  }
})

export const CAPTION_PRESETS: { key: string; label: string; config: CaptionConfig }[] = [
  {
    key: 'karaoke_classic',
    label: 'Karaoke',
    config: cap(
      ['Open Sans', 56, true, false],
      'karaoke',
      ['&H00FFFFFF', '&H0000FF00', '&H00000000'],
      ['outline_and_shadow', 3],
      ['bottom_center', 30, 30]
    )
  },
  {
    key: 'tiktok_classic',
    label: 'TikTok Classic',
    config: cap(
      ['Montserrat', 58, true, false],
      'impact',
      ['&H00FFFFFF', '&H0000FFFF', '&H80000000'],
      ['outline_and_shadow', 3],
      ['bottom_center', 15, 40]
    )
  },
  {
    key: 'cinematic_gold',
    label: 'Cinematic Gold',
    config: cap(
      ['Playfair Display', 52, false, true],
      'reveal',
      ['&H0000D7FF', '&H0000FFFF', '&H00000000'],
      ['outline_and_shadow', 2],
      ['bottom_center', 15, 40]
    )
  },
  {
    key: 'bold_impact',
    label: 'Bold Impact',
    config: cap(
      ['Oswald', 62, true, false],
      'impact',
      ['&H00FFFFFF', '&H00FFFFFF', '&H00000000'],
      ['outline_and_shadow', 4],
      ['middle_center', 15, 20]
    )
  },
  {
    key: 'box_highlight',
    label: 'Box Highlight',
    config: cap(
      ['Rubik', 50, true, false],
      'box_highlight',
      ['&H00FFFFFF', '&H00FF00FF', '&H00000000'],
      ['outline_and_shadow', 2],
      ['bottom_center', 15, 40]
    )
  },
  {
    key: 'color_wave',
    label: 'Color Wave',
    config: cap(
      ['Noto Sans', 54, true, false],
      'color_highlight',
      ['&H00FFFFFF', '&H005DE2F7', '&H00000000'],
      ['outline_and_shadow', 2],
      ['bottom_center', 15, 40]
    )
  },
  {
    key: 'supersize_drama',
    label: 'Supersize Drama',
    config: cap(
      ['Bebas Neue', 56, false, false],
      'supersize',
      ['&H00FFFFFF', '&H0000FF00', '&H00000000'],
      ['outline_and_shadow', 3],
      ['middle_center', 15, 20]
    )
  },
  {
    key: 'clean_minimal',
    label: 'Clean Minimal',
    config: cap(
      ['Lora', 46, false, false],
      null,
      ['&H00FFFFFF', '&H00FFFFFF', '&HA0000000'],
      ['outline_and_shadow', 1],
      ['bottom_center', 15, 40]
    )
  },
  {
    key: 'modern_boxed',
    label: 'Modern Boxed',
    config: cap(
      ['Libre Franklin', 44, true, false],
      'reveal',
      ['&H00FFFFFF', '&H00FFFFFF', '&HE0000000'],
      ['opaque_box', 0],
      ['bottom_center', 15, 40]
    )
  }
]

// The patch a preset applies; fields it doesn't own (src, scale, spacing...) survive.
export function captionPresetPatch(
  asset: Record<string, any>,
  p: CaptionConfig
): Record<string, unknown> {
  return {
    font: { ...(asset.font ?? {}), ...p.font },
    animation: p.animation ?? undefined,
    primary_color: p.primary_color,
    secondary_color: p.secondary_color,
    back_color: p.back_color,
    border: { ...(asset.border ?? {}), ...p.border },
    position: { ...(asset.position ?? {}), ...p.position }
  }
}

export function matchingPreset(asset: Record<string, any>): string | null {
  const f = asset.font ?? {}
  const b = asset.border ?? {}
  const pos = asset.position ?? {}
  const hit = CAPTION_PRESETS.find(
    ({ config: c }) =>
      f.font_name === c.font.font_name &&
      f.font_size === c.font.font_size &&
      !!f.bold === c.font.bold &&
      !!f.italic === c.font.italic &&
      (asset.animation ?? null) === c.animation &&
      asset.primary_color === c.primary_color &&
      asset.secondary_color === c.secondary_color &&
      (asset.back_color ?? '&H00000000') === c.back_color &&
      (b.style ?? 'outline_and_shadow') === c.border.style &&
      b.outline === c.border.outline &&
      pos.alignment === c.position.alignment &&
      pos.margin_v === c.position.margin_v
  )
  return hit?.key ?? null
}

// ASS colours are &HAABBGGRR with AA as transparency (00 = opaque).
export function assToHex(ass?: string): { hex: string; alpha: number } {
  const m = /^&H([0-9a-f]{2})?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(ass ?? '')
  if (!m) return { hex: '#ffffff', alpha: 1 }
  const a = m[1] ? parseInt(m[1], 16) : 0
  return {
    hex: `#${m[4]}${m[3]}${m[2]}`.toLowerCase(),
    alpha: Math.round((1 - a / 255) * 100) / 100
  }
}
export function hexToAss(hex: string, alpha = 1): string {
  const h = hex.replace('#', '').padEnd(6, '0')
  const a = Math.round((1 - Math.max(0, Math.min(1, alpha))) * 255)
    .toString(16)
    .padStart(2, '0')
  return `&H${a}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase()
}

// One-line look and fit per preset, for the agent's caption_presets tool.
export const CAPTION_PRESET_LOOKS: Record<string, string> = {
  karaoke_classic: 'White bold sans, the spoken word fills green. Talking heads, tutorials.',
  tiktok_classic: 'Bold Montserrat, each word pops in yellow. Reels, TikTok, Shorts.',
  cinematic_gold: 'Gold italic serif that reveals word by word. Trailers, storytelling, premium.',
  bold_impact: 'Large Oswald centred on screen, words punch in. Hype edits, sports, promos.',
  box_highlight: 'A magenta box behind the spoken word. Energetic social clips.',
  color_wave: 'White text, the spoken word turns yellow. Podcasts, explainers.',
  supersize_drama: 'Bebas Neue centred, the spoken word grows large. Dramatic quotes, hooks.',
  clean_minimal: 'Small serif on a soft shadow, no animation. Interviews, documentaries.',
  modern_boxed:
    'White text on a dark box, revealed line by line. Corporate, product, accessibility.'
}

// What the agent sees: each preset as a ready caption asset.
export const captionPresetList = (): {
  key: string
  name: string
  look: string
  asset: Record<string, unknown>
}[] =>
  CAPTION_PRESETS.map((p) => ({
    key: p.key,
    name: p.label,
    look: CAPTION_PRESET_LOOKS[p.key],
    asset: { type: 'caption', src: 'auto', ...p.config }
  }))
