import { app } from 'electron'
import { join } from 'path'
import { readJson, writeJson } from '@shared/project'
import type { Settings } from '@shared/ipc'

const file = (): string => join(app.getPath('userData'), 'settings.json')
const DEFAULTS: Settings = { apiKey: '', agent: 'claude', recent: [], onboarded: false }

export async function getSettings(): Promise<Settings> {
  const s = { ...DEFAULTS, ...(await readJson<Partial<Settings>>(file(), {})) }
  if (s.videoDbAuth !== 'sso' || !s.apiKey) {
    s.apiKey = ''
    s.onboarded = false
  }
  return s
}

let writes: Promise<unknown> = Promise.resolve()
export function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const run = writes.then(async () => {
    const current = await getSettings()
    const next = { ...current, ...patch }
    if (patch.agentConfig) {
      next.agentConfig = { ...current.agentConfig }
      for (const kind of Object.keys(patch.agentConfig) as (keyof NonNullable<
        Settings['agentConfig']
      >)[])
        next.agentConfig[kind] = { ...current.agentConfig?.[kind], ...patch.agentConfig[kind] }
    }
    await writeJson(file(), next, 0o600)
    return next
  })
  writes = run.catch(() => undefined)
  return run
}
