import { promises as fs, existsSync } from 'fs'
import { join, dirname } from 'path'
import { randomBytes } from 'crypto'
import { AssetsFile, EMPTY_TIMELINE, MediaItem, Timeline } from './timeline'
import { AGENTS_MD, SKILLS } from './scaffold'

export const paths = (dir: string) => ({
  timeline: join(dir, 'timeline.json'),
  assets: join(dir, 'assets.json'),
  media: (id: string) => join(dir, 'media', id),
  frames: join(dir, 'renders', 'frames'),
  cache: join(dir, '.cutroom', 'compile-cache.json')
})

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

// Write-then-rename so watchers and the agent never see a half-written file.
export async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n')
  await fs.rename(tmp, file)
}

export const readTimeline = (dir: string): Promise<Timeline> =>
  readJson(paths(dir).timeline, EMPTY_TIMELINE)
export const readAssets = (dir: string): Promise<AssetsFile> =>
  readJson(paths(dir).assets, { media: [] })

let assetsLock: Promise<unknown> = Promise.resolve()

export function updateAssets(dir: string, fn: (a: AssetsFile) => void): Promise<AssetsFile> {
  const run = assetsLock.then(async () => {
    const a = await readAssets(dir)
    fn(a)
    await writeJson(paths(dir).assets, a)
    return a
  })
  assetsLock = run.catch(() => undefined)
  return run
}

export const patchMedia = (
  dir: string,
  id: string,
  patch: Partial<MediaItem>
): Promise<AssetsFile> =>
  updateAssets(dir, (a) => {
    const m = a.media.find((x) => x.id === id)
    if (m) Object.assign(m, patch)
  })

async function writeIfMissing(file: string, content: string): Promise<void> {
  if (existsSync(file)) return
  await fs.mkdir(dirname(file), { recursive: true })
  await fs.writeFile(file, content)
}

export async function scaffoldProject(dir: string): Promise<void> {
  const p = paths(dir)
  if (!existsSync(p.timeline)) await writeJson(p.timeline, EMPTY_TIMELINE)
  if (!existsSync(p.assets)) await writeJson(p.assets, { media: [] })
  // AGENTS.md and the project skills are Cutroom-managed: rewritten on open so every project tracks the app.
  await fs.writeFile(join(dir, 'AGENTS.md'), AGENTS_MD)
  await writeIfMissing(join(dir, 'CLAUDE.md'), '@AGENTS.md\n')
  await writeIfMissing(join(dir, '.gitignore'), 'renders/\n.cutroom/\nattachments/\n*.tmp\n')
  // Claude Code: VideoDB tools and timeline edits run without a prompt each time.
  await writeIfMissing(
    join(dir, '.claude', 'settings.json'),
    JSON.stringify(
      { permissions: { allow: ['mcp__videodb', 'Edit(timeline.json)', 'Write(timeline.json)'] } },
      null,
      2
    ) + '\n'
  )
  for (const [name, body] of Object.entries(SKILLS)) {
    // Claude Code reads .claude/skills, Codex reads .agents/skills.
    for (const root of ['.claude', '.agents']) {
      await fs.mkdir(join(dir, root, 'skills', name), { recursive: true })
      await fs.writeFile(join(dir, root, 'skills', name, 'SKILL.md'), body)
    }
  }
}
