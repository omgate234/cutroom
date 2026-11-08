// Cutroom owns ~/.cutroom/projects/<id>/; folders opened from elsewhere are remembered in registry.json.
import { existsSync, promises as fs } from 'fs'
import { homedir } from 'os'
import { basename, join } from 'path'
import { randomBytes } from 'crypto'
import { shell } from 'electron'
import { readJson, writeJson } from '@shared/project'
import type { AssetsFile, Timeline } from '@shared/timeline'
import { timelineDuration } from '@shared/timeline'
import type { ProjectMeta, ProjectSummary } from '@shared/ipc'

export const CUTROOM_HOME = join(homedir(), '.cutroom')
const PROJECTS = join(CUTROOM_HOME, 'projects')
const REGISTRY = join(CUTROOM_HOME, 'registry.json')

interface Registry {
  external: string[]
}

const readRegistry = (): Promise<Registry> => readJson<Registry>(REGISTRY, { external: [] })

// Time-sortable and unique: base36 ms timestamp + random tail.
const newId = (): string => `p_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`

export const metaPath = (dir: string): string => join(dir, 'project.json')

export async function readMeta(dir: string): Promise<ProjectMeta> {
  const now = new Date().toISOString()
  const fallback: ProjectMeta = {
    id: basename(dir),
    name: basename(dir),
    description: '',
    created: now,
    updated: now
  }
  return { ...fallback, ...(await readJson<Partial<ProjectMeta>>(metaPath(dir), {})) }
}

export async function ensureMeta(dir: string): Promise<ProjectMeta> {
  const meta = await readMeta(dir)
  if (!existsSync(metaPath(dir))) await writeJson(metaPath(dir), meta)
  return meta
}

export async function updateMeta(
  dir: string,
  patch: Partial<Pick<ProjectMeta, 'name' | 'description'>>
): Promise<ProjectMeta> {
  const meta = { ...(await readMeta(dir)), ...patch, updated: new Date().toISOString() }
  await writeJson(metaPath(dir), meta)
  return meta
}

export async function touchMeta(dir: string): Promise<void> {
  if (existsSync(metaPath(dir))) await updateMeta(dir, {})
}

export async function createProject(name?: string): Promise<string> {
  await fs.mkdir(PROJECTS, { recursive: true })
  const existing = await listProjects()
  const taken = new Set(existing.map((p) => p.name))
  let n = 1
  let auto = 'Untitled edit'
  while (!name && taken.has(auto)) auto = `Untitled edit ${++n}`
  const id = newId()
  const dir = join(PROJECTS, id)
  const now = new Date().toISOString()
  await fs.mkdir(dir, { recursive: true })
  await writeJson(metaPath(dir), {
    id,
    name: name?.trim() || auto,
    description: '',
    created: now,
    updated: now
  })
  return dir
}

export async function rememberExternal(dir: string): Promise<void> {
  if (dir.startsWith(PROJECTS)) return
  const r = await readRegistry()
  if (!r.external.includes(dir)) await writeJson(REGISTRY, { external: [dir, ...r.external] })
}

async function summarize(dir: string, owned: boolean): Promise<ProjectSummary | null> {
  if (!existsSync(dir)) return null
  const meta = await readMeta(dir)
  const timeline = await readJson<Timeline>(join(dir, 'timeline.json'), { tracks: [] })
  const assets = await readJson<AssetsFile>(join(dir, 'assets.json'), { media: [] })
  const stat = await fs.stat(join(dir, 'timeline.json')).catch(() => null)
  const cover = assets.media.find((m) => m.kind === 'video' && (m.sprite || m.thumbnail))
  return {
    ...meta,
    dir,
    owned,
    updated:
      stat && stat.mtime.toISOString() > meta.updated ? stat.mtime.toISOString() : meta.updated,
    duration: timelineDuration({ tracks: timeline.tracks ?? [] }),
    mediaCount: assets.media.length,
    cover: cover
      ? { thumbnail: cover.thumbnail, sprite: cover.sprite, duration: cover.duration }
      : undefined
  }
}

export async function listProjects(): Promise<ProjectSummary[]> {
  await fs.mkdir(PROJECTS, { recursive: true })
  const owned = (await fs.readdir(PROJECTS, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => join(PROJECTS, d.name))
  const { external } = await readRegistry()
  const all = await Promise.all([
    ...owned.map((d) => summarize(d, true)),
    ...external.map((d) => summarize(d, false))
  ])
  return all
    .filter((p): p is ProjectSummary => !!p)
    .sort((a, b) => b.updated.localeCompare(a.updated))
}

// Owned projects go to the Trash (recoverable); external folders are only forgotten, never touched.
export async function removeProject(dir: string): Promise<void> {
  if (dir.startsWith(PROJECTS)) await shell.trashItem(dir)
  else {
    const r = await readRegistry()
    await writeJson(REGISTRY, { external: r.external.filter((d) => d !== dir) })
  }
}

// One-time: folders from the old "recent" list become registered external projects.
export async function migrateRecent(recent: string[]): Promise<void> {
  for (const d of recent) if (existsSync(d)) await rememberExternal(d)
}
