import { app } from 'electron'
import { join } from 'path'
import { readJson, writeJson } from '@shared/project'
import type { Settings } from '@shared/ipc'

const file = (): string => join(app.getPath('userData'), 'settings.json')
const DEFAULTS: Settings = { apiKey: '', agent: 'claude', recent: [], onboarded: false }

export async function getSettings(): Promise<Settings> {
  const s = { ...DEFAULTS, ...(await readJson<Partial<Settings>>(file(), {})) }
  if (!s.apiKey && process.env.VIDEO_DB_API_KEY) s.apiKey = process.env.VIDEO_DB_API_KEY
  return s
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch }
  await writeJson(file(), next)
  return next
}
